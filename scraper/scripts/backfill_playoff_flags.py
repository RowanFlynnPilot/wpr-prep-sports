"""
One-shot backfill: stamp `playoff` + `playoff_round` onto every game in
data/games.json by date.

Why this exists:
    The scraper now passes WIAA's tournament label through (see
    transform/normalize._parse_playoff_label), but the data we already have
    on disk was scraped before that field was captured. Re-running the full
    scrape just to populate these flags is overkill; the WIAA playoff
    calendar is on fixed weeks, so a date-driven fallback recovers them
    exactly. Future scrapes will use the authoritative WIAA label.

Heuristic:
    For each known season, list the playoff round start dates (Friday of
    each level). A game on or after that date but before the next level's
    start belongs to that level. Anything before the first level start
    stays regular-season (playoff=False).

Run:
    python scraper/scripts/backfill_playoff_flags.py
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

# (start_date, label) sorted ascending. A game on/after `start_date` and
# before the next entry's `start_date` belongs to that round. The last
# entry runs through end-of-season.
WIAA_PLAYOFF_CALENDAR: dict[tuple[str, str], list[tuple[date, str]]] = {
    ("football", "2025-26"): [
        (date(2025, 10, 24), "Level 1"),
        (date(2025, 10, 31), "Level 2"),
        (date(2025, 11, 7), "Level 3"),
        (date(2025, 11, 14), "Level 4"),
        (date(2025, 11, 20), "State Semifinal"),
        (date(2025, 11, 27), "State Championship"),
    ],
}


def classify(game_date: date, sport: str, season: str) -> tuple[bool, str | None]:
    """Return (playoff, round) for a game by date."""
    calendar = WIAA_PLAYOFF_CALENDAR.get((sport, season))
    if not calendar:
        return False, None
    if game_date < calendar[0][0]:
        return False, None
    # Find the latest round whose start_date <= game_date.
    label: str | None = None
    for start, round_label in calendar:
        if start <= game_date:
            label = round_label
        else:
            break
    return True, label


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent.parent
    games_path = repo_root / "data" / "games.json"
    games = json.loads(games_path.read_text(encoding="utf-8"))

    updated = 0
    for g in games:
        try:
            gd = datetime.fromisoformat(g["date"]).date()
        except (KeyError, ValueError):
            continue
        playoff, round_label = classify(gd, g.get("sport", ""), g.get("season", ""))
        # Only write keys when meaningful; keep regular-season games small.
        if g.get("playoff") != playoff:
            g["playoff"] = playoff
            updated += 1
        if g.get("playoff_round") != round_label:
            g["playoff_round"] = round_label
            updated += 1

    games_path.write_text(
        json.dumps(games, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Backfilled {updated} field(s) across {len(games)} games -> {games_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
