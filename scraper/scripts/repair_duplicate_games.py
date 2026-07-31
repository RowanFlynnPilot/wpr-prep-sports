"""
One-shot repair: merge phantom duplicate games already in published data.

WIAA sometimes lists one physical game twice — a regular row plus the
tournament-bracket row for the same contest — and the normalizer used to
keep both under a "-2" id suffix (that suffix exists for GENUINE
same-day tournament rematches). The phantom double-counts the game
everywhere downstream: two ticker entries, a team page counting one
loss twice, and — when the game was conference-flagged — an off-by-one
conference standings table.

transform.normalize.is_double_listing() now merges these at scrape
time; this script applies the same rule to datasets that won't be
re-scraped (off-season sports, archives). For each merged pair the
survivor keeps the base id, adopts the playoff flag/round from
whichever copy carried it, and keeps whichever copy's stat lines exist.
Standings are rebuilt only when a merged pair was conference-flagged.

Usage (from scraper/):
  python scripts/repair_duplicate_games.py           # report + write
  python scripts/repair_duplicate_games.py --dry-run # report only
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scraper"))

from config.loader import load_manifest  # noqa: E402
from output.writer import read_dataset, write_dataset  # noqa: E402
from transform.normalize import _build_standings, is_double_listing  # noqa: E402

DATA_DIR = REPO_ROOT / "data"

_SUFFIX_RE = re.compile(r"^(?P<base>.+)-(?P<n>[2-9])$")


def repair_sport(sport: str, out_dir: Path, *, manifest, dry_run: bool) -> int:
    dataset = read_dataset(sport, out_dir)
    if dataset is None:
        return 0

    by_id = {g.id: g for g in dataset.games}
    merged = 0
    conference_merge = False

    for dup in list(dataset.games):
        m = _SUFFIX_RE.match(dup.id)
        if not m:
            continue
        base_id = m.group("base")
        base = by_id.get(base_id)
        if base is None or not is_double_listing(base, dup):
            continue

        # Survivor content: the copy that carries stat lines, if exactly
        # one does; the playoff copy knows the round — keep both facts.
        content = dup if (dup.stat_leaders and not base.stat_leaders) else base
        playoff_src = dup if dup.playoff else base
        survivor = content.model_copy(
            update={
                "id": base_id,
                "playoff": playoff_src.playoff,
                "playoff_round": playoff_src.playoff_round,
            }
        )
        dataset.games = [
            survivor if g.id == base_id else g for g in dataset.games if g.id != dup.id
        ]
        by_id = {g.id: g for g in dataset.games}
        merged += 1
        conference_merge = conference_merge or base.conference_game
        print(f"  merged {dup.id} into {base_id} (playoff={survivor.playoff})")

    if merged == 0:
        return 0

    if conference_merge:
        old_tables = {
            s.conference: [(r.school_id, r.conference_wins, r.conference_losses) for r in s.rows]
            for s in dataset.standings
        }
        dataset.standings = _build_standings(
            dataset.games,
            manifest=manifest,
            sport=dataset.meta.sports_included[0],
            season=dataset.meta.season,
        )
        for s in dataset.standings:
            new_rows = [(r.school_id, r.conference_wins, r.conference_losses) for r in s.rows]
            if old_tables.get(s.conference) != new_rows:
                print(f"  standings rebuilt: {s.conference}")

    if dry_run:
        print(f"  (dry run — {out_dir / sport} not written)")
    else:
        write_dataset(dataset, out_dir)
        print(f"  wrote {out_dir / sport}")
    return merged


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    manifest = load_manifest()
    roots = [DATA_DIR]
    archive = DATA_DIR / "archive"
    if archive.exists():
        roots += sorted(d for d in archive.iterdir() if d.is_dir())

    total = 0
    for root in roots:
        for sport_dir in sorted(d for d in root.iterdir() if d.is_dir()):
            if sport_dir.name in {"archive", "digest", "og", "logos"}:
                continue
            if not (sport_dir / "games.json").exists():
                continue
            label = sport_dir.relative_to(REPO_ROOT)
            n = repair_sport(sport_dir.name, root, manifest=manifest, dry_run=args.dry_run)
            if n:
                print(f"{label}: merged {n} phantom duplicate(s)")
                total += n

    print(f"\n{total} phantom duplicate(s) merged." if total else "\nNo phantom duplicates found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
