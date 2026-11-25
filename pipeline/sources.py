"""Source adapters. Every one is free and needs no key or subscription.

Each fetch_* returns ({indicator_key: pd.Series}, status_dict). Fresh data is merged into
the history store; on failure the stored history is used and the source is marked
"cached" so Data Health reports it honestly.
"""
from __future__ import annotations

import io
import time
import zipfile
from datetime import date, timedelta

import pandas as pd

from . import history
from .common import CACHE_DIR, HISTORY_DIR, http_get, http_json, now_iso
from .registry import FRANKFURTER_CCY, INDICATORS

BACKFILL_START = "2012-01-01"


def _status(key: str, label: str, url: str, cadence: str) -> dict:
    return {"key": key, "label": label, "url": url, "cadence": cadence, "fetched_at": now_iso(),
            "live": [], "cached": [], "failed": [], "errors": []}


def _finish(st: dict) -> dict:
    if st["failed"] and not st["live"] and not st["cached"]:
        st["status"] = "failed"
    elif st["failed"] or (st["cached"] and st["live"]):
        st["status"] = "partial"
    elif st["cached"] and not st["live"]:
        st["status"] = "cached"
    else:
        st["status"] = "live"
    return st


def _start_for(key: str, overlap_days: int = 45) -> str:
    old = history.load(key)
    if old.empty:
        return BACKFILL_START
    return (old.index.max() - pd.Timedelta(days=overlap_days)).strftime("%Y-%m-%d")


# ── FRED (public CSV download, no API key) ────────────────────────────────────

def fetch_fred() -> tuple[dict, dict]:
    st = _status("fred", "FRED (Federal Reserve Bank of St. Louis)", "https://fred.stlouisfed.org/", "daily / weekly")
    out = {}
    for ind in [i for i in INDICATORS if i.source == "fred"]:
        start = _start_for(ind.key)
        url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={ind.source_id}&cosd={start}"
        try:
            text = http_get(url, timeout=40, backoff=4).decode("utf-8", errors="replace")
            df = pd.read_csv(io.StringIO(text))
            if df.shape[1] < 2:
                raise RuntimeError("unexpected CSV shape")
            s = pd.to_numeric(df.iloc[:, 1], errors="coerce")
            s.index = pd.to_datetime(df.iloc[:, 0])
            s = s.dropna()
            if s.empty:
                raise RuntimeError("no observations returned")
            out[ind.key] = history.merge_save(ind.key, s)
            st["live"].append(ind.key)
        except Exception as exc:
            out[ind.key] = history.load(ind.key)
            (st["cached"] if not out[ind.key].empty else st["failed"]).append(ind.key)
            st["errors"].append(f"{ind.source_id}: {exc}")
        time.sleep(0.4)
    return out, _finish(st)


# ── Frankfurter (ECB reference FX rates) ──────────────────────────────────────

def fetch_frankfurter() -> tuple[dict, dict]:
    """All ~30 currencies vs USD in one call. Saves every currency to history (fx_<CCY>)."""
    st = _status("frankfurter", "Frankfurter (ECB reference rates)", "https://frankfurter.dev/", "daily (ECB business days)")
    out = {}
    start = _start_for("fx_INR")
    try:
        data = http_json(f"https://api.frankfurter.dev/v1/{start}..?base=USD", timeout=60)
        rates = data.get("rates", {})
        frame = pd.DataFrame.from_dict(rates, orient="index")
        frame.index = pd.to_datetime(frame.index)
        for ccy in FRANKFURTER_CCY:
            if ccy in frame:
                history.merge_save(f"fx_{ccy}", frame[ccy])
        ok = True
    except Exception as exc:
        st["errors"].append(str(exc))
        ok = False
    for ind in [i for i in INDICATORS if i.source == "frankfurter"]:
        out[ind.key] = history.load(f"fx_{ind.source_id}")
        if out[ind.key].empty:
            st["failed"].append(ind.key)
        else:
            (st["live"] if ok else st["cached"]).append(ind.key)
    return out, _finish(st)


def stored_key(ind) -> str:
    return f"fx_{ind.source_id}" if ind.source == "frankfurter" else ind.key


def load_all_series() -> dict[str, pd.Series]:
    return {i.key: history.load(stored_key(i)) for i in INDICATORS}


def load_fx_all() -> dict[str, pd.Series]:
    return {ccy: history.load(f"fx_{ccy}") for ccy in FRANKFURTER_CCY}


# ── CoinGecko (public API, no key) ────────────────────────────────────────────

def fetch_coingecko() -> tuple[dict, dict]:
    st = _status("coingecko", "CoinGecko public API", "https://www.coingecko.com/en/api", "daily (365-day window, stored beyond)")
    out = {}
    for ind in [i for i in INDICATORS if i.source == "coingecko"]:
        url = (f"https://api.coingecko.com/api/v3/coins/{ind.source_id}/market_chart"
               "?vs_currency=usd&days=365&interval=daily")
        try:
            data = http_json(url, timeout=40, backoff=15)
            prices = data.get("prices") or []
            if not prices:
                raise RuntimeError("no prices")
            s = pd.Series({pd.to_datetime(ts, unit="ms").normalize(): float(v) for ts, v in prices})
            s = s[~s.index.duplicated(keep="last")]
            out[ind.key] = history.merge_save(ind.key, s)
            st["live"].append(ind.key)
        except Exception as exc:
            out[ind.key] = history.load(ind.key)
            (st["cached"] if not out[ind.key].empty else st["failed"]).append(ind.key)
            st["errors"].append(f"{ind.source_id}: {exc}")
        time.sleep(4)
    return out, _finish(st)


# ── GDELT 1.0 daily event files (static downloads, no key, no rate limit) ─────

STRESS_WORDS = [
    "inflation", "recession", "stagflation", "crash", "selloff", "sell-off", "plunge", "slump", "meltdown",
    "default", "bankrupt", "insolven", "bank-run", "bailout", "layoff", "job-cuts", "tariff", "sanction",
    "crisis", "downgrade", "debt-ceiling", "shutdown", "shortage", "oil-price", "price-surge", "volatility",
    "rate-hike", "currency-crisis", "devaluation", "capital-flight", "contagion", "margin-call",
]
GDELT_COUNTRY_FILE = HISTORY_DIR / "gdelt_countries.csv"
GDELT_BACKFILL_DAYS = 90


def _gdelt_day(day: date) -> tuple[dict, pd.DataFrame]:
    url = f"https://data.gdeltproject.org/events/{day:%Y%m%d}.export.CSV.zip"
    raw = http_get(url, timeout=120, retries=2, backoff=5)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        name = zf.namelist()[0]
        df = pd.read_csv(zf.open(name), sep="\t", header=None, usecols=[7, 17, 29, 33, 34, 57],
                         names=["a1", "a2", "quad", "articles", "tone", "url"], dtype={7: str, 17: str},
                         quoting=3, on_bad_lines="skip", low_memory=False)
    df["articles"] = pd.to_numeric(df["articles"], errors="coerce").fillna(1).clip(lower=1)
    df["tone"] = pd.to_numeric(df["tone"], errors="coerce")
    df["quad"] = pd.to_numeric(df["quad"], errors="coerce")
    urls = df["url"].dropna().astype(str).str.lower().drop_duplicates()
    pattern = "|".join(w.replace("-", "[-_]") for w in STRESS_WORDS)
    stress_share = float(urls.str.contains(pattern, regex=True).mean() * 100) if len(urls) else float("nan")
    w = df["articles"]
    tone = float((df["tone"] * w).sum() / w[df["tone"].notna()].sum())
    conflict = float((df["quad"] == 4).mean() * 100)
    metrics = {"stress_share": stress_share, "tone": tone, "conflict_share": conflict, "events": int(len(df))}

    # Per-country: events where either actor is that country (CAMEO codes are ISO3 for countries).
    long = pd.concat([
        df[["a1", "tone", "quad", "articles"]].rename(columns={"a1": "iso3"}),
        df[["a2", "tone", "quad", "articles"]].rename(columns={"a2": "iso3"}),
    ])
    long = long[long["iso3"].astype(str).str.fullmatch(r"[A-Z]{3}")]
    long["conflict"] = (long["quad"] == 4).astype(float)
    long["wt"] = long["tone"] * long["articles"]
    g = long.groupby("iso3").agg(events=("tone", "size"), wt=("wt", "sum"), art=("articles", "sum"), conflict=("conflict", "mean"))
    g = g[g["events"] >= 20]
    per_country = pd.DataFrame({
        "date": day.isoformat(), "iso3": g.index, "events": g["events"].values,
        "tone": (g["wt"] / g["art"]).round(3).values, "conflict": (g["conflict"] * 100).round(2).values,
    })
    return metrics, per_country


def fetch_gdelt(max_new_days: int | None = None) -> tuple[dict, dict]:
    st = _status("gdelt", "GDELT 1.0 daily event files", "https://www.gdeltproject.org/data.html", "daily")
    keys = {"stress_share": "news_volume", "tone": "news_tone", "conflict_share": "news_conflict"}
    have = history.load("news_tone")
    today = date.today()
    yesterday = today - timedelta(days=1)
    first = yesterday - timedelta(days=GDELT_BACKFILL_DAYS - 1)
    got = {d.date() for d in have.index}
    # Every missing day in the window, newest first, so a capped run gets the latest news and
    # later runs fill older gaps.
    days = [yesterday - timedelta(days=n) for n in range((yesterday - first).days + 1)]
    days = [d for d in days if d not in got]
    if max_new_days:
        days = days[:max_new_days]
    days.sort()

    rows = {k: {} for k in keys}
    country_frames = []
    for d in days:
        try:
            metrics, per_country = _gdelt_day(d)
            ts = pd.Timestamp(d)
            for k in keys:
                rows[k][ts] = metrics[k]
            country_frames.append(per_country)
        except Exception as exc:
            # Today's/yesterday's file may not be published yet; that is not a failure.
            if d < yesterday:
                st["errors"].append(f"{d}: {exc}")

    out = {}
    for src_key, ind_key in keys.items():
        fresh = pd.Series(rows[src_key], dtype=float)
        out[ind_key] = history.merge_save(ind_key, fresh if not fresh.empty else None)
        up_to_date = not out[ind_key].empty and out[ind_key].index.max().date() >= yesterday - timedelta(days=1)
        if not fresh.empty or (not days and up_to_date):
            st["live"].append(ind_key)
        elif not out[ind_key].empty:
            st["cached"].append(ind_key)
        else:
            st["failed"].append(ind_key)

    if country_frames:
        new = pd.concat(country_frames, ignore_index=True)
        if GDELT_COUNTRY_FILE.exists():
            old = pd.read_csv(GDELT_COUNTRY_FILE)
            new = pd.concat([old, new], ignore_index=True).drop_duplicates(["date", "iso3"], keep="last")
        cutoff = (today - timedelta(days=200)).isoformat()
        new = new[new["date"] >= cutoff].sort_values(["date", "iso3"])
        new.to_csv(GDELT_COUNTRY_FILE, index=False)
    st["days_fetched"] = len(country_frames)
    return out, _finish(st)


def load_gdelt_countries() -> pd.DataFrame:
    if GDELT_COUNTRY_FILE.exists():
        return pd.read_csv(GDELT_COUNTRY_FILE)
    return pd.DataFrame(columns=["date", "iso3", "events", "tone", "conflict"])


# ── World Bank (structural indicators, refreshed monthly) ─────────────────────

WB_INDICATORS = {
    "trade_gdp": "NE.TRD.GNFS.ZS",
    "inflation": "FP.CPI.TOTL.ZG",
    "gdp_growth": "NY.GDP.MKTP.KD.ZG",
    "current_account": "BN.CAB.XOKA.GD.ZS",
    "external_debt_gni": "DT.DOD.DECT.GN.ZS",
    "reserves_months": "FI.RES.TOTL.MO",
}
WB_CACHE = CACHE_DIR / "worldbank.json"
WB_TTL_DAYS = 30


def fetch_worldbank() -> tuple[dict, dict]:
    """One bulk call per indicator (all countries, most recent non-empty value). 6 calls total."""
    import json
    st = _status("worldbank", "World Bank Indicators API", "https://data.worldbank.org/", "annual (re-checked monthly)")
    cache = {}
    if WB_CACHE.exists():
        cache = json.loads(WB_CACHE.read_text())
        age = (pd.Timestamp.utcnow() - pd.Timestamp(cache.get("fetched_at", "2000-01-01T00:00:00+00:00"))).days
        if age < WB_TTL_DAYS and cache.get("values"):
            st["cached"].append(f"cache {age}d old (refresh every {WB_TTL_DAYS}d)")
            st["fetched_at"] = cache["fetched_at"]
            st = _finish(st)
            st["status"] = "live"  # within its refresh window; annual data
            return cache["values"], st
    values: dict = {}
    for label, code in WB_INDICATORS.items():
        try:
            data = http_json(f"https://api.worldbank.org/v2/country/all/indicator/{code}?format=json&mrnev=1&per_page=400", timeout=60)
            rows = data[1] if isinstance(data, list) and len(data) > 1 else []
            for row in rows or []:
                iso3 = row.get("countryiso3code")
                if iso3 and row.get("value") is not None:
                    values.setdefault(iso3, {})[label] = {"value": row["value"], "year": row.get("date")}
            st["live"].append(label)
        except Exception as exc:
            st["errors"].append(f"{code}: {exc}")
            st["failed"].append(label)
        time.sleep(0.5)
    if values:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        WB_CACHE.write_text(json.dumps({"fetched_at": now_iso(), "values": values}))
    elif cache.get("values"):
        values = cache["values"]
        st["cached"].append("stale cache used")
    return values, _finish(st)


# ── UN Comtrade (free public preview endpoint, no key) ────────────────────────

M49 = {
    "IND": 699, "GBR": 826, "USA": 842, "CHN": 156, "SAU": 682, "DEU": 276, "RUS": 643, "CHL": 152,
    "ZAF": 710, "NGA": 566, "VNM": 704, "JPN": 392, "AUS": 36, "ARE": 784, "KOR": 410, "MEX": 484,
    "BRA": 76, "NLD": 528, "FRA": 251, "CAN": 124, "SGP": 702, "IDN": 360, "TUR": 792,
}
COMTRADE_CACHE = CACHE_DIR / "comtrade.json"
COMTRADE_TTL_DAYS = 30


def fetch_comtrade(queries: list[dict]) -> tuple[dict, dict]:
    """queries: [{id, reporter, partner, cmd}] -> {id: {value, world_total, year}}.

    Uses https://comtradeapi.un.org/public/v1/preview (max 500 records, no key). Annual
    data changes rarely, so results are cached for 30 days.
    """
    import json
    st = _status("comtrade", "UN Comtrade (public preview API)", "https://comtradeplus.un.org/", "annual (re-checked monthly)")
    cache = json.loads(COMTRADE_CACHE.read_text()) if COMTRADE_CACHE.exists() else {}
    fresh_enough = cache.get("fetched_at") and (
        pd.Timestamp.utcnow() - pd.Timestamp(cache["fetched_at"])).days < COMTRADE_TTL_DAYS
    if fresh_enough and all(q["id"] in cache.get("values", {}) for q in queries):
        st["live"] = list(cache["values"].keys())
        st["fetched_at"] = cache["fetched_at"]
        st = _finish(st)
        return cache["values"], st

    base = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
    this_year = date.today().year
    values: dict = {}
    totals: dict = {}

    def query(reporter: int, partner: int, cmd: str):
        for year in (this_year - 1, this_year - 2, this_year - 3):
            url = f"{base}?reporterCode={reporter}&partnerCode={partner}&period={year}&cmdCode={cmd}&flowCode=M"
            data = http_json(url, timeout=40, backoff=5)
            rows = [r for r in data.get("data") or [] if r.get("primaryValue") is not None]
            if rows:
                return float(sum(r["primaryValue"] for r in rows)), year
            time.sleep(1.1)
        return None, None

    for q in queries:
        rep, par = M49.get(q["reporter"]), M49.get(q["partner"])
        if rep is None or par is None:
            st["failed"].append(q["id"])
            st["errors"].append(f"{q['id']}: no M49 code for {q['reporter']} or {q['partner']}")
            continue
        try:
            value, year = query(rep, par, q["cmd"])
            time.sleep(1.1)
            if rep not in totals:
                totals[rep] = query(rep, 0, "TOTAL")
                time.sleep(1.1)
            total, _ = totals[rep]
            if value is None:
                raise RuntimeError("no data for the last three years")
            values[q["id"]] = {"value_usd": value, "year": year, "reporter_total_imports_usd": total,
                               "share_of_reporter_imports": (value / total * 100) if total else None}
            st["live"].append(q["id"])
        except Exception as exc:
            st["errors"].append(f"{q['id']}: {exc}")
            if q["id"] in cache.get("values", {}):
                values[q["id"]] = cache["values"][q["id"]]
                st["cached"].append(q["id"])
            else:
                st["failed"].append(q["id"])
    if values:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        COMTRADE_CACHE.write_text(json.dumps({"fetched_at": now_iso(), "values": values}, indent=1))
    return values, _finish(st)
