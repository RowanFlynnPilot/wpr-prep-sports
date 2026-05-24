"""
Post-process: read data/volleyball/games.json, aggregate per-player
season totals from each game's stat_leaders, and rewrite
data/volleyball/season_stats.json.

Use this when the main scraper has already populated stat_leaders (via
MaxPreps) but the season-stats file is still on the old Bound-team-only
layout — runs in seconds vs. re-scraping the whole season.

Usage:
  cd scraper
  .venv/Scripts/python.exe scripts/aggregate_vb_season_stats.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scraper"))

from models.schema import Dataset, Game, GameStatus, Meta, SeasonStat, Sport  # noqa: E402
from transform.stats import aggregate_volleyball_season_stats  # noqa: E402

DATA_DIR = REPO_ROOT / "data" / "volleyball"


def main() -> int:
    games_path = DATA_DIR / "games.json"
    season_path = DATA_DIR / "season_stats.json"
    meta_path = DATA_DIR / "meta.json"

    if not games_path.exists():
        print(f"missing {games_path}")
        return 1

    with games_path.open(encoding="utf-8") as f:
        raw_games = json.load(f)
    games_list = raw_games if isinstance(raw_games, list) else raw_games.get("games", [])
    games = [Game.model_validate(g) for g in games_list]

    # Build a minimal Dataset shim; aggregator only reads meta.sport, games, and season_stats.
    meta = Meta(
        last_updated=datetime.now(timezone.utc),
        season=games[0].season if games else "2025-26",
        sport=Sport.VOLLEYBALL,
        sports_included=[Sport.VOLLEYBALL],
        sources_used=["wiaa", "maxpreps"],
    )
    existing_season: list[SeasonStat] = []
    if season_path.exists():
        try:
            existing_raw = json.loads(season_path.read_text(encoding="utf-8"))
            for r in existing_raw:
                # Skip volleyball rows — we're regenerating; preserve other sports if any.
                try:
                    existing_season.append(SeasonStat.model_validate(r))
                except Exception:  # noqa: BLE001
                    continue
        except Exception:  # noqa: BLE001
            pass

    ds = Dataset(
        meta=meta,
        schools=[],
        games=games,
        standings=[],
        season_stats=existing_season,
    )

    ds = aggregate_volleyball_season_stats(ds)

    vb_rows = [r for r in ds.season_stats if r.sport == Sport.VOLLEYBALL]
    print(f"Writing {len(vb_rows)} aggregated volleyball season-stat rows")
    season_path.write_text(
        json.dumps([r.model_dump(mode="json") for r in ds.season_stats], indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
