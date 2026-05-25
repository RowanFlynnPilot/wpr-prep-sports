"""
Post-process: re-run the MaxPreps merge against the existing dataset
for any sport with MP coverage (volleyball, football, basketball).

Backfills new fields (set_scores, full-roster stat lines) without a
full WIAA rescrape. Pre-cleans any MP-sourced data already on disk so
stale cross-attachments from prior buggy runs get wiped before the
fresh merge.

Usage:
  cd scraper
  .venv/Scripts/python.exe scripts/refresh_maxpreps.py            # every MP sport
  .venv/Scripts/python.exe scripts/refresh_maxpreps.py --sport football
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scraper"))

from rich.console import Console  # noqa: E402

from config.loader import load_manifest  # noqa: E402
from output.writer import load_prev_rankings, read_dataset, write_dataset  # noqa: E402
from transform.normalize import build_name_index_for_manifest  # noqa: E402
from transform.rankings import compute_power_rankings  # noqa: E402
from transform.stats import (  # noqa: E402
    aggregate_volleyball_season_stats,
    merge_maxpreps_stats,
)

DATA_DIR = REPO_ROOT / "data"
MP_SPORTS = ["volleyball", "football", "boys_basketball", "girls_basketball"]


def refresh(sport: str, console: Console, manifest) -> bool:
    ds = read_dataset(sport, DATA_DIR)
    if ds is None:
        console.print(f"[yellow]{sport}: no dataset on disk — skipping[/yellow]")
        return False
    # For volleyball, Bound is effectively empty, so clearing all stat
    # lines on games marked maxpreps-sourced is safe and lets us re-
    # populate cleanly (catches stale cross-attachments from prior
    # bugs). For football/basketball, both Bound + MP contribute and
    # we can't tell per-line which source wrote which key — so we
    # trust the dedupe in _attach_maxpreps_stats and only clear
    # set_scores (which Bound never writes).
    cleared = 0
    for g in ds.games:
        if "maxpreps" in g.sources:
            if sport == "volleyball":
                g.stat_leaders = []
            g.set_scores = []
            g.sources = [s for s in g.sources if s != "maxpreps"]
            cleared += 1
    console.print(f"[dim]{sport}: pre-cleaned MP data from {cleared} games[/dim]")

    name_to_id = build_name_index_for_manifest(manifest)
    ds = merge_maxpreps_stats(
        ds, manifest=manifest, name_to_id=name_to_id,
        season=ds.meta.season, console=console,
    )
    if sport == "volleyball":
        ds = aggregate_volleyball_season_stats(ds, console=console)
    prev = load_prev_rankings(sport, DATA_DIR)
    ds = compute_power_rankings(
        ds, manifest=manifest, prev_rankings=prev, console=console,
    )
    write_dataset(ds, DATA_DIR)
    console.print(f"[green]{sport}: refreshed[/green]")
    return True


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--sport",
        action="append",
        choices=MP_SPORTS,
        help="Limit to one sport (repeatable). Default: every MP sport.",
    )
    args = p.parse_args()

    console = Console()
    manifest = load_manifest()
    sports = args.sport or MP_SPORTS

    for sport in sports:
        refresh(sport, console, manifest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
