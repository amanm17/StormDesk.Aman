"""Shared helpers: paths, HTTP with retries, weather bands, atomic JSON writes.

Everything StormDesk fetches is free and keyless. No paid API, no subscription.
"""
from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA = ROOT / "public" / "data"
HISTORY_DIR = ROOT / "data" / "history"
CACHE_DIR = ROOT / "data" / "cache"
USER_AGENT = "StormDesk-by-Aman/1.0 (open-data financial weather; github.com/amanm17)"


def load_dotenv() -> None:
    """Load optional KEY=VALUE pairs from .env without needing python-dotenv."""
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def http_get(url: str, *, timeout: int = 30, retries: int = 3, backoff: float = 6.0,
             accept: str = "*/*") -> bytes:
    """GET with polite retries. 429/5xx back off exponentially; other 4xx fail fast."""
    last: Exception | None = None
    for attempt in range(retries):
        if attempt:
            time.sleep(backoff * (2 ** (attempt - 1)))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (429, 500, 502, 503, 504):
                break
        except Exception as exc:  # timeouts, DNS, resets
            last = exc
    raise RuntimeError(f"GET failed after {retries} tries: {last}")


def http_json(url: str, **kw) -> Any:
    body = http_get(url, accept="application/json", **kw).decode("utf-8", errors="replace").strip()
    if not body or body[0] not in "[{":
        raise RuntimeError(f"non-JSON response: {body[:120]!r}")
    return json.loads(body)


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return float("nan")
    return max(low, min(high, value))


def r1(value: Any) -> Any:
    try:
        if value is None or math.isnan(float(value)):
            return None
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


# One weather scale for the whole product (primer section 1).
WEATHER_BANDS = [
    (20, "Clear", "Normal conditions; limited evidence of stress."),
    (40, "Cloudy", "Mild pressure; some signals should be watched."),
    (60, "Rain", "Visible stress in one or more areas."),
    (75, "Storm Watch", "Stress is elevated and may be spreading."),
    (90, "Severe Storm", "Multiple systems show significant pressure."),
    (100, "Hurricane", "Extreme stress; systemic conditions possible."),
]


def weather_label(score: float | None) -> str:
    if score is None or (isinstance(score, float) and math.isnan(score)):
        return "No data"
    for upper, label, _ in WEATHER_BANDS:
        if score <= upper:
            return label
    return "Hurricane"


def weather_bands_payload() -> list[dict]:
    lows = [0, 21, 41, 61, 76, 91]
    return [
        {"low": lo, "high": hi, "label": label, "meaning": meaning}
        for lo, (hi, label, meaning) in zip(lows, WEATHER_BANDS)
    ]


def write_json(path: Path, payload: Any) -> None:
    """Write to a temp file then swap, so a crash never leaves a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=1, ensure_ascii=False, allow_nan=False, default=_default))
    tmp.replace(path)


def _default(obj: Any):
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "item"):
        return obj.item()
    raise TypeError(f"not JSON serialisable: {type(obj)}")


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text())
    except Exception:
        return default
