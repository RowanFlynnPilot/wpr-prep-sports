"""
Post-refresh validation. Run after refresh_maxpreps_volleyball.py to
confirm the parser + matching fixes produced correct, complete data.

Checks:
  1. Total stat-line counts per category — should roughly double for
     categories where two-coach games are common (vs the single-team
     pre-fix state).
  2. Coverage of two-team data: how many games carry stats for both
     sides vs only one.
  3. DCE-at-Mosinee 8/26 specifically: set scores should be 26-24,
     18-25, 15-7 (the page the user pointed at). Both teams should
     have their own player stat lines.
  4. Mosinee tournament-day audit: all 4 Mosinee 8/26 games should
     have distinct, correct stat attachments.
  5. Daelyn Rieck spot-check: per-game stat-line counts should be
     ONE per category (no doubles from the historic dedupe bug).
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    games_path = REPO_ROOT / "data" / "volleyball" / "games.json"
    if not games_path.exists():
        print("missing games.json")
        return 1
    raw = json.loads(games_path.read_text(encoding="utf-8"))
    games = raw if isinstance(raw, list) else raw.get("games", [])

    finals = [g for g in games if g.get("status") == "final"]
    mp_games = [g for g in finals if "maxpreps" in (g.get("sources") or [])]
    print(f"Games: {len(finals)} final | {len(mp_games)} carry maxpreps stats")

    # 1. Total stat-line counts per category
    cat_count = Counter()
    for g in mp_games:
        for line in g.get("stat_leaders") or []:
            cat_count[line.get("category")] += 1
    print("\nStat lines by category:")
    for cat, n in cat_count.most_common():
        print(f"  {cat:18} {n}")

    # 2. Two-team coverage
    one_side = 0
    two_side = 0
    for g in mp_games:
        sids = set()
        for line in g.get("stat_leaders") or []:
            sid = line.get("team_school_id")
            if sid:
                sids.add(sid)
        if len(sids) >= 2:
            two_side += 1
        elif len(sids) == 1:
            one_side += 1
    print(
        f"\nCoverage: {two_side} games have BOTH teams' stats | "
        f"{one_side} games have only one team"
    )

    # 3. DCE-Mosinee 8/26 specific
    target = next(
        (g for g in games if g["id"] == "volleyball-2025-08-26-dc-everest-at-mosinee"),
        None,
    )
    print("\nDCE-at-Mosinee 8/26:")
    if target:
        print(f"  set_scores: {target.get('set_scores')}")
        sids = Counter()
        for line in target.get("stat_leaders") or []:
            sids[line.get("team_school_id")] += 1
        print(f"  stat lines per team: {dict(sids)}")
        # Expect ~3+6 Kills, etc. — sum across all categories should
        # roughly match what we extracted earlier (~48 lines).
        print(f"  total stat lines: {sum(sids.values())}")
    else:
        print("  game not found")

    # 4. Mosinee 8/26 tournament audit
    print("\nMosinee 8/26 tournament:")
    for g in games:
        if (
            g["date"].startswith("2025-08-26")
            and (
                g["home"].get("school_id") == "mosinee"
                or g["away"].get("school_id") == "mosinee"
            )
        ):
            sets = g.get("set_scores") or []
            sids = Counter(
                (line.get("team_school_id") or "?")
                for line in (g.get("stat_leaders") or [])
            )
            opp = (
                g["away"]["name"]
                if g["home"].get("school_id") == "mosinee"
                else g["home"]["name"]
            )
            sets_str = (
                ", ".join(f"{s['away']}-{s['home']}" for s in sets) or "(none)"
            )
            print(
                f"  vs {opp:30} sets=[{sets_str}] lines_per_team={dict(sids)}"
            )

    # 5. Daelyn Rieck per-game audit — should be ONE Kills line per
    # game (not doubled).
    print("\nDaelyn Rieck per-game line count:")
    per_game = defaultdict(int)
    per_game_cats = defaultdict(list)
    for g in mp_games:
        for line in g.get("stat_leaders") or []:
            if (
                line.get("team_school_id") == "colby"
                and line.get("player_name") == "Daelyn Rieck"
            ):
                per_game[g["id"]] += 1
                per_game_cats[g["id"]].append(line.get("category"))
    dups = sum(1 for n in per_game.values() if any(
        per_game_cats[g].count(c) > 1 for c in set(per_game_cats[g])
    ) for g in [list(per_game.keys())[0]])
    # simpler dup check:
    n_dup_games = 0
    for game_id, cats in per_game_cats.items():
        counter = Counter(cats)
        if any(v > 1 for v in counter.values()):
            n_dup_games += 1
    print(f"  games she appears in: {len(per_game)}")
    print(f"  games with duplicate category lines: {n_dup_games}")
    if n_dup_games == 0:
        print("  ✓ no duplicates")
    return 0


if __name__ == "__main__":
    sys.exit(main())
