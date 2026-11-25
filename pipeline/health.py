"""Data health from content, not file existence: what was fetched live, what fell back to the
stored history, how old the newest observation is, and how much to trust each layer."""
from __future__ import annotations

from .common import now_iso
from .registry import INDICATORS

LEGEND = {
    "live": "Fetched successfully this run",
    "partial": "Some series fetched, some fell back to stored history",
    "cached": "Source failed this run; last stored values used",
    "stale": "Data is older than its normal update cadence",
    "failed": "No data available",
}


def build(statuses: list[dict], detail: dict) -> dict:
    sources = []
    for st in statuses:
        members = [i for i in INDICATORS if i.source == st["key"] and detail.get(i.key, {}).get("available")]
        latest = max((detail[i.key]["date"] for i in members), default=None)
        oldest_age = max((detail[i.key]["age_days"] or 0 for i in members), default=None)
        conf = round(sum(detail[i.key]["confidence"] for i in members) / len(members)) if members else None
        status = st.get("status", "failed")
        stale = [i.key for i in members if (detail[i.key].get("freshness") or 0) < 50]
        if status in ("live", "partial") and members and len(stale) == len(members):
            status = "stale"
        health = {"live": "Live", "partial": "Partly live", "cached": "Using stored history",
                  "stale": "Stale", "failed": "Unavailable"}[status]
        note = st.get("note") or (
            f"{len(st['live'])} live, {len(st['cached'])} from stored history, {len(st['failed'])} failed."
            if (st["live"] or st["cached"] or st["failed"]) else "")
        if stale and status != "stale":
            note += f" Lagging: {', '.join(stale)}."
        sources.append({
            "key": st["key"], "label": st["label"], "url": st.get("url"), "cadence": st.get("cadence"),
            "status": status, "health": health, "confidence": conf if conf is not None else (90 if status == "live" else 40 if status != "failed" else 0),
            "fetched_at": st.get("fetched_at"), "latest_observation": latest, "oldest_age_days": oldest_age,
            "series_live": len(st["live"]), "series_cached": len(st["cached"]), "series_failed": len(st["failed"]),
            "note": note.strip(), "errors": st.get("errors", [])[:6], "layer_type": "free, keyless",
        })
    live = sum(1 for s in sources if s["status"] == "live")
    degraded = sum(1 for s in sources if s["status"] in ("partial", "cached", "stale"))
    failed = sum(1 for s in sources if s["status"] == "failed")
    avg = round(sum(s["confidence"] for s in sources) / len(sources)) if sources else 0
    overall = "Operational" if failed == 0 and degraded <= 1 else "Degraded" if failed <= 1 else "Impaired"
    return {"generated_at": now_iso(),
            "summary": {"live_count": live, "proxy_or_partial_count": degraded, "blocked_or_missing_count": failed,
                        "average_confidence": avg, "overall_health": overall},
            "sources": sources, "legend": LEGEND}
