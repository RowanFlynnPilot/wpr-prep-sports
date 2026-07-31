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

Coverage-regression gate (hard failures, exit 1):
  Compares the working tree against the same files at git HEAD — in CI
  that's "what this scrape produced" vs "what's currently published".
  A structurally-valid dataset whose coverage collapsed (games halved,
  stat lines gone, standings emptied) means a source broke upstream,
  not that the season went quiet; it must not ship. Skipped per sport
  when meta.season changed (rollover legitimately resets counts), when
  the sport has no HEAD version (new sport), or when git isn't
  available. Bypass explicitly with --no-regression when hand-repairing
  data.

Usage:
  cd scraper
  python scripts/validate_data.py            # all sports found in data/
  python scripts/validate_data.py --sport volleyball
  python scripts/validate_data.py --no-regression   # skip HEAD comparison
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scraper"))

from output.writer import load_full_games_raw  # noqa: E402
from transform.stats import _school_name_slug, _slug_matches_school_name  # noqa: E402

DATA_DIR = REPO_ROOT / "data"

CORE_FIELDS = ("id", "sport", "season", "date", "home", "away", "status")

# Hard-fail when more than this % of games-with-stats carry duplicate
# (team, player, category) keys. The known cross-attach tail is ~1%;
# the dedupe regressions this is meant to catch hit 50%+.
DUP_GAME_PCT_MAX = 3.0

# --- Coverage-regression thresholds (vs git HEAD) -------------------------
# Games can legitimately shrink a little (WIAA reschedules, de-dupes) but
# not collapse. Only enforced once HEAD had a meaningful baseline so
# preseason noise never trips it.
GAMES_COLLAPSE_RATIO = 0.5
GAMES_BASELINE_MIN = 20
# Stat lines only grow during a season; a wholesale drop means a stats
# source broke or a re-attach regressed. The zero-threshold catches the
# classic "source down → 0 lines merged" case.
LINES_ZERO_BASELINE_MIN = 100
LINES_COLLAPSE_RATIO = 0.5
LINES_COLLAPSE_BASELINE_MIN = 500


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
            (
                line.get("team_school_id") or line.get("team_name") or "",
                line.get("category") or "",
            )
            for line in full
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
        names = (g["home"]["name"], g["away"]["name"])
        for line in g.get("stat_leaders") or []:
            seen[
                (
                    line.get("team_school_id") or line.get("team_name"),
                    line.get("player_name"),
                    line.get("category"),
                )
            ] += 1
            tn = line.get("team_name") or ""
            # Tolerant compare — "St. Mary Catholic" (MaxPreps) on a
            # "Saint Mary Catholic" (WIAA) game is the same school, not
            # a misattached line.
            if tn not in names and not any(
                _slug_matches_school_name(_school_name_slug(tn), n) for n in names
            ):
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


# ---------------------------------------------------------------------------
# Coverage regression vs git HEAD
# ---------------------------------------------------------------------------


def _git_show_json(rel_path: str):
    """Return the parsed JSON of `rel_path` as of git HEAD, or None when
    unavailable (not a repo, file didn't exist at HEAD, git missing)."""
    try:
        out = subprocess.run(
            ["git", "show", f"HEAD:{rel_path}"],
            cwd=REPO_ROOT,
            capture_output=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    try:
        return json.loads(out.stdout.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _line_total(slim_games: list) -> int:
    return sum(g.get("stat_line_count") or 0 for g in slim_games if isinstance(g, dict))


def check_regression(sport_dir: Path) -> list[str]:
    """Compare the working-tree dataset against HEAD. Returns hard-failure
    messages (empty = pass). Conservative by design: any state it can't
    interpret (missing HEAD file, unparseable JSON, season change) is a
    skip, not a failure — validate_sport() owns structural correctness."""
    sport = sport_dir.name
    rel = f"data/{sport}"

    old_meta = _git_show_json(f"{rel}/meta.json")
    new_meta = _read_json(sport_dir / "meta.json")
    if not isinstance(old_meta, dict) or not isinstance(new_meta, dict):
        return []
    if old_meta.get("season") != new_meta.get("season"):
        print(
            f"{sport}: regression check skipped — season rolled "
            f"{old_meta.get('season')} -> {new_meta.get('season')}"
        )
        return []

    old_games = _git_show_json(f"{rel}/games.json")
    new_games = _read_json(sport_dir / "games.json")
    if not isinstance(old_games, list) or not isinstance(new_games, list):
        return []

    errors: list[str] = []

    if (
        len(old_games) >= GAMES_BASELINE_MIN
        and len(new_games) < len(old_games) * GAMES_COLLAPSE_RATIO
    ):
        errors.append(
            f"{sport}: games collapsed {len(old_games)} -> {len(new_games)} vs HEAD "
            f"(>{int((1 - GAMES_COLLAPSE_RATIO) * 100)}% drop) — source/parser regression?"
        )

    old_lines = _line_total(old_games)
    new_lines = _line_total(new_games)
    if old_lines >= LINES_ZERO_BASELINE_MIN and new_lines == 0:
        errors.append(
            f"{sport}: stat lines collapsed {old_lines} -> 0 vs HEAD - stats source down?"
        )
    elif old_lines >= LINES_COLLAPSE_BASELINE_MIN and new_lines < old_lines * LINES_COLLAPSE_RATIO:
        errors.append(
            f"{sport}: stat lines collapsed {old_lines} -> {new_lines} vs HEAD "
            f"(>{int((1 - LINES_COLLAPSE_RATIO) * 100)}% drop)"
        )

    old_standings = _git_show_json(f"{rel}/standings.json")
    new_standings = _read_json(sport_dir / "standings.json")
    if isinstance(old_standings, list) and isinstance(new_standings, list):
        old_rows = sum(len(s.get("rows") or []) for s in old_standings if isinstance(s, dict))
        new_rows = sum(len(s.get("rows") or []) for s in new_standings if isinstance(s, dict))
        if old_rows > 0 and new_rows == 0:
            errors.append(f"{sport}: standings emptied ({old_rows} rows -> 0) vs HEAD")

    old_season = _git_show_json(f"{rel}/season_stats.json")
    new_season = _read_json(sport_dir / "season_stats.json")
    if isinstance(old_season, list) and isinstance(new_season, list):
        has_finals = any(isinstance(g, dict) and g.get("status") == "final" for g in new_games)
        if old_season and not new_season and has_finals:
            errors.append(
                f"{sport}: season_stats emptied ({len(old_season)} rows -> 0) vs HEAD "
                f"with final games present - stats source down?"
            )

    if errors:
        print(f"{sport}: REGRESSION vs HEAD — see failures below")
    return errors


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sport", action="append", help="sport id(s); default = all in data/")
    p.add_argument(
        "--no-regression",
        action="store_true",
        help="skip the git-HEAD coverage comparison (deliberate repairs/backfills)",
    )
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
        if not args.no_regression:
            all_errors.extend(check_regression(sport_dir))

    if all_errors:
        print("\nVALIDATION FAILED:")
        for e in all_errors:
            print(f"  x {e}")
        return 1
    print("\nAll sports pass validation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
