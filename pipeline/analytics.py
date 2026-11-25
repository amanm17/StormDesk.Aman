"""Forecast (stress projection, not price prediction), regime, alerts and scenario grids."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .common import weather_label
from .registry import ASSET_CLASSES, BY_KEY, INDICATORS
from .scoring import class_scores, global_score, score_latest_with_shock

HORIZONS = {"1w": 5, "1m": 20}


def ordinal(n: float) -> str:
    n = int(round(n))
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


# ── Forecast: AR(1) mean reversion + damped momentum, with an honest backtest ─

def _fit_ar1(x: np.ndarray) -> tuple[float, float, float]:
    mu = float(np.mean(x))
    a, b = x[:-1] - mu, x[1:] - mu
    phi = float(np.clip(np.dot(a, b) / max(np.dot(a, a), 1e-9), 0.0, 0.995))
    resid = b - phi * a
    return mu, phi, float(np.std(resid))


def _project(x: np.ndarray, h: int) -> tuple[float, float]:
    mu, phi, sigma = _fit_ar1(x)
    ew = pd.Series(x).ewm(halflife=5).mean().to_numpy()
    slope = (ew[-1] - ew[-11]) / 10 if len(ew) > 11 else 0.0
    damp = sum(0.8 ** i for i in range(1, h + 1))
    mean = mu + phi ** h * (x[-1] - mu) + slope * damp * 0.5
    var_mult = (1 - phi ** (2 * h)) / (1 - phi ** 2) if phi < 0.999 else h
    return float(np.clip(mean, 0, 100)), float(sigma * math.sqrt(var_mult))


def forecast_series(s: pd.Series, lookback: int = 500) -> dict:
    x = s.dropna().to_numpy()[-lookback:]
    if len(x) < 60:
        return {"available": False}
    out = {"available": True, "current": round(float(x[-1]), 1), "method": "AR(1) mean reversion + damped 10-day EWMA momentum"}
    for name, h in HORIZONS.items():
        mean, sd = _project(x, h)
        out[name] = {"mean": round(mean, 1), "low": round(max(0, mean - 1.28 * sd), 1),
                     "high": round(min(100, mean + 1.28 * sd), 1), "weather": weather_label(mean)}
    d = out["1w"]["mean"] - out["current"]
    out["direction"] = "worsening" if d > 2 else "easing" if d < -2 else "steady"

    # Out-of-sample check over the last 250 days: model vs "no change".
    errs, naive = [], []
    xs = s.dropna().to_numpy()
    for t in range(max(260, len(xs) - 250), len(xs) - 5):
        hist = xs[max(0, t - lookback):t]
        if len(hist) < 60:
            continue
        m, _ = _project(hist, 5)
        errs.append(abs(m - xs[t + 4]))
        naive.append(abs(hist[-1] - xs[t + 4]))
    if errs:
        out["backtest"] = {"days": len(errs), "mae_model": round(float(np.mean(errs)), 2),
                           "mae_no_change": round(float(np.mean(naive)), 2)}
    return out


# ── Regime: transparent rules (an HMM can replace this later) ─────────────────

def regime(row: pd.Series, glob: float, C: float) -> dict:
    g = lambda k: float(row.get(k, np.nan)) if not pd.isna(row.get(k, np.nan)) else 0.0  # noqa: E731
    if glob >= 76 and C >= 80:
        name, why = "Crisis", "Global > 75, correlation > 80th pctl"
    elif g("liquidity") >= 65 and g("credit") >= 60:
        name, why = "Liquidity squeeze", "Liquidity ≥ 65, credit ≥ 60"
    elif g("bonds") >= 65 and g("commodities") >= 60:
        name, why = "Inflation / rates shock", "Bonds ≥ 65, commodities ≥ 60"
    elif g("equities") >= 60 and (g("credit") >= 55 or glob >= 55):
        name, why = "Risk-off", "Equities ≥ 60 with credit ≥ 55 or global ≥ 55"
    elif glob < 35:
        name, why = "Calm", "Global < 35"
    else:
        name, why = "Mixed", "No rule met"
    return {"name": name, "why": why}


def regime_history(cls: pd.DataFrame, glob: pd.Series, C: pd.Series, days: int = 260) -> list[dict]:
    out = []
    for d in cls.index[-days:]:
        out.append({"date": d.strftime("%Y-%m-%d"), "regime": regime(cls.loc[d], glob.loc[d], C.loc[d])["name"]})
    return out


# ── Alerts: rule-based, each tied to a data date ──────────────────────────────

def build_alerts(detail: dict, cls: pd.DataFrame, glob: pd.Series, C: pd.Series, events: list[dict],
                 health_sources: list[dict]) -> list[dict]:
    alerts = []

    def add(sev, cat, date, text, key=None):
        alerts.append({"severity": sev, "category": cat, "date": date, "text": text, "key": key})

    last, prev = glob.index[-1], glob.index[-6] if len(glob) > 6 else glob.index[0]
    gl_now, gl_prev = weather_label(glob.iloc[-1]), weather_label(glob.loc[prev])
    if gl_now != gl_prev:
        worse = glob.iloc[-1] > glob.loc[prev]
        add("high" if worse else "low", "global", last.strftime("%Y-%m-%d"),
            f"Global: {gl_prev} → {gl_now}, {glob.loc[prev]:.0f} → {glob.iloc[-1]:.0f} in 5d")
    for k in cls.columns:
        now, before = cls[k].iloc[-1], cls[k].loc[prev]
        if pd.isna(now) or pd.isna(before):
            continue
        if weather_label(now) != weather_label(before) and abs(now - before) >= 5:
            title = ASSET_CLASSES[k]["title"]
            add("high" if now > before and now >= 61 else "medium" if now > before else "low", k,
                last.strftime("%Y-%m-%d"),
                f"{title}: {weather_label(before)} → {weather_label(now)}, {before:.0f} → {now:.0f} in 5d", k)
    for key, d in detail.items():
        if not d.get("available"):
            continue
        ind = BY_KEY[key]
        if d.get("stress") is not None and d["stress"] >= 80 and (d.get("P") or 0) >= 90:
            lp = d.get("level_percentile")
            where = {"up": f"{ordinal(lp)} pctl (3y)" if lp is not None else "top decile (3y)",
                     "down": f"{ordinal(lp)} pctl (3y)" if lp is not None else "bottom decile (3y)",
                     "abs": "20d move in top decile (3y)"}[ind.direction]
            add("high", ind.asset_class, d["date"], f"{ind.label}: {where} · stress {d['stress']:.0f}", key)
        z = d.get("z")
        if z is not None and abs(z) >= 2:
            unit = "%" if ind.transform == "pct" else "pp" if ind.unit == "%" else f" {ind.unit}"
            add("medium" if abs(z) < 3 else "high", ind.asset_class, d["date"],
                f"{ind.label} {d['change_20d']:+.2f}{unit} in 20d ({abs(z):.1f}σ)", key)
    if C.iloc[-1] >= 85:
        add("high", "contagion", last.strftime("%Y-%m-%d"),
            f"Cross-market correlation: {ordinal(C.iloc[-1])} pctl")
    for e in events:
        if 0 <= e["days_until"] <= 3:
            add("medium", "event", e["date"], f"{e['event']} in {e['days_until']}d")
    for s in health_sources:
        if s["status"] in ("failed", "stale"):
            add("medium", "data", s.get("latest_observation") or "", f"{s['label']}: {s['health'].lower()}")
    order = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda a: (order[a["severity"]], a["date"] or ""), reverse=False)
    alerts.sort(key=lambda a: order[a["severity"]])
    return alerts[:25]


# ── Scenario Lab: pre-computed response grids ─────────────────────────────────

SCENARIOS = [
    {"id": "oil", "label": "Oil price", "unit": "%", "steps": [-40, -20, -10, 0, 10, 20, 30, 50],
     "map": {"wti": 1.0, "brent": 1.0, "oil_vol": 0.25}, "note": "WTI = Brent; OVX +0.25 pt per 1%"},
    {"id": "us10y", "label": "US 10Y yield", "unit": "bp", "steps": [-100, -50, -25, 0, 25, 50, 100, 150],
     "map": {"us10y": 0.01, "us2y": 0.006, "breakeven10y": 0.003, "curve10y3m": 0.01}, "note": "2Y β 0.6; 3M fixed"},
    {"id": "usd", "label": "US dollar (broad)", "unit": "%", "steps": [-6, -3, 0, 2, 4, 6, 10],
     "map": {"usd_broad": 1.0, "usdinr": 0.6, "usdcny": 0.4, "usdbrl": 1.3, "usdzar": 1.4, "usdmxn": 1.2,
             "usdidr": 0.8, "usdkrw": 1.0, "eurusd": 0.9, "usdjpy": 0.9, "usdgbp": 0.9}, "note": "EM FX β 0.4–1.4"},
    {"id": "vix", "label": "VIX", "unit": "pts", "steps": [-10, -5, 0, 5, 10, 20, 30],
     "map": {"vix": 1.0, "oil_vol": 0.4}, "note": "OVX β 0.4"},
    {"id": "credit", "label": "High-yield spread", "unit": "bp", "steps": [-100, -50, 0, 50, 100, 200, 400],
     "map": {"hy_oas": 0.01, "ig_oas": 0.0035, "ccc_oas": 0.025}, "note": "IG β 0.35; CCC β 2.5"},
    {"id": "equity", "label": "S&P 500", "unit": "%", "steps": [-30, -20, -10, -5, 0, 5, 10],
     "map": {"spx": 1.0, "nasdaq": 1.3}, "note": "Nasdaq β 1.3"},
    {"id": "crypto", "label": "Bitcoin", "unit": "%", "steps": [-50, -30, -15, 0, 15, 30],
     "map": {"btc": 1.0, "eth": 1.3}, "note": "ETH β 1.3"},
]


def scenario_grids(series: dict, result: dict) -> list[dict]:
    stress = result["stress"]
    base_last = {k: float(v) for k, v in stress.iloc[-1].dropna().items()}
    C_last = float(result["correlation"]["C"].iloc[-1])
    N = result["news_context"]
    N_last = float(N.iloc[-1]) if N is not None and not pd.isna(N.iloc[-1]) else None
    base_cls = class_scores(pd.DataFrame([base_last]))
    base_glob = float(global_score(base_cls, pd.Series([C_last]))["global"].iloc[0])
    out = []
    for sc in SCENARIOS:
        steps = []
        for step in sc["steps"]:
            shocks = {k: step * beta for k, beta in sc["map"].items()}
            new = score_latest_with_shock(series, shocks, C_last, N_last, base_last) if step else base_last
            cls = class_scores(pd.DataFrame([new]))
            glob = float(global_score(cls, pd.Series([C_last]))["global"].iloc[0])
            steps.append({"shock": step, "global": round(glob, 1),
                          "classes": {k: round(float(v), 1) for k, v in cls.iloc[0].dropna().items()}})
        out.append({**{k: sc[k] for k in ("id", "label", "unit", "note")}, "base_global": round(base_glob, 1),
                    "steps": steps})
    return out
