"""
Freshness + coverage sentinel. Catches the failure modes nothing else can:
a scrape pipeline that LOOKS healthy (green runs) while a sport's data is
actually unusable.

Two independent checks, for every sport currently in season (month map
below):

1. FRESHNESS — fail when data/<sport>/meta.json's last_updated is older
   than --max-age-hours. Catches a silently frozen dataset: a WIAA markup
   change makes the parser return 0 games, the wipe guard (correctly)
   refuses to overwrite, and last_updated stops moving. The default
   threshold is deliberately generous (7 days against an hourly in-season
   cron) so it never nags about WIAA posting schedules late at season
   edges — anything it does catch is unambiguously wrong.

2. COVERAGE — fail when the sport's dataset references less than
   --min-coverage of the schools the manifest says play it. Freshness
   alone cannot see this: a rolled-over sport gets scraped successfully
   every day, so last_updated keeps moving while the dataset holds almost
   nothing. That is exactly how boys soccer sat at 1 of 21 tracked schools
   for three weeks in July 2026 with every run green — the scraper's wipe
   guard needs *zero* games to trip (it had one) and validate_data.py
   skips its whole regression comparison when meta.season changes, which
   is precisely when a rollover collapse happens.

   Coverage climbs over weeks as WIAA publishes school by school, so the
   floor is generous — it flags "this isn't a season yet", not "this is
   incomplete".

Any input this can't interpret (missing manifest, unreadable games.json)
is a skip, not a failure — the checks above own correctness.

Runs from .github/workflows/sentinel.yml (daily cron). Stdlib-only so
the workflow needs no pip install.

Usage:
  python scraper/scripts/check_freshness.py
  python scraper/scripts/check_freshness.py --max-age-hours 48
  python scraper/scripts/check_freshness.py --min-coverage 0.5
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
MANIFEST_PATH = REPO_ROOT / "scraper" / "config" / "schools.json"

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

# Share of a sport's tracked roster that must appear in its games before we
# call the dataset a season. Generous on purpose: WIAA publishes schedules
# school by school over several weeks, and volleyball sat at 44% mid-rollover
# in July 2026 while filling normally. A sport under a third is not "still
# loading", it's broken or unpublished.
DEFAULT_MIN_COVERAGE = 1 / 3


def _load_json(path: Path):
    """Parsed JSON, or None when missing/unreadable (callers treat as skip)."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _roster_for(manifest, sport: str) -> set[str]:
    """School ids the manifest says play `sport` (conferences are per-sport)."""
    schools = manifest.get("schools") if isinstance(manifest, dict) else manifest
    roster = set()
    for school in schools or []:
        if not isinstance(school, dict):
            continue
        for conf in school.get("conferences") or []:
            if isinstance(conf, dict) and conf.get("sport") == sport and school.get("id"):
                roster.add(school["id"])
    return roster


def check_coverage(sport: str, min_coverage: float) -> str | None:
    """Coverage failure message for `sport`, or None when fine / unknowable."""
    manifest = _load_json(MANIFEST_PATH)
    if manifest is None:
        return None
    roster = _roster_for(manifest, sport)
    if not roster:
        return None  # sport not in the manifest — nothing to measure against

    games = _load_json(DATA_DIR / sport / "games.json")
    if not isinstance(games, list):
        return None  # freshness check owns "dataset missing entirely"

    scheduled = {
        sid
        for game in games
        if isinstance(game, dict)
        for side in ("home", "away")
        if (sid := (game.get(side) or {}).get("school_id")) in roster
    }
    share = len(scheduled) / len(roster)
    marker = "THIN" if share < min_coverage else "ok"
    print(
        f"{sport}: {len(scheduled)}/{len(roster)} tracked schools scheduled "
        f"({share:.0%} coverage, {len(games)} games) [{marker}]"
    )
    if share >= min_coverage:
        return None
    return (
        f"{sport}: only {len(scheduled)}/{len(roster)} tracked schools appear in "
        f"games.json ({share:.0%} < {min_coverage:.0%} floor, {len(games)} games total)"
    )


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
        "--min-coverage",
        type=float,
        default=DEFAULT_MIN_COVERAGE,
        help="minimum share of a sport's tracked roster that must be scheduled (0 disables)",
    )
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
    thin: list[str] = []
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

        # Independent of freshness: a dataset can update daily and still be
        # near-empty right after a season rollover.
        if args.min_coverage > 0:
            gap = check_coverage(sport, args.min_coverage)
            if gap:
                thin.append(gap)

    if not checked and not stale and not thin:
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

    if thin:
        print("\nCOVERAGE CHECK FAILED:")
        for t in thin:
            print(f"  x {t}")
        print(
            "\nLikely causes: a season rollover where WIAA hasn't published the "
            "new schedules yet (expected early in a season — the dataset fills in "
            "as they post), or TeamID re-discovery failing for that sport so the "
            "scraper only found a handful of teams. Confirm against "
            "schools.wiaawi.org before assuming a parser bug; if WIAA genuinely "
            "hasn't posted, this stays open until they do. The frontend already "
            "captions a sport this thin as 'still being published' rather than "
            "showing it as a live season. See docs/operations.md."
        )

    if stale or thin:
        return 1

    print("\nAll in-season sports fresh, with usable coverage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
