"""
One-shot migration to the split data layout: rewrite each sport's flat
games.json (stat_leaders inline) as slim games.json + boxscores/ +
players/ detail files. Idempotent — already-split sports pass through
unchanged (their games carry no inline stat_leaders).

Usage:
  cd scraper
  .venv/Scripts/python.exe scripts/split_games_layout.py
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scraper"))

from output.writer import _write_split_games, load_full_games_raw  # noqa: E402

DATA_DIR = REPO_ROOT / "data"


def main() -> int:
    for sport_dir in sorted(DATA_DIR.iterdir()):
        games_path = sport_dir / "games.json"
        if not sport_dir.is_dir() or not games_path.exists():
            continue
        before = games_path.stat().st_size
        games = load_full_games_raw(sport_dir)
        _write_split_games(sport_dir, games)
        after = games_path.stat().st_size
        n_box = (
            len(list((sport_dir / "boxscores").glob("*.json")))
            if (sport_dir / "boxscores").exists()
            else 0
        )
        n_players = (
            len(list((sport_dir / "players").glob("*.json")))
            if (sport_dir / "players").exists()
            else 0
        )
        print(
            f"{sport_dir.name}: games.json {before / 1e6:.1f}MB -> {after / 1e6:.2f}MB | "
            f"{n_box} boxscores | {n_players} player files"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
