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
from output.writer import read_dataset, write_dataset
from sources import wiaa, wph
from transform.normalize import build_dataset, build_name_index_for_manifest
from transform.live import merge_live_scores
from transform.rankings import compute_power_rankings
from transform.stats import (
    build_wph_roster_index,
    aggregate_volleyball_season_stats,
    merge_bound_stats,
    merge_maxpreps_stats,
    merge_team_season_stats,
    merge_wph_per_game_stats,
    merge_wph_season_stats,
)

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
    parser.add_argument(
        "--live",
        action="store_true",
        help=(
            "Live-only mode: skip the full WIAA schedule re-scrape, just "
            "read the existing dataset and merge live scores from "
            "halftime/ScoreCenter. ~10s vs ~5min for a full scrape."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.sport not in wiaa.SSID_BY_SPORT:
        console.print(
            f"[red]Unknown sport '{args.sport}'. Known: {sorted(wiaa.SSID_BY_SPORT)}[/red]"
        )
        return 1

    manifest = load_manifest()

    # ---- Live mode: read existing dataset, merge live scores, write back.
    # Skips the full WIAA per-team scrape (5+ min) and the stats merges
    # (also several minutes) — used by the high-frequency cron during
    # game windows.
    if args.live:
        dataset = read_dataset(args.sport, DATA_DIR)
        if dataset is None:
            console.print(
                f"[red]--live requires an existing dataset for {args.sport}; "
                f"run a full scrape first.[/red]"
            )
            return 1
        dataset = merge_live_scores(
            dataset, sport=args.sport, manifest=manifest, console=console,
        )
        # Bump meta.last_updated so the StaleBanner / freshness pill on the
        # frontend reflects the live cron run, not the last full scrape.
        from datetime import datetime, timezone
        dataset.meta.last_updated = datetime.now(timezone.utc)
        if not args.dry_run:
            write_dataset(dataset, DATA_DIR)
            console.print(f"[green]Wrote live updates to {DATA_DIR}[/green]")
        return 0

    console.print(f"[bold]Scraping[/bold] sport={args.sport} season={args.season}")
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

    # Map our internal sport ids to Bound's URL identifiers. Sports not in
    # this map have no Bound integration; stats merge is skipped for them.
    BOUND_SPORT_ABBRS = {
        "football": "fb",
        "boys_basketball": "boysbasketball",
        "girls_basketball": "girlsbasketball",
        "volleyball": "vb",
    }
    # Sports that pull stats from wisconsinprephockey.net instead. Bound
    # publishes WI hockey scores but not per-team stats pages.
    WPH_SPORTS = {"boys_hockey", "girls_hockey"}

    sport_abbr = BOUND_SPORT_ABBRS.get(args.sport)
    if not args.no_stats and sport_abbr:
        name_to_id = build_name_index_for_manifest(manifest)
        dataset = merge_bound_stats(
            dataset,
            name_to_id=name_to_id,
            sport_abbr=sport_abbr,
            console=console,
        )
        dataset = merge_team_season_stats(
            dataset,
            manifest=manifest,
            sport=args.sport,
            sport_abbr=sport_abbr,
            console=console,
        )
        # MaxPreps augments volleyball where Bound's central-WI coverage
        # is effectively absent. Per-game stat leaders only for now;
        # season stats stay Bound-sourced (team-only rows) until MaxPreps
        # season-stats parsing is wired in.
        if args.sport == "volleyball":
            dataset = merge_maxpreps_stats(
                dataset,
                manifest=manifest,
                name_to_id=name_to_id,
                season=args.season,
                console=console,
            )
            # Roll per-game MP stats up into per-player season totals so
            # TopPerformers shows real player leaderboards (MP's own
            # season-leader panel goes empty off-season).
            dataset = aggregate_volleyball_season_stats(
                dataset, console=console,
            )
    elif not args.no_stats and args.sport in WPH_SPORTS:
        subseason = wph.SUBSEASONS.get((args.sport, args.season))
        roster_index = (
            build_wph_roster_index(
                manifest, subseason=subseason, season=args.season, console=console,
            )
            if subseason is not None
            else None
        )
        name_to_id = build_name_index_for_manifest(manifest)
        dataset = merge_wph_per_game_stats(
            dataset,
            manifest=manifest,
            sport=args.sport,
            roster_index=roster_index,
            name_to_id=name_to_id,
            console=console,
        )
        dataset = merge_wph_season_stats(
            dataset,
            manifest=manifest,
            sport=args.sport,
            roster_index=roster_index,
            console=console,
        )

    # Power rankings run last — they need finalized scores + any post-
    # processing already applied. Cheap (in-memory only).
    dataset = compute_power_rankings(dataset, manifest=manifest, console=console)

    if args.dry_run:
        console.print("[yellow]Dry run — not writing files[/yellow]")
        return 0

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_dataset(dataset, DATA_DIR)
    console.print(f"[green]Wrote dataset to {DATA_DIR}[/green]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
