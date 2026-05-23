"""
Merge Bound-sourced player stats into the WIAA-derived game records.

The WIAA scrape gives us authoritative schedule + score data. Bound
augments that with stat-leader lines per game when its coverage is
available (mostly larger schools; smaller schools may have empty
panels). This step:

1. Groups our finalized games by date.
2. For each date, fetches Bound's scores index and builds a
   (away_name_norm, home_name_norm) → comp_id lookup.
3. For each finalized game we have, finds the matching Bound comp_id
   and pulls stat-leader lines.
4. Attaches the stats to the Game and marks "bound" in `sources`.

Games without a Bound match are left untouched — the rest of the
widget still works, the recap just falls back to the score-only
template.
"""

from __future__ import annotations

import re
import time
from typing import Iterable

from rich.console import Console

from config.loader import Manifest
from models.schema import Dataset, Game, GameStatus, SeasonStat, Sport, StatLine
from sources import bound, wph

POLITE_DELAY_SECONDS = 0.4


def merge_bound_stats(
    dataset: Dataset,
    *,
    name_to_id: dict[str, str],
    sport_abbr: str = "fb",
    console: Console | None = None,
) -> Dataset:
    """Mutate-and-return the dataset with stat_leaders populated where possible."""
    finals = [g for g in dataset.games if g.status == GameStatus.FINAL]
    if not finals:
        return dataset

    # Only chase Bound for games where at least one side is in our manifest.
    targeted = [g for g in finals if g.home.school_id or g.away.school_id]
    if not targeted:
        return dataset

    if console:
        console.print(f"[bold]Fetching Bound stats[/bold] for {len(targeted)} finalized games (sport_abbr={sport_abbr})")

    dates = sorted({g.date.strftime("%Y-%m-%d") for g in targeted})
    bound_index: dict[tuple[str, str], bound.BoundGame] = {}

    for date in dates:
        try:
            games_on_date = bound.find_game_ids(date, sport_abbr=sport_abbr)
        except Exception as e:  # noqa: BLE001
            if console:
                console.print(f"[yellow]  ! Bound scores index failed for {date}: {e}[/yellow]")
            continue
        for bg in games_on_date:
            key = (_norm(bg.away_team), _norm(bg.home_team))
            bound_index[key] = bg
        if console:
            console.print(f"  · {date}: {len(games_on_date)} Bound games indexed")
        time.sleep(POLITE_DELAY_SECONDS)

    if console:
        console.print(f"  [dim]{len(bound_index)} unique Bound games available across {len(dates)} dates[/dim]")

    matched = 0
    stat_lines_total = 0
    for game in targeted:
        bg = _find_match(game, bound_index)
        if not bg:
            continue
        try:
            lines = bound.fetch_game_stats(bg.comp_id, sport_abbr=sport_abbr)
        except Exception as e:  # noqa: BLE001
            if console:
                console.print(f"[yellow]  ! stats fetch failed for {bg.comp_id}: {e}[/yellow]")
            continue

        attached = _attach_stats(game, lines, name_to_id)
        if attached:
            matched += 1
            stat_lines_total += attached
            if "bound" not in game.sources:
                game.sources.append("bound")
        time.sleep(POLITE_DELAY_SECONDS)

    if console:
        console.print(
            f"[green]Stats merged:[/green] {matched}/{len(targeted)} games · "
            f"{stat_lines_total} stat lines"
        )

    if matched > 0 and "bound" not in dataset.meta.sources_used:
        dataset.meta.sources_used.append("bound")

    return dataset


def merge_team_season_stats(
    dataset: Dataset,
    *,
    manifest: Manifest,
    sport: str,
    sport_abbr: str = "fb",
    console: Console | None = None,
) -> Dataset:
    """
    Fetch Bound's per-team season-stats page for each manifest school with
    a `bound_slug` set, parse the four category tables, and attach the rows
    to dataset.season_stats keyed by school_id.

    Skips schools without a bound_slug (e.g., if discovery hasn't run for
    them yet) and silently skips category fetch errors so one broken team
    doesn't blank the whole leaderboard.
    """
    targets = [s for s in manifest.schools if s.bound_slug]
    if not targets:
        if console:
            console.print("[yellow]No bound_slug values in manifest — skipping season stats[/yellow]")
        return dataset

    if console:
        console.print(f"[bold]Fetching season stats[/bold] for {len(targets)} teams")

    sport_enum = Sport(sport)
    out: list[SeasonStat] = []
    for school in targets:
        try:
            rows = bound.fetch_team_season_stats(school.bound_slug, sport_abbr=sport_abbr)
        except Exception as e:  # noqa: BLE001
            if console:
                console.print(f"[yellow]  ! season stats failed for {school.id}: {e}[/yellow]")
            time.sleep(POLITE_DELAY_SECONDS)
            continue
        for r in rows:
            out.append(
                SeasonStat(
                    school_id=school.id,
                    sport=sport_enum,
                    category=r.category,
                    player_name=r.player_name,
                    player_year=r.player_year,
                    jersey=r.jersey,
                    stats=dict(r.stats),
                )
            )
        if console:
            console.print(f"  · {school.id} ({school.bound_slug}): {len(rows)} rows")
        time.sleep(POLITE_DELAY_SECONDS)

    dataset.season_stats = out
    if out and "bound" not in dataset.meta.sources_used:
        dataset.meta.sources_used.append("bound")
    if console:
        console.print(f"[green]Season stats:[/green] {len(out)} athlete-rows across {len(targets)} teams")
    return dataset


def merge_wph_season_stats(
    dataset: Dataset,
    *,
    manifest: Manifest,
    sport: str,
    console: Console | None = None,
) -> Dataset:
    """
    Pull per-team season stats from wisconsinprephockey.net and attach
    them to dataset.season_stats. Used for hockey sports where Bound has
    no data — see [[hockey-stats-gap]] memory for the source history.

    Two SeasonStat categories emitted:
      "Hockey Skater"   — G, A, PTS, SOG, PPG, PIM, ...
      "Hockey Goalie"   — GP, MIN, W, L, SV, GAA, SV%, SO

    Schools without a `wph_team_id` set on the manifest are skipped.
    """
    subseason = wph.SUBSEASONS.get((sport, dataset.meta.season))
    if subseason is None:
        if console:
            console.print(
                f"[yellow]No WPH subseason mapped for {sport} {dataset.meta.season}; skipping[/yellow]"
            )
        return dataset

    targets = [s for s in manifest.schools if s.wph_team_id]
    if not targets:
        if console:
            console.print("[yellow]No wph_team_id values in manifest — skipping hockey stats[/yellow]")
        return dataset

    if console:
        console.print(
            f"[bold]Fetching WPH season stats[/bold] for {len(targets)} teams (subseason={subseason})"
        )

    sport_enum = Sport(sport)
    out: list[SeasonStat] = []

    for school in targets:
        tid = wph.find_team_instance_id(school.wph_team_id, subseason)
        if tid is None:
            if console:
                console.print(
                    f"[yellow]  ? {school.id}: no team_instance for subseason {subseason} (didn't play this season?)[/yellow]"
                )
            time.sleep(POLITE_DELAY_SECONDS)
            continue
        try:
            skaters, goalies = wph.fetch_team_season_stats(tid, subseason=subseason)
        except Exception as e:  # noqa: BLE001
            if console:
                console.print(f"[yellow]  ! {school.id}: WPH stats failed ({e})[/yellow]")
            time.sleep(POLITE_DELAY_SECONDS)
            continue

        for sk in skaters:
            out.append(
                SeasonStat(
                    school_id=school.id,
                    sport=sport_enum,
                    category="Hockey Skater",
                    player_name=sk.player_name,
                    player_year=None,
                    jersey=sk.jersey,
                    stats=dict(sk.stats),
                )
            )
        for gl in goalies:
            out.append(
                SeasonStat(
                    school_id=school.id,
                    sport=sport_enum,
                    category="Hockey Goalie",
                    player_name=gl.player_name,
                    player_year=None,
                    jersey=gl.jersey,
                    stats=dict(gl.stats),
                )
            )
        if console:
            console.print(
                f"  · {school.id} (team_instance={tid}): {len(skaters)} skaters · {len(goalies)} goalies"
            )
        time.sleep(POLITE_DELAY_SECONDS)

    dataset.season_stats = out
    if out and "wisconsinprephockey" not in dataset.meta.sources_used:
        dataset.meta.sources_used.append("wisconsinprephockey")
    if console:
        console.print(
            f"[green]WPH season stats:[/green] {len(out)} athlete-rows across {len(targets)} teams"
        )
    return dataset


def _norm(name: str) -> str:
    """Collapse whitespace + case for name matching between sources."""
    return re.sub(r"\s+", " ", (name or "").strip().casefold())


def _find_match(
    game: Game,
    index: dict[tuple[str, str], bound.BoundGame],
) -> bound.BoundGame | None:
    """Match a WIAA game to a Bound game by (away, home) team names."""
    candidates = [
        (_norm(game.away.name), _norm(game.home.name)),
        # Defensive: if home/away got swapped during data entry on either
        # side, try the reverse too.
        (_norm(game.home.name), _norm(game.away.name)),
    ]
    for key in candidates:
        bg = index.get(key)
        if bg is not None:
            return bg
    return None


def _attach_stats(
    game: Game,
    lines: Iterable[bound.StatLine],
    name_to_id: dict[str, str],
) -> int:
    """
    Attach Bound stat lines for both teams in the game. Tracked schools
    get a resolved team_school_id; untracked opponents keep an empty
    school_id but their team_name still lines up with game.home/away.name
    so the frontend can group by name when there's no slug to match on.
    """
    attached: list[StatLine] = []
    for line in lines:
        school_id = name_to_id.get(_norm(line.team_name), "")
        attached.append(
            StatLine(
                team_school_id=school_id,
                team_name=line.team_name,
                category=line.category,
                player_name=line.player_name,
                player_year=line.player_year,
                stats=dict(line.stats),
            )
        )
    if attached:
        game.stat_leaders = attached
    return len(attached)
