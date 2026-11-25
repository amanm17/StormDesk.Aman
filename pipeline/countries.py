"""Country weather: structural vulnerability (World Bank) + live market and news overlays.

stress = 0.50 structural + 0.20 exposure + 0.20 currency + 0.10 news   (weights re-normalised
         when a part is unavailable)

structural  World Bank: trade openness, inflation, growth, current account, external debt, reserves
exposure    the global asset-class scores this country is most exposed to (oil import, USD debt, ...)
currency    stress score of the country's own currency vs USD (Frankfurter), else its region's average
news        GDELT: the country's last-7-day news tone and conflict share vs its own recent history
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .common import PUBLIC_DATA, clamp, read_json, weather_label
from .registry import Indicator
from .scoring import combine, components

EURO = {"AUT", "BEL", "HRV", "CYP", "EST", "FIN", "FRA", "DEU", "GRC", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT",
        "NLD", "PRT", "SVK", "SVN", "ESP", "MCO", "SMR", "VAT", "AND", "MNE", "XKX"}
CCY = {"AUS": "AUD", "BGR": "BGN", "BRA": "BRL", "CAN": "CAD", "CHE": "CHF", "LIE": "CHF", "CHN": "CNY",
       "CZE": "CZK", "DNK": "DKK", "GRL": "DKK", "FRO": "DKK", "GBR": "GBP", "HKG": "HKD", "HUN": "HUF",
       "IDN": "IDR", "ISR": "ILS", "IND": "INR", "BTN": "INR", "ISL": "ISK", "JPN": "JPY", "KOR": "KRW",
       "MEX": "MXN", "MYS": "MYR", "NOR": "NOK", "NZL": "NZD", "PHL": "PHP", "POL": "PLN", "ROU": "RON",
       "SWE": "SEK", "SGP": "SGD", "THA": "THB", "TUR": "TRY", "ZAF": "ZAR", "LSO": "ZAR", "NAM": "ZAR",
       **{iso: "EUR" for iso in EURO}}

DM = {"USA", "GBR", "CAN", "AUS", "NZL", "JPN", "CHE", "NOR", "SWE", "DNK", "DEU", "FRA", "NLD", "BEL", "AUT",
      "FIN", "IRL", "ESP", "ITA", "PRT", "SGP", "KOR", "ISR", "LUX", "ISL", "HKG"}
USD_DEBT = {"ARG", "TUR", "EGY", "PAK", "LKA", "GHA", "KEN", "NGA", "ZAF", "IDN", "PHL", "VNM", "BGD", "IND",
            "MEX", "BRA", "COL", "CHL", "PER", "UKR", "ZMB", "ETH", "ECU", "SLV", "TUN", "MNG", "LAO"}
OIL_IMPORT = {"IND", "CHN", "JPN", "KOR", "PAK", "BGD", "LKA", "NPL", "PHL", "THA", "TUR", "MAR", "ZAF", "EGY",
              "JOR", "LBN", "KEN", "ETH", "DEU", "FRA", "ITA", "ESP", "GBR", "TWN", "SGP", "UKR"}
OIL_EXPORT = {"SAU", "ARE", "QAT", "KWT", "IRQ", "IRN", "OMN", "BHR", "RUS", "NOR", "NGA", "AGO", "DZA", "LBY",
              "VEN", "KAZ", "AZE"}
FOOD_IMPORT = {"EGY", "LBN", "JOR", "YEM", "SOM", "ETH", "KEN", "BGD", "PAK", "NPL", "LKA", "TUN", "MAR", "NGA",
               "SDN", "HTI"}
CRYPTO = {"SLV", "NGA", "KEN", "TUR", "ARG", "VEN", "UKR", "PHL", "VNM", "IND"}

FX_IND = Indicator("fx_country", "Currency vs USD", "frankfurter", "", None, "up", "pct", "rate")


def _scale(v, low, high, invert=False, neutral=50.0):
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    x = (v - low) / (high - low) * 100
    return clamp(100 - x if invert else x)


def structural(wb: dict) -> tuple[float | None, list[str], int]:
    get = lambda k: (wb.get(k) or {}).get("value")  # noqa: E731
    parts = {
        "trade": (_scale(get("trade_gdp"), 20, 140), 0.13),
        "inflation": (_scale(get("inflation"), 0, 20), 0.22),
        "growth": (_scale(get("gdp_growth"), -5, 8, invert=True), 0.18),
        "current": (_scale(-get("current_account") if get("current_account") is not None else None, -10, 15), 0.20),
        "debt": (_scale(get("external_debt_gni"), 10, 120), 0.13),
        "reserves": (_scale(get("reserves_months"), 1, 12, invert=True), 0.14),
    }
    have = {k: v for k, v in parts.items() if v[0] is not None}
    drivers = []
    labels = {"trade_gdp": "Trade openness {:.0f}% of GDP", "inflation": "Inflation {:.1f}%",
              "gdp_growth": "GDP growth {:.1f}%", "current_account": "Current account {:+.1f}% of GDP",
              "external_debt_gni": "External debt {:.0f}% of GNI", "reserves_months": "Reserves {:.1f} months of imports"}
    for k, fmt in labels.items():
        if get(k) is not None:
            yr = (wb.get(k) or {}).get("year")
            drivers.append(fmt.format(float(get(k))) + (f" ({yr})" if yr else ""))
    if not have:
        return None, ["World Bank indicators unavailable."], 0
    tw = sum(w for _, w in have.values())
    return sum(s * w for s, w in have.values()) / tw, drivers, len(have)


def currency_stress(fx_all: dict[str, pd.Series]) -> dict[str, float]:
    out = {}
    for ccy, s in fx_all.items():
        if s is None or s.dropna().shape[0] < 200:
            continue
        c = components(s, FX_IND)
        v = combine({"P": c["P"], "M": c["M"], "V": c["V"]}).iloc[-1]
        if not math.isnan(v):
            out[ccy] = float(v)
    return out


def news_stress(g: pd.DataFrame) -> dict[str, dict]:
    out = {}
    if g.empty:
        return out
    g = g.copy()
    g["date"] = pd.to_datetime(g["date"])
    last = g["date"].max()
    for iso, grp in g.groupby("iso3"):
        grp = grp.sort_values("date")
        if len(grp) < 30:
            continue
        recent = grp[grp["date"] > last - pd.Timedelta(days=7)]
        if len(recent) < 4:
            continue
        hist = grp[grp["date"] <= last - pd.Timedelta(days=7)]
        tz = (recent["tone"].mean() - hist["tone"].mean()) / (hist["tone"].std() or 1)
        cz = (recent["conflict"].mean() - hist["conflict"].mean()) / (hist["conflict"].std() or 1)
        score = clamp(50 + 15 * (-tz + cz))
        out[iso] = {"score": round(score, 1), "tone_7d": round(recent["tone"].mean(), 2),
                    "conflict_7d": round(recent["conflict"].mean(), 1), "events_7d": int(recent["events"].sum())}
    return out


def exposure(iso: str, cls: dict) -> tuple[float, list[str]]:
    picks, why = [], []
    def add(k, text):
        if cls.get(k) is not None:
            picks.append(cls[k]); why.append(text)
    if iso in OIL_IMPORT:
        add("commodities", "oil importer")
    if iso in FOOD_IMPORT:
        add("commodities", "food importer")
    if iso in USD_DEBT:
        add("liquidity", "dollar-debt exposure"); add("fx", "dollar-debt exposure")
    if iso in CRYPTO:
        add("crypto", "high crypto adoption")
    if iso in OIL_EXPORT:
        add("liquidity", "oil exporter (revenue tied to global demand)")
    if iso in DM:
        add("bonds", "deep bond market"); add("equities", "large equity market")
    elif not picks:
        add("fx", "emerging-market currency sensitivity")
    if not picks:
        return cls.get("global", 50.0), ["global backdrop"]
    return float(np.mean(picks)), sorted(set(why))


def build(wb_values: dict, cls_latest: dict, fx_all: dict, gdelt_countries: pd.DataFrame, generated_at: str) -> dict:
    coords = read_json(PUBLIC_DATA / "country_coordinates.json", {}).get("countries", [])
    fx_scores = currency_stress(fx_all)
    news = news_stress(gdelt_countries)
    region_fx: dict[str, list[float]] = {}
    for c in coords:
        ccy = CCY.get(c["iso3"])
        if ccy in fx_scores and c["iso3"] not in DM:
            region_fx.setdefault(c.get("subregion") or c.get("region"), []).append(fx_scores[ccy])

    out = []
    for c in coords:
        iso = c["iso3"]
        wb = wb_values.get(iso, {})
        s_struct, s_drivers, n_wb = structural(wb)
        if n_wb < 3:  # too little World Bank data to call it structural evidence
            s_struct = None
        s_exp, exp_why = exposure(iso, cls_latest)
        ccy = CCY.get(iso)
        if ccy in fx_scores:
            s_fx, fx_note = fx_scores[ccy], f"{ccy} vs USD"
        elif region_fx.get(c.get("subregion") or c.get("region")):
            s_fx, fx_note = float(np.mean(region_fx[c.get("subregion") or c.get("region")])), "regional currencies vs USD"
        elif iso == "USA":
            s_fx, fx_note = None, None
        else:
            s_fx, fx_note = cls_latest.get("fx"), "global FX pressure"
        s_news = news.get(iso, {}).get("score")
        parts = {"structural": (s_struct, 0.50), "exposure": (s_exp, 0.20), "currency": (s_fx, 0.20), "news": (s_news, 0.10)}
        have = {k: v for k, v in parts.items() if v[0] is not None}
        tw = sum(w for _, w in have.values())
        stress = sum(s * w for s, w in have.values()) / tw if tw else 50.0
        conf = round(0.6 * (30 + 65 * n_wb / 6) + 0.4 * (100 * (len(have) - 1) / 3))
        thin = s_struct is None
        if thin:
            # Without structural data the score is mostly global backdrop: pull it toward the
            # global reading and flag it, rather than ranking a data gap as a storm.
            stress = 0.5 * stress + 0.5 * cls_latest.get("global", 50.0)
            conf = min(conf, 45)
        drivers = []
        if s_fx is not None:
            drivers.append(f"Currency stress {s_fx:.0f} ({fx_note})")
        drivers.append(f"Exposure {s_exp:.0f}: {', '.join(exp_why)}")
        if s_news is not None:
            nn = news[iso]
            drivers.append(f"News stress {s_news:.0f}: 7-day tone {nn['tone_7d']}, conflict share {nn['conflict_7d']}%")
        drivers += s_drivers
        out.append({
            **{k: c.get(k) for k in ("iso2", "iso3", "name", "capital", "lat", "lng", "region", "subregion", "population", "flag")},
            "stress": round(stress, 1), "weather": weather_label(stress), "confidence": conf,
            "confidence_label": "High" if conf >= 75 else "Medium" if conf >= 55 else "Low",
            "components": {k: (round(v[0], 1) if v[0] is not None else None) for k, v in parts.items()},
            "data_quality": "thin" if thin else "ok",
            "currency": ccy, "news": news.get(iso), "drivers": drivers[:9],
            "source": "World Bank + Frankfurter + GDELT + StormDesk asset scores",
            "status": "structural + market + news",
            "indicators": wb,
        })
    return {
        "generated_at": generated_at,
        "source": "World Bank Indicators, Frankfurter (ECB), GDELT 1.0 events, StormDesk asset-class scores",
        "count": len(out),
        "note": "Country weather = 50% structural vulnerability, 20% exposure to stressed asset classes, 20% currency stress, 10% news stress.",
        "weights": {"structural": 0.5, "exposure": 0.2, "currency": 0.2, "news": 0.1},
        "countries": out,
    }
