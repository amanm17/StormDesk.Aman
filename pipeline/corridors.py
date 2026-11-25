"""Trade weather corridors, weighted by real UN Comtrade values.

stress = 0.30 origin country + 0.30 destination country + 0.25 channel + 0.15 dependency

channel     the asset-class stress the corridor is most exposed to (energy -> commodities, ...)
dependency  this corridor's share of the importer's total goods imports (Comtrade), scaled so a
            12.5% share or more scores 100
"""
from __future__ import annotations

import math

from .common import clamp, weather_label

CORRIDORS = [
    {"id": "ind-gbr-textiles", "from": "IND", "to": "GBR", "commodity": "Textiles and apparel", "commodity_class": "manufactures", "hs": "61,62,63",
     "rationale": "India's apparel and textile exports to the UK; relevant to small exporters."},
    {"id": "chn-usa-electronics", "from": "CHN", "to": "USA", "commodity": "Electronics and machinery", "commodity_class": "manufactures", "hs": "84,85",
     "rationale": "The largest manufactured-goods corridor; tariff and demand sensitive."},
    {"id": "sau-chn-crude", "from": "SAU", "to": "CHN", "commodity": "Crude oil", "commodity_class": "energy", "hs": "2709",
     "rationale": "Energy corridor sensitive to oil and shipping shocks."},
    {"id": "sau-ind-crude", "from": "SAU", "to": "IND", "commodity": "Crude oil", "commodity_class": "energy", "hs": "2709",
     "rationale": "India's oil-import exposure."},
    {"id": "rus-ind-crude", "from": "RUS", "to": "IND", "commodity": "Crude oil", "commodity_class": "energy", "hs": "2709",
     "rationale": "Discounted Russian crude into India; sanction sensitive."},
    {"id": "chl-chn-copper", "from": "CHL", "to": "CHN", "commodity": "Copper", "commodity_class": "metals", "hs": "74,2603",
     "rationale": "Copper corridor tied to China's industrial cycle."},
    {"id": "aus-chn-ironore", "from": "AUS", "to": "CHN", "commodity": "Iron ore", "commodity_class": "metals", "hs": "2601",
     "rationale": "China construction and steel demand."},
    {"id": "zaf-chn-metals", "from": "ZAF", "to": "CHN", "commodity": "Ores and precious metals", "commodity_class": "metals", "hs": "26,71",
     "rationale": "Mining exports with commodity-price sensitivity."},
    {"id": "nga-ind-crude", "from": "NGA", "to": "IND", "commodity": "Crude oil", "commodity_class": "energy", "hs": "2709",
     "rationale": "Oil corridor with FX and shipping sensitivity."},
    {"id": "vnm-usa-apparel", "from": "VNM", "to": "USA", "commodity": "Apparel and electronics", "commodity_class": "manufactures", "hs": "61,62,85",
     "rationale": "Manufacturing exports sensitive to US demand and tariffs."},
    {"id": "jpn-usa-autos", "from": "JPN", "to": "USA", "commodity": "Vehicles", "commodity_class": "manufactures", "hs": "87",
     "rationale": "Japan-US auto corridor."},
    {"id": "deu-usa-machinery", "from": "DEU", "to": "USA", "commodity": "Machinery and vehicles", "commodity_class": "manufactures", "hs": "84,87",
     "rationale": "Europe's largest export market for capital goods."},
    {"id": "are-ind-energy", "from": "ARE", "to": "IND", "commodity": "Oil, gas and gold", "commodity_class": "energy", "hs": "27,71",
     "rationale": "Gulf energy and gold flows into India."},
    {"id": "usa-gbr-financial", "from": "USA", "to": "GBR", "commodity": "Financial and business services", "commodity_class": "services", "hs": None,
     "rationale": "Goods-only data; dependency set to median"},
]

CHANNEL = {
    "energy": ["commodities"],
    "metals": ["commodities", "fx"],
    "manufactures": ["fx", "equities"],
    "services": ["liquidity", "credit"],
}


def comtrade_queries() -> list[dict]:
    return [{"id": c["id"], "reporter": c["to"], "partner": c["from"], "cmd": c["hs"]} for c in CORRIDORS if c["hs"]]


def build(countries: list[dict], cls_latest: dict, comtrade: dict, generated_at: str) -> dict:
    by_iso = {c["iso3"]: c for c in countries}
    shares = sorted(v["share_of_reporter_imports"] for v in comtrade.values() if v.get("share_of_reporter_imports") is not None)
    neutral_dep = clamp(shares[len(shares) // 2] * 8) if shares else 30.0
    rows = []
    for cor in CORRIDORS:
        o, d = by_iso.get(cor["from"]), by_iso.get(cor["to"])
        if not o or not d:
            continue
        chans = [cls_latest[k] for k in CHANNEL[cor["commodity_class"]] if cls_latest.get(k) is not None]
        channel = sum(chans) / len(chans) if chans else 50.0
        ct = comtrade.get(cor["id"])
        share = ct.get("share_of_reporter_imports") if ct else None
        dependency = clamp(share * 8) if share is not None else neutral_dep
        stress = 0.30 * o["stress"] + 0.30 * d["stress"] + 0.25 * channel + 0.15 * dependency
        conf = round(min(o["confidence"], d["confidence"]) * 0.6 + (90 if ct else 45) * 0.4)
        drivers = [
            f"Origin {o['stress']:.0f}",
            f"Destination {d['stress']:.0f}",
            f"Channel {channel:.0f} ({', '.join(CHANNEL[cor['commodity_class']])})",
        ]
        if ct:
            drivers.append(f"${ct['value_usd'] / 1e9:,.1f}bn ({ct['year']}) · {share:.1f}% of imports")
        else:
            drivers.append("No goods value; median dependency")
        rows.append({
            **{k: cor[k] for k in ("id", "from", "to", "commodity", "commodity_class", "rationale")},
            "hs_codes": cor["hs"], "ok": True,
            "from_name": o["name"], "to_name": d["name"], "from_lat": o["lat"], "from_lng": o["lng"],
            "to_lat": d["lat"], "to_lng": d["lng"],
            "origin_stress": o["stress"], "destination_stress": d["stress"], "channel_stress": round(channel, 1),
            "dependency": round(dependency, 1), "trade_value_usd": ct["value_usd"] if ct else None,
            "trade_year": ct["year"] if ct else None, "share_of_importer_imports": round(share, 2) if share is not None else None,
            "stress": round(clamp(stress), 1), "weather": weather_label(stress), "confidence": conf,
            "drivers": drivers, "model": "0.30 origin + 0.30 destination + 0.25 channel + 0.15 dependency",
        })
    rows.sort(key=lambda r: r["stress"], reverse=True)
    weights = [math.log10(1 + (r["trade_value_usd"] or 1e9) / 1e9) + 0.1 for r in rows]
    trade_score = sum(r["stress"] * w for r, w in zip(rows, weights)) / sum(weights) if rows else None
    return {
        "generated_at": generated_at,
        "source": "UN Comtrade public preview API + StormDesk country and asset-class scores",
        "note": "0.30 origin + 0.30 destination + 0.25 channel + 0.15 dependency",
        "corridor_count": len(rows),
        "trade_score": round(trade_score, 1) if trade_score is not None else None,
        "corridors": rows,
    }
