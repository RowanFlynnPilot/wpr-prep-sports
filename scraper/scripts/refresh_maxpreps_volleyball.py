"""
Post-process: re-run only the MaxPreps merge against the existing
volleyball dataset. Useful when the MaxPreps parser gained new fields
(set_scores, etc.) and we want to backfill without a full WIAA rescrape.

Loads data/volleyball/{games,schools,...} via read_dataset, runs
merge_maxpreps_stats + aggregate_volleyball_season_stats +
compute_power_rankings, and writes everything back.

Usage:
  cd scraper
  .venv/Scripts/python.exe scripts/refresh_maxpreps_volleyball.py
"""

from __future__ import annotations

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


def main() -> int:
    console = Console()
    manifest = load_manifest()
    ds = read_dataset("volleyball", DATA_DIR)
    if ds is None:
        console.print("[red]No volleyball dataset on disk[/red]")
        return 1
    name_to_id = build_name_index_for_manifest(manifest)
    ds = merge_maxpreps_stats(
        ds, manifest=manifest, name_to_id=name_to_id,
        season=ds.meta.season, console=console,
    )
    ds = aggregate_volleyball_season_stats(ds, console=console)
    prev = load_prev_rankings("volleyball", DATA_DIR)
    ds = compute_power_rankings(ds, manifest=manifest, prev_rankings=prev, console=console)
    write_dataset(ds, DATA_DIR)
    console.print("[green]volleyball refreshed[/green]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
