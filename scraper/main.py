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
import time
from pathlib import Path

from rich.console import Console

from config.loader import ensure_org_ids, load_manifest, save_manifest
from models.schema import GameStatus
from output.writer import load_prev_rankings, read_dataset, write_dataset
from sources import wiaa, wph
from transform.normalize import CENTRAL, build_dataset, build_name_index_for_manifest
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

# Scrape etiquette for the core WIAA loop — same pacing the stats merges
# use (transform/stats.py POLITE_DELAY_SECONDS).
POLITE_DELAY_SECONDS = 0.4

# When more than this fraction of attempted schools fail, abort without
# writing: a dataset missing a third of the region is worse than keeping
# yesterday's. Below the threshold we write what we got and exit
# EXIT_PARTIAL so CI can flag the run without discarding good data.
SCHOOL_FAILURE_ABORT_RATIO = 0.3
EXIT_PARTIAL = 3


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
        dataset, live_updates = merge_live_scores(
            dataset,
            sport=args.sport,
            manifest=manifest,
            console=console,
        )
        # Zero updates → leave the dataset untouched. Off-season this keeps
        # the live cron from producing timestamp-only commits + deploys;
        # in-season freshness is covered by the hourly full scrape.
        if live_updates == 0:
            console.print("[dim]no live updates — dataset unchanged, nothing written[/dim]")
            return 0
        # Bump meta.last_updated so the StaleBanner / freshness pill on the
        # frontend reflects the live cron run, not the last full scrape.
        # Same zone the full scrape stamps (transform/normalize.py) so the
        # two paths write comparable timestamps.
        from datetime import datetime

        dataset.meta.last_updated = datetime.now(CENTRAL)
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
        # A subset scrape must never publish: writing it would replace the
        # sport's full games.json, prune every other game's boxscore and
        # player files, and (under MIN_RANKED_TEAMS) delete a good power-
        # rankings file. --only exists to debug one school's parse, so it
        # implies --dry-run rather than trusting the operator to remember.
        if not args.dry_run:
            console.print(
                "[yellow]--only scrapes a subset — running as --dry-run so it "
                "can't replace the full dataset. Use a full scrape to publish.[/yellow]"
            )
            args.dry_run = True

    # Backfill any missing OrgIDs.
    needs_lookup = [s for s in targets if s.wiaa_org_id is None]
    if needs_lookup:
        console.print(f"[cyan]Discovering OrgIDs for {len(needs_lookup)} school(s)…[/cyan]")
        ensure_org_ids(manifest, console=console)
        if not args.dry_run and not args.no_persist_manifest:
            save_manifest(manifest)
            console.print("[dim]Persisted OrgID discoveries back to schools.json[/dim]")

    raw_schedules: list[dict] = []
    school_failures: list[tuple[str, str]] = []
    attempted = 0
    for school in targets:
        if school.wiaa_org_id is None:
            console.print(f"[yellow]  · {school.id}: skipping (no OrgID)[/yellow]")
            continue
        if attempted:
            time.sleep(POLITE_DELAY_SECONDS)
        attempted += 1
        # One school's broken page / timeout must not abort the whole
        # sport — collect the failure, keep scraping the rest, and let
        # the exit code + CI alerting surface it.
        try:
            team_id = wiaa.discover_team_id_for_sport(school.wiaa_org_id, args.sport)
            if team_id is None:
                console.print(f"[yellow]  · {school.id}: no {args.sport} team this season[/yellow]")
                continue
            console.print(f"  · {school.id} (TeamID={team_id})")
            sched = wiaa.fetch_team_schedule(team_id)
        except Exception as e:  # noqa: BLE001
            console.print(f"[red]  · {school.id}: fetch failed after retries — {e}[/red]")
            school_failures.append((school.id, str(e)))
            continue
        sched["_school_id"] = school.id
        raw_schedules.append(sched)
        console.print(f"      {len(sched['games'])} games")

    console.print(
        f"Team discovery: {len(raw_schedules)}/{len(targets)} schools have a {args.sport} team"
    )
    if not raw_schedules and not school_failures:
        # Legitimate only in preseason, before WIAA mints the new season's
        # TeamIDs. Any other time it means SSID/label matching broke — SSIDs
        # rotate every season (see sources/wiaa.py). Distinct from the
        # fetch-failure path below: there we reached WIAA and it errored;
        # here every lookup succeeded and simply matched nothing.
        console.print(
            f"[red]Team discovery matched ZERO schools for {args.sport}. "
            f"Fine before WIAA posts the season; otherwise check SSID/label "
            f"matching in sources/wiaa.py.[/red]"
        )

    if school_failures:
        console.print(
            f"[red]{len(school_failures)}/{attempted} school fetches failed:[/red] "
            + ", ".join(sid for sid, _ in school_failures)
        )
        if len(school_failures) > SCHOOL_FAILURE_ABORT_RATIO * attempted:
            console.print(
                "[red]Failure rate above abort threshold — not writing, so the "
                "existing dataset stays intact.[/red]"
            )
            return 1

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
            season=args.season,
            console=console,
        )
        dataset = merge_team_season_stats(
            dataset,
            manifest=manifest,
            sport=args.sport,
            sport_abbr=sport_abbr,
            season=args.season,
            console=console,
        )
        # MaxPreps augments Bound for every sport with central-WI MP
        # coverage. For volleyball MP is the primary source (Bound has
        # ~zero data); for football/basketball MP supplements Bound's
        # leader-only output with full per-player rosters.
        MP_SPORTS = {"volleyball", "football", "boys_basketball", "girls_basketball"}
        if args.sport in MP_SPORTS:
            dataset = merge_maxpreps_stats(
                dataset,
                manifest=manifest,
                name_to_id=name_to_id,
                season=args.season,
                console=console,
            )
            # Volleyball gets a per-player season-stats aggregation
            # because MP doesn't publish season totals (their UI goes
            # empty off-season). Football/basketball keep Bound's
            # season totals — they're authoritative there.
            if args.sport == "volleyball":
                dataset = aggregate_volleyball_season_stats(
                    dataset,
                    console=console,
                )
    elif not args.no_stats and args.sport in WPH_SPORTS:
        subseason = wph.SUBSEASONS.get((args.sport, args.season))
        roster_index = (
            build_wph_roster_index(
                manifest,
                subseason=subseason,
                season=args.season,
                console=console,
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
    # processing already applied. Cheap (in-memory only). Pass the prior
    # snapshot (if any) so movement arrows fill in.
    prev_rankings = load_prev_rankings(args.sport, DATA_DIR)
    dataset = compute_power_rankings(
        dataset,
        manifest=manifest,
        prev_rankings=prev_rankings,
        console=console,
    )

    if args.dry_run:
        console.print("[yellow]Dry run — not writing files[/yellow]")
        return EXIT_PARTIAL if school_failures else 0

    existing = read_dataset(args.sport, DATA_DIR)

    # Wipe guard: a scrape that found ZERO games must never replace a
    # dataset that has them. Two scenarios this catches: (a) preseason —
    # the cron can carry next-season sports before WIAA posts their
    # schedules and they no-op here until publish day, then roll over
    # automatically; (b) a WIAA outage / parse regression mid-season.
    # Manual override: remove data/<sport>/games.json first.
    if not dataset.games:
        if existing is not None and existing.games:
            console.print(
                f"[yellow]0 games scraped for {args.sport} {args.season}, but the "
                f"existing dataset holds {len(existing.games)} games "
                f"({existing.meta.season}) — refusing to overwrite. "
                f"(Expected preseason: schedules not posted yet.)[/yellow]"
            )
            return EXIT_PARTIAL if school_failures else 0

    # Stats wipe guard: an empty season-stats merge must never replace a
    # populated file within the same season once games have gone final —
    # that's a source outage / parser regression (seen 2026-07-08: Bound's
    # rolled-over season pages emptied football + volleyball season stats).
    # Legitimately-empty cases still pass: a new season (meta.season
    # differs) or a preseason dataset with no finals yet.
    if (
        existing is not None
        and existing.meta.season == dataset.meta.season
        and existing.season_stats
        and not dataset.season_stats
        and any(g.status is GameStatus.FINAL for g in dataset.games)
    ):
        console.print(
            f"[yellow]season-stats merge returned 0 rows but the existing "
            f"dataset holds {len(existing.season_stats)} for the same season — "
            f"carrying the existing rows forward instead of wiping.[/yellow]"
        )
        dataset.season_stats = existing.season_stats

    # Per-game stat-lines carry-forward: a final's stat lines are
    # append-only truth — once attached they must survive later scrapes
    # whose merges come back empty for that game. Two real causes: a
    # stats source going dark (Bound serves GitHub-runner IPs a bot
    # challenge — found 2026-08-24 — so CI merges can see 0 where a
    # local run attached lines) and transient source outages. Matched by
    # game id, which embeds the date, so a rescheduled game never
    # inherits the old date's stats.
    if existing is not None and existing.meta.season == dataset.meta.season:
        prev_by_id = {g.id: g for g in existing.games if g.stat_leaders}
        carried = 0
        carried_sources: set[str] = set()
        for g in dataset.games:
            if g.status is GameStatus.FINAL and not g.stat_leaders and g.id in prev_by_id:
                prev = prev_by_id[g.id]
                g.stat_leaders = prev.stat_leaders
                # Carry the stats source tags with the lines — dropping
                # them left 33 games credited to nobody ("Stats via …"
                # vanished) and hid carried MaxPreps lines from the
                # repair scripts that key on the source tag.
                for src in prev.sources or []:
                    if src != "wiaa" and src not in (g.sources or []):
                        g.sources = [*(g.sources or []), src]
                        carried_sources.add(src)
                carried += 1
        if carried:
            for src in carried_sources:
                if src not in dataset.meta.sources_used:
                    dataset.meta.sources_used.append(src)
            console.print(
                f"[yellow]carried stat lines forward for {carried} game(s) whose "
                f"merges came back empty this run[/yellow]"
            )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_dataset(dataset, DATA_DIR)
    console.print(f"[green]Wrote dataset to {DATA_DIR}[/green]")
    if school_failures:
        console.print(
            f"[yellow]exit {EXIT_PARTIAL}: partial scrape "
            f"({len(school_failures)} school(s) failed — see above)[/yellow]"
        )
        return EXIT_PARTIAL
    return 0


if __name__ == "__main__":
    sys.exit(main())
