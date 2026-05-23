"""
wpr-prep-sports scraper entry point.

Orchestrates data collection from multiple sources, normalizes into the
canonical schema, and writes JSON to ../data/.

Usage:
    python main.py --sport football --season 2025-26
    python main.py --all-sports --season 2025-26
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from rich.console import Console

from output.writer import write_dataset
from sources import bound, wiaa
from transform.normalize import build_dataset

console = Console()

DATA_DIR = Path(__file__).parent.parent / "data"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape central WI HS sports data")
    parser.add_argument(
        "--sport",
        type=str,
        help="Sport to scrape (e.g. football, basketball). Omit with --all-sports.",
    )
    parser.add_argument(
        "--all-sports",
        action="store_true",
        help="Scrape all in-season sports.",
    )
    parser.add_argument(
        "--season",
        type=str,
        default="2025-26",
        help="Season identifier (e.g. 2025-26).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run scrapers but do not write output.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.sport and not args.all_sports:
        console.print("[red]Must specify --sport or --all-sports[/red]")
        return 1

    sports = ["football"] if args.sport == "football" else [args.sport] if args.sport else [
        "football", "boys_basketball", "girls_basketball", "volleyball",
    ]

    console.print(f"[bold]Scraping[/bold] sports={sports} season={args.season}")

    raw_data = []
    for sport in sports:
        console.print(f"  → [cyan]{sport}[/cyan] from Bound...")
        try:
            raw_data.extend(bound.fetch(sport=sport, season=args.season))
        except Exception as e:
            console.print(f"    [yellow]Bound failed: {e}[/yellow]")

        console.print(f"  → [cyan]{sport}[/cyan] from WIAA ScoreCenter (verification)...")
        try:
            raw_data.extend(wiaa.fetch(sport=sport, season=args.season))
        except Exception as e:
            console.print(f"    [yellow]WIAA failed: {e}[/yellow]")

    console.print(f"Collected [bold]{len(raw_data)}[/bold] raw records")

    dataset = build_dataset(raw_data, season=args.season)

    if args.dry_run:
        console.print("[yellow]Dry run — not writing[/yellow]")
        console.print(dataset)
        return 0

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_dataset(dataset, DATA_DIR)
    console.print(f"[green]Wrote dataset to {DATA_DIR}[/green]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
