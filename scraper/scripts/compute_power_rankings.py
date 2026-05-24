"""
Post-process: compute power rankings for every saved sport's dataset
and write `data/<sport>/power_rankings.json`. Use when the main
scraper has already produced games.json but the rankings file is
missing or stale (e.g., the rankings code landed after the last
scrape).

Usage:
  cd scraper
  .venv/Scripts/python.exe scripts/compute_power_rankings.py
  .venv/Scripts/python.exe scripts/compute_power_rankings.py --sport volleyball
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scraper"))

from config.loader import load_manifest  # noqa: E402
from output.writer import load_prev_rankings, read_dataset, write_dataset  # noqa: E402
from transform.rankings import compute_power_rankings  # noqa: E402

DATA_DIR = REPO_ROOT / "data"
SPORTS = [
    "football",
    "boys_basketball",
    "girls_basketball",
    "volleyball",
    "boys_hockey",
    "girls_hockey",
]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sport", action="append", help="Limit to one sport (repeatable).")
    args = p.parse_args()

    manifest = load_manifest()
    sports = args.sport or SPORTS

    for sport in sports:
        ds = read_dataset(sport, DATA_DIR)
        if ds is None:
            print(f"[{sport}] no dataset on disk — skipping")
            continue
        prev = load_prev_rankings(sport, DATA_DIR)
        ds = compute_power_rankings(ds, manifest=manifest, prev_rankings=prev)
        write_dataset(ds, DATA_DIR)
        top = ", ".join(
            f"#{r.rank} {r.school_name} ({r.wins}-{r.losses})"
            for r in ds.power_rankings[:5]
        )
        print(f"[{sport}] {len(ds.power_rankings)} teams ranked. Top 5: {top}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
