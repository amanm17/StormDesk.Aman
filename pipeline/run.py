"""StormDesk by Aman: full pipeline. `python -m pipeline.run`

1. Fetch every source (free, keyless) and merge into the history store
2. Score indicators, asset classes and the Global Financial Weather Index
3. Forecast, regime, scenarios, countries, trade corridors, events, alerts, data health
4. Write static JSON to public/data/ for the website
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback

import pandas as pd

from . import analytics, corridors, countries, events, health, scoring, sources
from .common import PUBLIC_DATA, load_dotenv, now_iso, r1, weather_bands_payload, weather_label, write_json
from .registry import ASSET_CLASSES, BY_KEY, INDICATORS, SOURCE_RELIABILITY

SCHEMA_VERSION = "2.0.0"
HISTORY_DAYS = 260   # ~1 year of business days in the snapshot
SPARK_DAYS = 60


def _series_payload(s: pd.Series, days: int, digits: int = 1) -> list:
    s = s.iloc[-days:]
    return [None if pd.isna(v) else round(float(v), digits) for v in s.values]


def _fmt(ind, value):
    try:
        return ind.display.format(value)
    except Exception:
        return f"{value:.2f}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-gdelt", action="store_true", help="use stored GDELT history only")
    ap.add_argument("--gdelt-days", type=int, default=None, help="cap new GDELT days fetched this run")
    args = ap.parse_args(argv)
    load_dotenv()
    t0 = time.time()
    log = {"started_at": now_iso(), "steps": []}

    def step(name, fn):
        s = time.time()
        try:
            res = fn()
            log["steps"].append({"name": name, "status": "ok", "seconds": round(time.time() - s, 1)})
            print(f"✓ {name} ({time.time() - s:.1f}s)")
            return res
        except Exception as exc:
            log["steps"].append({"name": name, "status": "failed", "error": str(exc),
                                 "trace": traceback.format_exc()[-1500:]})
            print(f"✗ {name}: {exc}", file=sys.stderr)
            raise

    # 1. Fetch
    series: dict[str, pd.Series] = {}
    statuses = []
    for name, fn in (("FRED", sources.fetch_fred), ("Frankfurter", sources.fetch_frankfurter),
                     ("CoinGecko", sources.fetch_coingecko)):
        out, st = step(f"fetch {name}", fn)
        series.update(out)
        statuses.append(st)
    if args.skip_gdelt:
        out = {i.key: sources.history.load(i.key) for i in INDICATORS if i.source == "gdelt"}
        st = {"key": "gdelt", "label": "GDELT 1.0 daily event files", "url": "https://www.gdeltproject.org/data.html",
              "cadence": "daily", "fetched_at": now_iso(),
              "live": [], "cached": [k for k, v in out.items() if not v.empty],
              "failed": [k for k, v in out.items() if v.empty], "errors": ["skipped this run (--skip-gdelt)"]}
        st["status"] = "failed" if st["failed"] and not st["cached"] else "cached"
    else:
        out, st = step("fetch GDELT", lambda: sources.fetch_gdelt(args.gdelt_days))
    series.update(out)
    statuses.append(st)

    fetch_state = {}
    for st in statuses:
        for k in st["live"]:
            fetch_state[k] = "live"
        for k in st["cached"]:
            fetch_state.setdefault(k, "cached")

    # 2. Score
    res = step("score", lambda: scoring.run(series, fetch_state))
    detail, cls, glob, corr = res["detail"], res["classes"], res["global"], res["correlation"]
    cls_conf = scoring.class_confidence(detail)
    last = {k: float(v) for k, v in cls.iloc[-1].dropna().items()}
    gnow = float(glob["global"].iloc[-1])
    generated = now_iso()

    # 3. Countries, corridors, events
    wb, wb_status = step("fetch World Bank", sources.fetch_worldbank)
    statuses.append(wb_status)
    country_payload = step("countries", lambda: countries.build(
        wb, {**last, "global": gnow}, sources.load_fx_all(), sources.load_gdelt_countries(), generated))
    ct, ct_status = step("fetch UN Comtrade", lambda: sources.fetch_comtrade(corridors.comtrade_queries()))
    statuses.append(ct_status)
    corridor_payload = step("corridors", lambda: corridors.build(country_payload["countries"], last, ct, generated))
    event_payload, ev_status = step("events", events.build)
    statuses.append(ev_status)
    trade_score = corridor_payload.get("trade_score")

    # 4. Health, forecasts, regime, alerts, scenarios
    health_payload = health.build(statuses, detail)
    forecasts = {"global": analytics.forecast_series(glob["global"])}
    for k in cls.columns:
        forecasts[k] = analytics.forecast_series(cls[k])
    C_now = float(corr["C"].iloc[-1])
    reg = analytics.regime(cls.iloc[-1], gnow, C_now)
    alerts = analytics.build_alerts(detail, cls, glob["global"], corr["C"], event_payload["top_events"], health_payload["sources"])
    scen = step("scenarios", lambda: analytics.scenario_grids(series, res))

    # 5. Assemble snapshot
    hist_idx = cls.index[-HISTORY_DAYS:]
    indicators_out = []
    for ind in INDICATORS:
        d = detail.get(ind.key, {})
        if not d.get("available"):
            indicators_out.append({"key": ind.key, "label": ind.label, "asset_class": ind.asset_class, "available": False})
            continue
        raw = series[ind.key].dropna()
        indicators_out.append({
            **{k: getattr(ind, k) for k in ("key", "label", "asset_class", "source", "source_id", "direction", "transform", "unit", "freq", "weight", "note")},
            **d, "display": _fmt(ind, d["value"]), "weather": weather_label(d["stress"]),
            "values": _series_payload(raw, SPARK_DAYS * 2, 4),
            "value_dates": [x.strftime("%Y-%m-%d") for x in raw.index[-SPARK_DAYS * 2:]],
            "stress_series": _series_payload(res["stress"][ind.key], SPARK_DAYS),
        })

    asset_classes = []
    for key, meta in ASSET_CLASSES.items():
        if key == "trade":
            if trade_score is None:
                continue
            top = corridor_payload["corridors"][0]
            asset_classes.append({"key": "trade", "title": meta["title"], "score": trade_score, "weather": weather_label(trade_score),
                                  "confidence": round(sum(c["confidence"] for c in corridor_payload["corridors"]) / len(corridor_payload["corridors"])),
                                  "driver": f"{top['from_name']} → {top['to_name']} {top['stress']:.0f}",
                                  "source": "UN Comtrade + country layer", "weight_in_global": 0.0, "series": [], "delta_5d": None,
                                  "members": [], "forecast": None})
            continue
        if key not in cls:
            continue
        members = sorted([{"key": i.key, "label": i.label, "stress": r1(detail[i.key]["stress"])}
                          for i in INDICATORS if i.asset_class == key and detail.get(i.key, {}).get("available")
                          and detail[i.key].get("stress") is not None],
                         key=lambda m: -(m["stress"] or 0))
        srcs = sorted({BY_KEY[m["key"]].source for m in members})
        s = cls[key]
        top = members[0] if members else None
        asset_classes.append({
            "key": key, "title": meta["title"], "score": r1(s.iloc[-1]), "weather": weather_label(s.iloc[-1]),
            "confidence": cls_conf.get(key), "weight_in_global": meta["weight"],
            "driver": f"{top['label']} {top['stress']:.0f}" if top and top["stress"] is not None else "",
            "source": " + ".join(s_.upper() if s_ == "fred" else s_.capitalize() for s_ in srcs),
            "delta_5d": r1(s.iloc[-1] - s.iloc[-6]) if len(s) > 6 else None,
            "series": _series_payload(s, SPARK_DAYS), "members": members, "forecast": forecasts.get(key),
        })

    tape = []
    for ind in INDICATORS:
        d = detail.get(ind.key, {})
        if ind.tape and d.get("available"):
            tape.append({"key": ind.key, "label": ind.label.replace(" (PAX Gold token)", ""), "value": d["value"],
                         "display": _fmt(ind, d["value"]),
                         "change": r1(d["change_1d"]) if ind.transform == "pct" else (round(d["change_1d"], 2) if d["change_1d"] is not None else None),
                         "change_unit": "%" if ind.transform == "pct" else ind.unit, "direction": ind.direction,
                         "date": d["date"], "source": ind.source.upper() if ind.source == "fred" else ind.source.capitalize(),
                         "weather": weather_label(d["stress"])})

    gconf = round(sum(cls_conf[k] * ASSET_CLASSES[k]["weight"] for k in cls_conf) / sum(ASSET_CLASSES[k]["weight"] for k in cls_conf))
    dominant = max(((k, v) for k, v in last.items()), key=lambda kv: kv[1])
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated,
        "as_of": cls.index[-1].strftime("%Y-%m-%d"),
        "product": {"name": "StormDesk", "byline": "by Aman", "full_name": "StormDesk by Aman"},
        "global": {
            "score": r1(gnow), "weather": weather_label(gnow), "confidence": gconf,
            "raw_weighted": r1(glob["raw"].iloc[-1]), "contagion_adj": r1(glob["contagion_adj"].iloc[-1]),
            "breadth": r1(glob["breadth"].iloc[-1] * 100), "delta_5d": r1(gnow - glob["global"].iloc[-6]),
            "delta_20d": r1(gnow - glob["global"].iloc[-21]), "dominant": {"key": dominant[0], "title": ASSET_CLASSES[dominant[0]]["title"], "score": r1(dominant[1])},
            "percentile_since_2015": r1((glob["global"].dropna() <= gnow).mean() * 100),
        },
        "regime": reg,
        "forecast": forecasts["global"],
        "correlation": {"avg_abs_corr": round(float(corr["avg_abs_corr"].iloc[-1]), 3), "percentile": r1(C_now),
                        "series": _series_payload(corr["C"], SPARK_DAYS)},
        "scores": {"global": r1(gnow), **{k: r1(v) for k, v in last.items()}, "trade": trade_score,
                   "event": event_payload["event_risk_score"]},
        "asset_classes": asset_classes,
        "indicators": indicators_out,
        "market_tape": tape,
        "alerts": alerts,
        "history": {
            "dates": [d.strftime("%Y-%m-%d") for d in hist_idx],
            "global": _series_payload(glob["global"], HISTORY_DAYS),
            "classes": {k: _series_payload(cls[k], HISTORY_DAYS) for k in cls.columns},
            "correlation": _series_payload(corr["C"], HISTORY_DAYS),
            "regimes": analytics.regime_history(cls, glob["global"], corr["C"], HISTORY_DAYS),
        },
        "long_history": {  # weekly, since 2015, for the backtest view
            "dates": [d.strftime("%Y-%m-%d") for d in glob["global"].resample("W-FRI").last().dropna().index],
            "global": [round(float(v), 1) for v in glob["global"].resample("W-FRI").last().dropna().values],
        },
        "scenarios": scen,
        "event_risk": event_payload,
        "source_status": {s["key"]: s["status"] for s in health_payload["sources"]} | {"errors": [e for s in statuses for e in s.get("errors", [])][:20]},
        "methodology": {
            "indicator_formula": "0.40 percentile + 0.25 momentum + 0.20 volatility + 0.10 correlation + 0.05 news",
            "component_weights": scoring.COMPONENT_WEIGHTS,
            "class_weights": {k: v["weight"] for k, v in ASSET_CLASSES.items()},
            "confidence_formula": "0.40 freshness + 0.25 source reliability + 0.20 completeness + 0.15 fetch stability",
            "source_reliability": SOURCE_RELIABILITY,
            "global_formula": "confidence-free weighted mean of asset classes + contagion adjustment (up to +6 for correlation above its 60th percentile, up to +6 for breadth of classes in Storm Watch or worse)",
            "weather_bands": weather_bands_payload(),
            "windows": {"percentile": "756 trading days (~3 years)", "momentum": "20 trading days", "volatility": "20 trading days", "correlation": "60 trading days"},
        },
    }

    write_json(PUBLIC_DATA / "latest_snapshot.json", snapshot)
    write_json(PUBLIC_DATA / "country_vulnerability.json", country_payload)
    write_json(PUBLIC_DATA / "trade_corridors.json", corridor_payload)
    write_json(PUBLIC_DATA / "event_risk.json", event_payload)
    write_json(PUBLIC_DATA / "data_health.json", health_payload)
    log.update({"finished_at": now_iso(), "seconds": round(time.time() - t0, 1), "status": "ok",
                "global": r1(gnow), "weather": weather_label(gnow), "health": health_payload["summary"]})
    write_json(PUBLIC_DATA / "pipeline_run_log.json", log)
    print(json.dumps({"global": r1(gnow), "weather": weather_label(gnow), "regime": reg["name"],
                      "health": health_payload["summary"]["overall_health"],
                      "sources": {s['key']: s['status'] for s in health_payload['sources']}}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
