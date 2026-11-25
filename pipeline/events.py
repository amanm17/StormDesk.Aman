"""Event watch: scheduled central-bank decisions (and US data releases if a free FRED key is set).

Event risk is calendar pressure, not a forecast of the outcome.
"""
from __future__ import annotations

import json
import os
import urllib.parse
from datetime import date
from pathlib import Path

from .common import http_json, now_iso

SEED = Path(__file__).with_name("calendar_seed.json")
FRED_RELEASES = {"CPI": (10, 88), "Employment Situation": (50, 88), "GDP": (53, 72), "PCE": (54, 72)}


def _pressure(days: int, importance: float) -> float:
    if days < 0:
        return 0.0
    for limit, mult in ((0, 1.0), (1, 0.9), (3, 0.72), (7, 0.48), (14, 0.26)):
        if days <= limit:
            return importance * mult
    return importance * 0.10


def _label(p: float) -> str:
    return "Storm watch" if p >= 80 else "Rain watch" if p >= 55 else "Cloud watch" if p >= 30 else "Background"


def build() -> tuple[dict, dict]:
    seed = json.loads(SEED.read_text())
    events = list(seed["events"])
    errors = []
    key = os.environ.get("FRED_API_KEY")
    if key:
        for name, (rid, imp) in FRED_RELEASES.items():
            q = urllib.parse.urlencode({"release_id": rid, "api_key": key, "file_type": "json",
                                        "include_release_dates_with_no_data": "true", "sort_order": "desc", "limit": 30})
            try:
                for row in http_json(f"https://api.stlouisfed.org/fred/release/dates?{q}").get("release_dates", []):
                    events.append({"date": row["date"], "region": "US", "source": "FRED release calendar",
                                   "event": f"US {name} release", "importance": imp})
            except Exception as exc:
                errors.append(f"FRED release {name}: {exc}")

    today = date.today()
    built = []
    seen = set()
    for e in events:
        d = (date.fromisoformat(e["date"]) - today).days
        if d < 0 or (e["date"], e["event"]) in seen:
            continue
        seen.add((e["date"], e["event"]))
        p = round(_pressure(d, e["importance"]), 1)
        built.append({**e, "days_until": d, "event_pressure": p, "weather": _label(p)})
    built.sort(key=lambda e: (e["days_until"], -e["importance"]))
    top = built[:8]
    score = round(min(100.0, sum(e["event_pressure"] for e in top) / max(1, min(4, len(top)))), 1)
    within_120 = sum(1 for e in built if e["days_until"] <= 120)
    needs_update = within_120 < 4
    payload = {
        "generated_at": now_iso(),
        "source": "Official central-bank calendars" + (" + FRED release dates" if key else ""),
        "reviewed_on": seed["reviewed_on"],
        "calendar_sources": seed["sources"],
        "event_risk_score": score,
        "event_weather": _label(score),
        "top_events": built[:12],
        "all_upcoming_events": built,
        "needs_update": needs_update,
        "errors": errors,
        "model_note": "Calendar pressure, not an outcome forecast",
    }
    status = {"key": "calendar", "label": "Central-bank calendar", "url": seed["sources"]["Federal Reserve"],
              "cadence": "reviewed twice a year", "fetched_at": now_iso(),
              "status": "stale" if needs_update else "live", "live": [], "cached": [], "failed": [], "errors": errors,
              "note": ("< 4 events in next 120d: update pipeline/calendar_seed.json"
                       if needs_update else f"{within_120} decisions in next 120d · reviewed {seed['reviewed_on']}")}
    return payload, status
