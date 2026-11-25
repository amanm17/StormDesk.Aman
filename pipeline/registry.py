"""Indicator registry: every signal StormDesk scores, where it comes from and how to read it.

direction
  up    higher values mean more stress (VIX, credit spreads, USD vs EM currency)
  down  lower values mean more stress (equity index, yield-curve spread, crypto price)
  abs   large moves either way mean stress (bond yields, major FX pairs)
transform
  pct   changes measured in percent (prices, FX)
  diff  changes measured in units (yields, spreads, index levels like VIX)
freq
  d daily, w weekly (windows are scaled so 20 trading days ~ 4 weeks)

Sources are all free and keyless: FRED public CSV, Frankfurter (ECB reference rates),
CoinGecko public API, GDELT DOC API.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Indicator:
    key: str
    label: str
    source: str            # fred | frankfurter | coingecko | gdelt
    source_id: str
    asset_class: str | None
    direction: str
    transform: str
    unit: str
    freq: str = "d"
    weight: float = 1.0
    display: str = "{:,.2f}"
    tape: bool = False      # show on the market tape
    note: str = ""
    tags: tuple = field(default_factory=tuple)
    win: tuple | None = None  # (momentum k, vol window, percentile window, min obs) override


ASSET_CLASSES = {
    "bonds": {"title": "Bonds", "weight": 0.15},
    "credit": {"title": "Credit", "weight": 0.14},
    "equities": {"title": "Equities", "weight": 0.14},
    "liquidity": {"title": "Liquidity", "weight": 0.14},
    "fx": {"title": "FX Pressure", "weight": 0.12},
    "commodities": {"title": "Commodities", "weight": 0.10},
    "crypto": {"title": "Crypto", "weight": 0.08},
    "news": {"title": "Macro News", "weight": 0.08},
    # Trade is scored from the corridor model (annual Comtrade + country layer); shown beside the
    # global index but not inside it, because it has no daily history.
    "trade": {"title": "Trade Weather", "weight": 0.0},
}

I = Indicator
INDICATORS: list[Indicator] = [
    # Bonds and rates
    I("us10y", "US 10Y Treasury yield", "fred", "DGS10", "bonds", "abs", "diff", "%", display="{:.2f}%", tape=True),
    I("us2y", "US 2Y Treasury yield", "fred", "DGS2", "bonds", "abs", "diff", "%", display="{:.2f}%"),
    I("curve10y3m", "10Y minus 3M curve", "fred", "T10Y3M", "bonds", "down", "diff", "pp", display="{:.2f}pp", tape=True,
      note="Inversion (negative) has preceded most US recessions."),
    I("breakeven10y", "10Y breakeven inflation", "fred", "T10YIE", "bonds", "abs", "diff", "%", weight=0.6, display="{:.2f}%"),
    # Credit
    I("hy_oas", "US high-yield spread", "fred", "BAMLH0A0HYM2", "credit", "up", "diff", "%", weight=1.3, display="{:.2f}%", tape=True),
    I("ig_oas", "US investment-grade spread", "fred", "BAMLC0A0CM", "credit", "up", "diff", "%", display="{:.2f}%"),
    I("ccc_oas", "US CCC & lower spread", "fred", "BAMLH0A3HYC", "credit", "up", "diff", "%", weight=0.7, display="{:.2f}%"),
    # Equities
    I("spx", "S&P 500", "fred", "SP500", "equities", "down", "pct", "index", display="{:,.0f}", tape=True),
    I("nasdaq", "Nasdaq Composite", "fred", "NASDAQCOM", "equities", "down", "pct", "index", display="{:,.0f}"),
    I("vix", "VIX volatility index", "fred", "VIXCLS", "equities", "up", "diff", "pts", weight=1.4, display="{:.1f}", tape=True),
    # Liquidity and funding
    I("stlfsi", "St. Louis Fed financial stress", "fred", "STLFSI4", "liquidity", "up", "diff", "index", freq="w", weight=1.2, display="{:.2f}"),
    I("nfci", "Chicago Fed financial conditions", "fred", "NFCI", "liquidity", "up", "diff", "index", freq="w", display="{:.2f}"),
    I("usd_broad", "Broad US dollar index", "fred", "DTWEXBGS", "liquidity", "up", "pct", "index", display="{:.1f}", tape=True,
      note="Dollar strength tightens global funding conditions."),
    # Commodities
    I("wti", "WTI crude oil", "fred", "DCOILWTICO", "commodities", "up", "pct", "$/bbl", display="${:.2f}", tape=True),
    I("brent", "Brent crude oil", "fred", "DCOILBRENTEU", "commodities", "up", "pct", "$/bbl", display="${:.2f}"),
    I("oil_vol", "Crude oil volatility (OVX)", "fred", "OVXCLS", "commodities", "up", "diff", "pts", weight=0.8, display="{:.1f}"),
    I("natgas", "Henry Hub natural gas", "fred", "DHHNGSP", "commodities", "abs", "pct", "$/MMBtu", weight=0.5, display="${:.2f}"),
    I("gold", "Gold (PAX Gold token)", "coingecko", "pax-gold", "commodities", "up", "pct", "$/oz", weight=0.8, display="${:,.0f}", tape=True,
      note="Tracks one troy ounce of London gold; used because LBMA prices are no longer free."),
    # FX (USD per unit of local currency moves; 'up' = USD stronger = pressure on that currency)
    I("eurusd", "USD/EUR", "frankfurter", "EUR", "fx", "abs", "pct", "rate", display="{:.4f}"),
    I("usdjpy", "USD/JPY", "frankfurter", "JPY", "fx", "abs", "pct", "rate", display="{:.2f}"),
    I("usdgbp", "USD/GBP", "frankfurter", "GBP", "fx", "abs", "pct", "rate", weight=0.7, display="{:.4f}", tape=True),
    I("usdinr", "USD/INR", "frankfurter", "INR", "fx", "up", "pct", "rate", display="{:.2f}", tape=True),
    I("usdcny", "USD/CNY", "frankfurter", "CNY", "fx", "up", "pct", "rate", display="{:.3f}"),
    I("usdbrl", "USD/BRL", "frankfurter", "BRL", "fx", "up", "pct", "rate", weight=0.7, display="{:.3f}"),
    I("usdzar", "USD/ZAR", "frankfurter", "ZAR", "fx", "up", "pct", "rate", weight=0.7, display="{:.2f}"),
    I("usdmxn", "USD/MXN", "frankfurter", "MXN", "fx", "up", "pct", "rate", weight=0.7, display="{:.2f}"),
    I("usdidr", "USD/IDR", "frankfurter", "IDR", "fx", "up", "pct", "rate", weight=0.6, display="{:,.0f}"),
    I("usdkrw", "USD/KRW", "frankfurter", "KRW", "fx", "up", "pct", "rate", weight=0.6, display="{:,.0f}"),
    # Crypto
    I("btc", "Bitcoin", "coingecko", "bitcoin", "crypto", "down", "pct", "$", weight=1.2, display="${:,.0f}", tape=True),
    I("eth", "Ether", "coingecko", "ethereum", "crypto", "down", "pct", "$", display="${:,.0f}", tape=True),
    # News (GDELT 1.0 daily event files: free, no key, no rate limit)
    I("news_volume", "Economic-stress news share", "gdelt", "stress_share", "news", "up", "diff", "% of stories", display="{:.2f}%", win=(5, 10, 365, 40),
      note="Share of the day's news stories whose links mention inflation, recession, crashes, defaults, layoffs, tariffs and similar terms."),
    I("news_tone", "Global news tone", "gdelt", "tone", "news", "down", "diff", "tone", display="{:.2f}", win=(5, 10, 365, 40),
      note="Article-weighted average tone of all events GDELT coded that day; more negative = more stress."),
    I("news_conflict", "Material-conflict event share", "gdelt", "conflict_share", "news", "up", "diff", "% of events", weight=0.7, win=(5, 10, 365, 40),
      display="{:.1f}%", note="Share of events coded as material conflict (CAMEO quad class 4): a geopolitical-risk proxy."),
]

BY_KEY = {i.key: i for i in INDICATORS}

# Currencies Frankfurter publishes (ECB reference rates). Used for country FX overlays.
FRANKFURTER_CCY = [
    "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS",
    "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB",
    "TRY", "ZAR",
]

# Series used for the cross-market correlation (contagion) signal; all have long daily history.
CORRELATION_SET = ["spx", "nasdaq", "us10y", "hy_oas", "ig_oas", "vix", "usd_broad", "wti", "brent", "eurusd", "usdjpy"]

SOURCE_RELIABILITY = {"fred": 95, "frankfurter": 92, "coingecko": 85, "gdelt": 70}
