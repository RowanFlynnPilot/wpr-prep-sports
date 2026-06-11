"""
Season rollover: archive the completed season's data before the new
season's scrapes overwrite it.

Copies every sport's data (slim games + boxscores/ + players/ +
standings + season stats + power rankings + meta) into
data/archive/<season>/<sport>/. The live data/<sport>/ files are left
in place — the first 2026-27 scrape replaces them sport by sport, and
the widget keeps showing last season's recap content until then (the
off-season hero handles the framing).

The archive is the substrate for future rivalry/all-time features:
nothing reads it yet, but box scores can't be re-scraped once MaxPreps
and WIAA roll their own pages forward, so preserve them now.

Idempotent: re-running refreshes the archive from current live data,
but refuses to overwrite an archive whose season doesn't match the
live meta (protects against archiving 2026-27 data over the 2025-26
archive after the new season starts).

Usage:
  cd scraper
  .venv/Scripts/python.exe scripts/rollover_season.py            # auto-detect season from meta
  .venv/Scripts/python.exe scripts/rollover_season.py --season 2025-26
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
ARCHIVE_DIR = DATA_DIR / "archive"

# Everything under data/<sport>/ worth preserving. Directories are
# copied recursively (boxscores/, players/).
SPORT_ARTIFACTS = (
    "meta.json",
    "games.json",
    "boxscores",
    "players",
    "standings.json",
    "season_stats.json",
    "power_rankings.json",
    "power_rankings_prev.json",
)


def sport_dirs() -> list[Path]:
    return sorted(
        d
        for d in DATA_DIR.iterdir()
        if d.is_dir() and d.name != "archive" and (d / "games.json").exists()
    )


def live_season(sport_dir: Path) -> str | None:
    meta_path = sport_dir / "meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8")).get("season")
    except (OSError, json.JSONDecodeError):
        return None


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--season", help="season to archive, e.g. 2025-26; default = from meta.json")
    args = p.parse_args()

    dirs = sport_dirs()
    if not dirs:
        print("no sport data found under data/ — nothing to archive")
        return 1

    detected = {live_season(d) for d in dirs} - {None}
    if args.season:
        season = args.season
    elif len(detected) == 1:
        season = detected.pop()
    else:
        print(f"ambiguous live seasons {sorted(detected)} — pass --season explicitly")
        return 1

    archived = 0
    for d in dirs:
        sport_season = live_season(d)
        if sport_season and sport_season != season:
            print(f"skip {d.name}: live data is {sport_season}, archiving {season}")
            continue
        dest = ARCHIVE_DIR / season / d.name
        dest.mkdir(parents=True, exist_ok=True)
        for artifact in SPORT_ARTIFACTS:
            src = d / artifact
            if not src.exists():
                continue
            target = dest / artifact
            if src.is_dir():
                if target.exists():
                    shutil.rmtree(target)
                shutil.copytree(src, target)
            else:
                shutil.copy2(src, target)
        # Root-level schools manifest snapshot — conference membership
        # and mascots drift season to season.
        shutil.copy2(DATA_DIR / "schools.json", ARCHIVE_DIR / season / "schools.json")
        print(f"archived {d.name} -> data/archive/{season}/{d.name}/")
        archived += 1

    print(f"\n{archived} sports archived for {season}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
