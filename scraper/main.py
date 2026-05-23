"""
wpr-prep-sports scraper entry point.

Reads the school manifest at `config/schools.json`, scrapes WIAA for each
school's per-sport schedule, normalizes into the canonical schema, and
writes JSON to ../data/.

Usage:
    python main.py --sport football --season 2025-26
    python main.py --sport football --season 2025-26 --only wausau-east
    python main.py --sport football --season 2025-26 --dry-run
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from rich.console import Console

from config.loader import ensure_org_ids, load_manifest, save_manifest
from output.writer import write_dataset
from sources import wiaa
from transform.normalize import build_dataset, build_name_index_for_manifest
from transform.stats import merge_bound_stats, merge_team_season_stats

console = Console()

DATA_DIR = Path(__file__).parent.parent / "data"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape central WI HS sports data")
    parser.add_argument("--sport", required=True, help="Sport key, e.g. football")
    parser.add_argument("--season", default="2025-26", help="Season label written to meta.json")
    parser.add_argument(
        "--only",
        action="append",
        help="Limit to specific manifest school ids (repeatable, e.g. --only wausau-east).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Skip writing JSON files.")
    parser.add_argument(
        "--no-persist-manifest",
        action="store_true",
        help="Don't write OrgID discoveries back to schools.json.",
    )
    parser.add_argument(
        "--no-stats",
        action="store_true",
        help="Skip the Bound stats-merge phase (useful for fast iteration).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.sport not in wiaa.SSID_BY_SPORT:
        console.print(
            f"[red]Unknown sport '{args.sport}'. Known: {sorted(wiaa.SSID_BY_SPORT)}[/red]"
        )
        return 1

    console.print(f"[bold]Scraping[/bold] sport={args.sport} season={args.season}")

    manifest = load_manifest()
    console.print(f"Loaded {len(manifest.schools)} schools from manifest")

    targets = manifest.schools
    if args.only:
        wanted = set(args.only)
        targets = [s for s in manifest.schools if s.id in wanted]
        missing = wanted - {s.id for s in targets}
        if missing:
            console.print(f"[yellow]Unknown school id(s): {sorted(missing)}[/yellow]")
        if not targets:
            console.print("[red]No matching schools — aborting.[/red]")
            return 1

    # Backfill any missing OrgIDs.
    needs_lookup = [s for s in targets if s.wiaa_org_id is None]
    if needs_lookup:
        console.print(f"[cyan]Discovering OrgIDs for {len(needs_lookup)} school(s)…[/cyan]")
        ensure_org_ids(manifest, console=console)
        if not args.dry_run and not args.no_persist_manifest:
            save_manifest(manifest)
            console.print("[dim]Persisted OrgID discoveries back to schools.json[/dim]")

    raw_schedules: list[dict] = []
    for school in targets:
        if school.wiaa_org_id is None:
            console.print(f"[yellow]  · {school.id}: skipping (no OrgID)[/yellow]")
            continue
        team_id = wiaa.discover_team_id_for_sport(school.wiaa_org_id, args.sport)
        if team_id is None:
            console.print(
                f"[yellow]  · {school.id}: no {args.sport} team this season[/yellow]"
            )
            continue
        console.print(f"  · {school.id} (TeamID={team_id})")
        sched = wiaa.fetch_team_schedule(team_id)
        sched["_school_id"] = school.id
        raw_schedules.append(sched)
        console.print(f"      {len(sched['games'])} games")

    dataset = build_dataset(
        manifest=manifest,
        raw_team_schedules=raw_schedules,
        sport=args.sport,
        season=args.season,
    )

    console.print(
        f"[green]Built dataset:[/green] "
        f"{len(dataset.games)} games, "
        f"{len(dataset.standings)} conference standings"
    )

    if not args.no_stats and args.sport == "football":
        name_to_id = build_name_index_for_manifest(manifest)
        dataset = merge_bound_stats(dataset, name_to_id=name_to_id, console=console)
        dataset = merge_team_season_stats(
            dataset, manifest=manifest, sport=args.sport, console=console,
        )

    if args.dry_run:
        console.print("[yellow]Dry run — not writing files[/yellow]")
        return 0

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_dataset(dataset, DATA_DIR)
    console.print(f"[green]Wrote dataset to {DATA_DIR}[/green]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
