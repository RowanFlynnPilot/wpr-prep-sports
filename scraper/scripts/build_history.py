"""
Build compact head-to-head history files from archived seasons.

Reads every data/archive/<season>/<sport>/games.json and distills final
games into data/history/<sport>.json — a matchup-keyed index the
frontend fetches on demand from GamePage. The full archive (45MB+) is
excluded from the Pages deploy; these derived files are the sellable
"last year against this team" surface at a few hundred KB total.

Matchup keys pair the two sides sorted, each side keyed by school_id
when tracked or "name:<normalized>" otherwise — mirrors the frontend's
side-keying in GamePage/HeadToHead so lookups agree on both ends.

Run after each season's rollover_season.py (idempotent, safe to re-run):
    .venv/Scripts/python.exe scripts/build_history.py
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_DIR = REPO_ROOT / "data" / "archive"
HISTORY_DIR = REPO_ROOT / "data" / "history"


def norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).casefold()


def side_key(side: dict) -> str:
    return side.get("school_id") or f"name:{norm_name(side.get('name', ''))}"


def pair_key(game: dict) -> str:
    return "|".join(sorted((side_key(game["home"]), side_key(game["away"]))))


def compact(game: dict, season: str) -> dict:
    def side(s: dict) -> dict:
        return {
            "school_id": s.get("school_id") or None,
            "name": s.get("name"),
            "score": s.get("score"),
        }

    return {
        "id": game.get("id"),
        "season": season,
        "date": game.get("date"),
        "home": side(game["home"]),
        "away": side(game["away"]),
        "playoff": bool(game.get("playoff")),
        "playoff_round": game.get("playoff_round"),
        "conference_game": bool(game.get("conference_game")),
    }


def main() -> int:
    if not ARCHIVE_DIR.is_dir():
        print(f"no archive directory at {ARCHIVE_DIR} — nothing to build")
        return 1

    # sport -> pair_key -> list of compact games; sport -> set of seasons
    by_sport: dict[str, dict[str, list[dict]]] = {}
    seasons_by_sport: dict[str, set[str]] = {}

    for season_dir in sorted(ARCHIVE_DIR.iterdir()):
        if not season_dir.is_dir():
            continue
        season = season_dir.name
        for sport_dir in sorted(season_dir.iterdir()):
            games_path = sport_dir / "games.json"
            if not games_path.is_file():
                continue
            sport = sport_dir.name
            games = json.loads(games_path.read_text(encoding="utf-8"))
            kept = 0
            for g in games:
                if g.get("status") != "final":
                    continue
                if g["home"].get("score") is None or g["away"].get("score") is None:
                    continue
                by_sport.setdefault(sport, {}).setdefault(pair_key(g), []).append(
                    compact(g, season)
                )
                kept += 1
            seasons_by_sport.setdefault(sport, set()).add(season)
            print(f"{season}/{sport}: {kept} final games")

    if not by_sport:
        print("no archived games found — nothing written")
        return 1

    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    for sport, matchups in sorted(by_sport.items()):
        for games in matchups.values():
            games.sort(key=lambda g: g["date"], reverse=True)
        out = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "seasons": sorted(seasons_by_sport[sport]),
            "matchups": matchups,
        }
        path = HISTORY_DIR / f"{sport}.json"
        path.write_text(
            json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        size_kb = path.stat().st_size / 1024
        print(f"wrote {path.relative_to(REPO_ROOT)} — {len(matchups)} matchups, {size_kb:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
