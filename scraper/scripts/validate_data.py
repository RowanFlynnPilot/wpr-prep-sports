"""
CI data gate. Runs after every scrape (full + live) and fails the
workflow BEFORE the commit step when the dataset looks structurally
wrong — bad data should never reach the site.

Hard failures (exit 1):
  1. games.json unparseable or games missing core fields.
  2. Split-layout inconsistency: a game's stat_line_count disagrees
     with its boxscores/<id>.json line count, or headline lines point
     at (team, category) pairs absent from the full box score.
  3. Duplicate (game, team, player, category) lines in more than
     DUP_GAME_PCT_MAX of games-with-stats — the historic WPH/MP dedupe
     regressions doubled half the dataset. The known tournament-day
     cross-attach quirk leaves a ~1% tail of conflicting dups
     (two same-day matches merged into one game record), which stays
     below the threshold until that fix lands.
  4. A sport with boxscore files on disk but zero stat lines reachable
     through the merge (reader/writer drift).

Soft signals (printed, never fail):
  - Foreign-line rate: stat lines attributed to a team that isn't the
    game's home or away. Known tournament-day cross-attach quirk sits
    around 20% for volleyball; printed so a regression is visible in
    the workflow log. Tighten to a hard failure once the cross-attach
    fix lands.
  - Per-sport dup-game counts below the threshold.

Usage:
  cd scraper
  python scripts/validate_data.py            # all sports found in data/
  python scripts/validate_data.py --sport volleyball
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scraper"))

from output.writer import load_full_games_raw  # noqa: E402

DATA_DIR = REPO_ROOT / "data"

CORE_FIELDS = ("id", "sport", "season", "date", "home", "away", "status")

# Hard-fail when more than this % of games-with-stats carry duplicate
# (team, player, category) keys. The known cross-attach tail is ~1%;
# the dedupe regressions this is meant to catch hit 50%+.
DUP_GAME_PCT_MAX = 3.0


def validate_sport(sport_dir: Path) -> list[str]:
    """Returns a list of hard-failure messages (empty = pass)."""
    errors: list[str] = []
    sport = sport_dir.name

    try:
        slim = json.loads((sport_dir / "games.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return [f"{sport}: games.json unreadable — {e}"]
    if not isinstance(slim, list):
        return [f"{sport}: games.json is not a list"]

    for g in slim:
        missing = [f for f in CORE_FIELDS if f not in g]
        if missing:
            errors.append(f"{sport}: game {g.get('id', '<no id>')} missing {missing}")
            break  # one structural example is enough

    # Merge boxscores back in; this exercises the same reader the
    # refresh/rankings pipelines use.
    games = load_full_games_raw(sport_dir)
    by_id = {g["id"]: g for g in games}

    box_dir = sport_dir / "boxscores"
    n_boxscores = len(list(box_dir.glob("*.json"))) if box_dir.exists() else 0
    total_lines = sum(len(g.get("stat_leaders") or []) for g in games)
    if n_boxscores > 0 and total_lines == 0:
        errors.append(f"{sport}: {n_boxscores} boxscore files but 0 lines after merge")

    # Split consistency: slim counts + headlines must agree with the
    # merged stat lines.
    mismatches = 0
    headline_orphans = 0
    for s in slim:
        full = by_id.get(s["id"], {}).get("stat_leaders") or []
        declared = s.get("stat_line_count")
        if declared is not None and declared != len(full):
            mismatches += 1
        keys = {
            (l.get("team_school_id") or l.get("team_name") or "", l.get("category") or "")
            for l in full
        }
        for h in s.get("headline_stats") or []:
            hk = (h.get("team_school_id") or h.get("team_name") or "", h.get("category") or "")
            if hk not in keys:
                headline_orphans += 1
    if mismatches:
        errors.append(f"{sport}: stat_line_count disagrees with boxscores on {mismatches} games")
    if headline_orphans:
        errors.append(f"{sport}: {headline_orphans} headline lines not present in boxscores")

    # Duplicate category lines per (game, team, player, category).
    dup_games = set()
    foreign = 0
    for g in games:
        seen = Counter()
        names = {g["home"]["name"], g["away"]["name"]}
        for l in g.get("stat_leaders") or []:
            seen[(l.get("team_school_id") or l.get("team_name"), l.get("player_name"), l.get("category"))] += 1
            if l.get("team_name") not in names:
                foreign += 1
        if any(v > 1 for v in seen.values()):
            dup_games.add(g["id"])
    games_with_stats = sum(1 for g in games if g.get("stat_leaders"))
    dup_pct = 100 * len(dup_games) / games_with_stats if games_with_stats else 0.0
    if dup_pct > DUP_GAME_PCT_MAX:
        errors.append(
            f"{sport}: duplicate (player, category) lines in {len(dup_games)} games "
            f"({dup_pct:.1f}% > {DUP_GAME_PCT_MAX}% threshold, e.g. {sorted(dup_games)[0]})"
        )

    foreign_pct = 100 * foreign / total_lines if total_lines else 0.0
    print(
        f"{sport}: {len(games)} games | {total_lines} stat lines | {n_boxscores} boxscores | "
        f"foreign-line rate {foreign_pct:.1f}% | dup-key games {len(dup_games)} ({dup_pct:.1f}%)"
    )
    return errors


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sport", action="append", help="sport id(s); default = all in data/")
    args = p.parse_args()

    sport_dirs = (
        [DATA_DIR / s for s in args.sport]
        if args.sport
        else sorted(d for d in DATA_DIR.iterdir() if d.is_dir() and (d / "games.json").exists())
    )

    all_errors: list[str] = []
    for sport_dir in sport_dirs:
        if not (sport_dir / "games.json").exists():
            print(f"{sport_dir.name}: no games.json — skipping")
            continue
        all_errors.extend(validate_sport(sport_dir))

    if all_errors:
        print("\nVALIDATION FAILED:")
        for e in all_errors:
            print(f"  ✗ {e}")
        return 1
    print("\nAll sports pass validation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
