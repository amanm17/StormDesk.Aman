"""Scoring engine v2 (primer section 4).

  Indicator stress = 0.40 P + 0.25 M + 0.20 V + 0.10 C + 0.05 N

P  percentile of the level (or of the 20-day move, for 'abs' indicators) over ~3 years
M  momentum: z-score of the 20-day change against its own history, mapped through the normal CDF
V  volatility: percentile of 20-day realised volatility of daily changes
C  cross-market correlation: percentile of the average absolute 60-day correlation across
   core markets (crises make unrelated assets move together)
N  news context: the GDELT news-pressure class score

Missing components are dropped and the remaining weights re-normalised, so a short history
lowers confidence rather than producing a fake number. Everything is computed as a full time
series, so sparklines, forecasts and alerts come from the same numbers as the headline.
"""
from __future__ import annotations

import math
from datetime import date

import numpy as np
import pandas as pd

from .common import clamp, weather_label
from .registry import ASSET_CLASSES, BY_KEY, CORRELATION_SET, INDICATORS, SOURCE_RELIABILITY, Indicator

COMPONENT_WEIGHTS = {"P": 0.40, "M": 0.25, "V": 0.20, "C": 0.10, "N": 0.05}
_erf = np.vectorize(math.erf)


def norm_cdf(z):
    return 0.5 * (1.0 + _erf(np.asarray(z, dtype=float) / math.sqrt(2.0)))


def windows(ind: Indicator) -> dict:
    if ind.win:
        k, vol, W, mn = ind.win
        return {"k": k, "vol": vol, "W": W, "min": mn}
    if ind.freq == "w":
        return {"k": 4, "vol": 8, "W": 156, "min": 26}
    return {"k": 20, "vol": 20, "W": 756, "min": 120}


def rolling_pct(x: pd.Series, W: int, min_periods: int) -> pd.Series:
    return x.rolling(W, min_periods=min_periods).rank(pct=True) * 100.0


def changes(s: pd.Series, ind: Indicator, k: int) -> pd.Series:
    if ind.transform == "pct":
        return s.pct_change(k, fill_method=None) * 100.0
    return s.diff(k)


def components(s: pd.Series, ind: Indicator) -> pd.DataFrame:
    """P, M, V and supporting fields for one indicator on its native frequency."""
    s = s.dropna()
    w = windows(ind)
    chg = changes(s, ind, w["k"])
    daily = changes(s, ind, 1)

    if ind.direction == "abs":
        P = rolling_pct(chg.abs(), w["W"], w["min"])
    elif ind.direction == "up":
        P = rolling_pct(s, w["W"], w["min"])
    else:
        P = 100.0 - rolling_pct(s, w["W"], w["min"])

    mu = chg.rolling(w["W"], min_periods=w["min"]).mean()
    sd = chg.rolling(w["W"], min_periods=w["min"]).std()
    z = (chg - mu) / sd.replace(0, np.nan)
    if ind.direction == "up":
        M = norm_cdf(z) * 100
    elif ind.direction == "down":
        M = norm_cdf(-z) * 100
    else:
        M = (2 * norm_cdf(z.abs()) - 1) * 100
    M = pd.Series(M, index=s.index).where(z.notna())

    vol = daily.rolling(w["vol"], min_periods=max(5, w["vol"] // 2)).std()
    V = rolling_pct(vol, w["W"], w["min"])

    level_pct = rolling_pct(s, w["W"], w["min"])
    return pd.DataFrame({"value": s, "chg": chg, "daily": daily, "z": z, "P": P, "M": M, "V": V,
                         "level_pct": level_pct})


def business_index(series: dict[str, pd.Series], start: str = "2015-01-01") -> pd.DatetimeIndex:
    end = pd.Timestamp(date.today())
    return pd.bdate_range(pd.Timestamp(start), end)


def align(df: pd.DataFrame, idx: pd.DatetimeIndex, freq: str) -> pd.DataFrame:
    limit = 8 if freq == "w" else 10
    return df.reindex(df.index.union(idx)).ffill(limit=limit).reindex(idx)


def correlation_signal(series: dict[str, pd.Series], idx: pd.DatetimeIndex) -> pd.DataFrame:
    frame = pd.DataFrame({k: series[k] for k in CORRELATION_SET if k in series and not series[k].empty})
    frame = frame.reindex(frame.index.union(idx)).ffill(limit=3).reindex(idx)
    rets = pd.DataFrame({k: changes(frame[k], BY_KEY[k], 1) for k in frame})
    cols = list(rets.columns)
    pair_corrs = []
    for a in range(len(cols)):
        for b in range(a + 1, len(cols)):
            pair_corrs.append(rets[cols[a]].rolling(60, min_periods=40).corr(rets[cols[b]]).abs())
    avg = pd.concat(pair_corrs, axis=1).mean(axis=1)
    pct = rolling_pct(avg, 756, 120)
    return pd.DataFrame({"avg_abs_corr": avg, "C": pct})


def combine(parts: dict[str, pd.Series]) -> pd.Series:
    num = None
    den = None
    for name, w in COMPONENT_WEIGHTS.items():
        x = parts.get(name)
        if x is None:
            continue
        has = x.notna().astype(float)
        num = (x.fillna(0) * w) if num is None else num + x.fillna(0) * w
        den = (has * w) if den is None else den + has * w
    out = num / den.replace(0, np.nan)
    # An indicator needs its own evidence (P or M); C and N alone are context, not a score.
    own = parts["P"].notna() | parts["M"].notna()
    return out.where(own).clip(0, 100)


def class_scores(stress: pd.DataFrame, classes=None) -> pd.DataFrame:
    out = {}
    for cls in (classes or ASSET_CLASSES):
        members = [i for i in INDICATORS if i.asset_class == cls and i.key in stress]
        if not members:
            continue
        w = pd.Series({i.key: i.weight for i in members})
        sub = stress[[i.key for i in members]]
        num = (sub * w).sum(axis=1, min_count=1)
        den = (sub.notna() * w).sum(axis=1).replace(0, np.nan)
        out[cls] = num / den
    return pd.DataFrame(out)


def global_score(cls: pd.DataFrame, C: pd.Series) -> pd.DataFrame:
    weights = {k: v["weight"] for k, v in ASSET_CLASSES.items() if k in cls and v["weight"] > 0}
    w = pd.Series(weights)
    sub = cls[list(weights)]
    raw = (sub * w).sum(axis=1, min_count=1) / (sub.notna() * w).sum(axis=1).replace(0, np.nan)
    breadth = (sub >= 61).sum(axis=1) / sub.notna().sum(axis=1).replace(0, np.nan)
    contagion = ((C.fillna(50) - 60).clip(lower=0) / 40.0) * 6.0 + breadth.fillna(0) * 6.0
    g = (raw + contagion).clip(0, 100)
    return pd.DataFrame({"raw": raw, "breadth": breadth, "contagion_adj": contagion, "global": g})


def freshness_score(last_obs: pd.Timestamp | None, freq: str) -> tuple[float, int | None]:
    if last_obs is None or pd.isna(last_obs):
        return 0.0, None
    age = (pd.Timestamp(date.today()) - pd.Timestamp(last_obs).normalize()).days
    ok, dead = (10, 35) if freq == "w" else (4, 21)
    if age <= ok:
        return 100.0, age
    return float(max(0.0, 100.0 * (1 - (age - ok) / (dead - ok)))), age


def indicator_confidence(ind: Indicator, s: pd.Series, fetch_state: str) -> dict:
    s = s.dropna()
    fresh, age = freshness_score(s.index.max() if not s.empty else None, ind.freq)
    reliability = SOURCE_RELIABILITY.get(ind.source, 70)
    need = windows(ind)["W"]
    completeness = min(1.0, len(s) / need) * 100 if len(s) else 0.0
    stability = {"live": 100.0, "cached": 50.0}.get(fetch_state, 0.0)
    conf = 0.40 * fresh + 0.25 * reliability + 0.20 * completeness + 0.15 * stability
    return {"confidence": round(conf), "freshness": round(fresh), "age_days": age,
            "reliability": reliability, "completeness": round(completeness), "fetch": fetch_state}


def run(series: dict[str, pd.Series], fetch_state: dict[str, str]) -> dict:
    """Score everything. Returns frames and per-indicator detail."""
    idx = business_index(series)
    comps: dict[str, pd.DataFrame] = {}
    for ind in INDICATORS:
        s = series.get(ind.key)
        if s is None or s.dropna().empty:
            continue
        comps[ind.key] = align(components(s, ind), idx, ind.freq)

    corr = correlation_signal(series, idx)
    C = corr["C"]

    # Pass 1: news class without N, to provide N to everyone.
    base = {k: combine({"P": c["P"], "M": c["M"], "V": c["V"], "C": C}) for k, c in comps.items()}
    news_base = class_scores(pd.DataFrame(base), ["news"]).get("news")
    N = news_base if news_base is not None else None

    stress = pd.DataFrame({k: combine({"P": c["P"], "M": c["M"], "V": c["V"], "C": C, "N": N})
                           for k, c in comps.items()})
    cls = class_scores(stress)
    glob = global_score(cls, C)

    detail = {}
    for ind in INDICATORS:
        if ind.key not in comps:
            detail[ind.key] = {"key": ind.key, "available": False}
            continue
        raw = series[ind.key].dropna()
        c = components(raw, ind).iloc[-1]
        last_date = raw.index.max()
        conf = indicator_confidence(ind, raw, fetch_state.get(ind.key, "failed"))
        row = stress[ind.key]
        detail[ind.key] = {
            "key": ind.key, "available": True, "date": last_date.strftime("%Y-%m-%d"),
            "value": float(raw.iloc[-1]),
            "change_1d": _f(c["daily"]), "change_20d": _f(c["chg"]), "z": _f(c["z"]),
            "P": _f(c["P"]), "M": _f(c["M"]), "V": _f(c["V"]), "C": _f(C.iloc[-1]),
            "N": _f(N.iloc[-1]) if N is not None else None,
            "level_percentile": _f(c["level_pct"]),
            "stress": _f(row.iloc[-1]), "stress_5d_ago": _f(row.iloc[-6]) if len(row) > 6 else None,
            **conf,
        }
    return {"index": idx, "components": comps, "stress": stress, "classes": cls, "global": glob,
            "correlation": corr, "news_context": N, "detail": detail}


def class_confidence(detail: dict) -> dict:
    out = {}
    for cls in ASSET_CLASSES:
        members = [i for i in INDICATORS if i.asset_class == cls and detail.get(i.key, {}).get("available")]
        if not members:
            continue
        tw = sum(i.weight for i in members)
        out[cls] = round(sum(detail[i.key]["confidence"] * i.weight for i in members) / tw)
    return out


def score_latest_with_shock(series: dict[str, pd.Series], shocks: dict[str, float], C_last: float,
                            N_last: float | None, base_stress_last: dict[str, float]) -> dict[str, float]:
    """Re-score only the shocked indicators with an instantaneous move applied to today's value.

    shocks: {indicator_key: move}, in % for pct indicators and in units for diff indicators.
    """
    out = dict(base_stress_last)
    for key, move in shocks.items():
        ind = BY_KEY.get(key)
        s = series.get(key)
        if ind is None or s is None or s.dropna().empty:
            continue
        s = s.dropna().iloc[-(windows(ind)["W"] + 60):].copy()
        last = s.iloc[-1]
        shocked = last * (1 + move / 100.0) if ind.transform == "pct" else last + move
        s = pd.concat([s, pd.Series([shocked], index=[s.index[-1] + pd.Timedelta(days=1)])])
        c = components(s, ind).iloc[-1]
        parts = {"P": pd.Series([c["P"]]), "M": pd.Series([c["M"]]), "V": pd.Series([c["V"]]),
                 "C": pd.Series([C_last]), "N": pd.Series([N_last]) if N_last is not None else None}
        out[key] = float(combine(parts).iloc[0])
    return out


def _f(x):
    try:
        x = float(x)
        return None if math.isnan(x) else round(x, 3)
    except (TypeError, ValueError):
        return None


__all__ = ["run", "class_confidence", "score_latest_with_shock", "weather_label", "clamp"]
