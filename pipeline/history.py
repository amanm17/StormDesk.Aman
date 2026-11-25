"""History store: one CSV per indicator in data/history/, committed to git.

Each run merges the freshly fetched window into the stored series, so history keeps
growing past what a free API will return in one call (CoinGecko gives 365 days,
GDELT 3 months). If a source fails, the stored series is used and marked as cached.
"""
from __future__ import annotations

import pandas as pd

from .common import HISTORY_DIR


def path_for(key: str):
    return HISTORY_DIR / f"{key}.csv"


def load(key: str) -> pd.Series:
    p = path_for(key)
    if not p.exists():
        return pd.Series(dtype=float, name=key)
    df = pd.read_csv(p, parse_dates=["date"])
    s = pd.Series(df["value"].values, index=pd.DatetimeIndex(df["date"]), name=key, dtype=float)
    return s.sort_index()


def merge_save(key: str, fresh: pd.Series | None) -> pd.Series:
    old = load(key)
    if fresh is None or fresh.dropna().empty:
        return old
    fresh = fresh.dropna().astype(float)
    fresh.index = pd.DatetimeIndex(fresh.index).normalize()
    combined = pd.concat([old, fresh]) if not old.empty else fresh.copy()
    combined = combined[~combined.index.duplicated(keep="last")].sort_index()
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    out = pd.DataFrame({"date": combined.index.strftime("%Y-%m-%d"), "value": combined.values})
    out.to_csv(path_for(key), index=False, float_format="%.6g")
    combined.name = key
    return combined
