"""
Freshness sentinel. Catches the failure mode nothing else can: a scrape
pipeline that LOOKS healthy (green runs) while a sport's data silently
freezes — e.g. a WIAA markup change makes the parser return 0 games, the
wipe guard (correctly) refuses to overwrite, and meta.last_updated stops
moving.

For every sport currently in season (month map below), fail when
data/<sport>/meta.json's last_updated is older than --max-age-hours.
The default threshold is deliberately generous (7 days against an hourly
in-season cron) so it never nags about WIAA posting schedules late at
season edges — anything it does catch is unambiguously wrong.

Runs from .github/workflows/sentinel.yml (daily cron). Stdlib-only so
the workflow needs no pip install.

Usage:
  python scraper/scripts/check_freshness.py
  python scraper/scripts/check_freshness.py --max-age-hours 48
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"

# Months (1-12) each sport is expected to receive updates, US Central
# calendar. Edges sit safely INSIDE the real season windows so the age
# threshold, not the month map, decides borderline cases.
IN_SEASON_MONTHS: dict[str, set[int]] = {
    "football": {8, 9, 10, 11},
    "volleyball": {8, 9, 10, 11},
    "boys_soccer": {8, 9, 10, 11},
    "boys_basketball": {11, 12, 1, 2, 3},
    "girls_basketball": {11, 12, 1, 2, 3},
    "boys_hockey": {11, 12, 1, 2, 3},
    "girls_hockey": {11, 12, 1, 2, 3},
    "girls_soccer": {4, 5, 6},
    # Add wrestling here when it launches (winter 2026-27).
}

DEFAULT_MAX_AGE_HOURS = 168  # 7 days


def _parse_ts(raw: str) -> datetime | None:
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--max-age-hours", type=float, default=DEFAULT_MAX_AGE_HOURS)
    p.add_argument(
        "--month",
        type=int,
        choices=range(1, 13),
        help="pretend it's this month (testing the in-season logic)",
    )
    args = p.parse_args()

    now = datetime.now(timezone.utc)
    month = args.month or now.month
    stale: list[str] = []
    checked = 0

    for sport, months in sorted(IN_SEASON_MONTHS.items()):
        if month not in months:
            continue
        meta_path = DATA_DIR / sport / "meta.json"
        if not meta_path.exists():
            # In-season sport with no data at all is its own kind of stale.
            stale.append(f"{sport}: no meta.json on disk")
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            stale.append(f"{sport}: meta.json unreadable - {e}")
            continue
        ts = _parse_ts(meta.get("last_updated") or "")
        if ts is None:
            stale.append(f"{sport}: meta.last_updated missing/unparseable")
            continue
        checked += 1
        age_hours = (now - ts).total_seconds() / 3600
        marker = "STALE" if age_hours > args.max_age_hours else "ok"
        print(
            f"{sport}: last_updated {ts.isoformat()} "
            f"({age_hours:.0f}h old, season {meta.get('season')}) [{marker}]"
        )
        if age_hours > args.max_age_hours:
            stale.append(
                f"{sport}: {age_hours:.0f}h since last update "
                f"(threshold {args.max_age_hours:.0f}h, season {meta.get('season')})"
            )

    if not checked and not stale:
        print(f"No sports in season for month {month} - nothing to check.")
        return 0

    if stale:
        print("\nFRESHNESS CHECK FAILED:")
        for s in stale:
            print(f"  x {s}")
        print(
            "\nLikely causes: scrape cron not firing, repeated scrape failures, "
            "or a source change tripping the wipe guard every run. "
            "See docs/operations.md."
        )
        return 1

    print("\nAll in-season sports fresh.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
