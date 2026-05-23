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


_COOP_SUFFIX_RE = re.compile(r"\s+co[\-\s]?op\b", re.IGNORECASE)


def _opp_key(name: str) -> str:
    """
    Reduce an opponent name to a token that lines up between WIAA's
    full co-op rendering ("Hayward/Lac Courte Oreilles", "Pacelli Co-op",
    "Marshfield/Columbus Catholic") and WPH's short form ("Hayward",
    "Pacelli", "Marshfield"). Keeps the lead school's full multi-word
    name so "Eau Claire North" stays distinct from "Eau Claire Memorial".
    """
    if not name:
        return ""
    head = name.split("/")[0]
    head = _COOP_SUFFIX_RE.sub("", head)
    return _norm(head)


_WPH_MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}


def _wph_date_to_iso(date_text: str, season_start_year: int) -> str | None:
    """
    Convert WPH schedule date text (e.g. "Fri Nov 28", "Tue Dec  2") to
    an ISO date string. WPH never includes the year — we infer it from
    the month: Aug-Dec belong to season_start_year, Jan-Jul to the
    following calendar year.
    """
    parts = (date_text or "").split()
    # Discard the weekday prefix when present.
    if len(parts) >= 3:
        month_str, day_str = parts[1], parts[2]
    elif len(parts) == 2:
        month_str, day_str = parts
    else:
        return None
    month = _WPH_MONTHS.get(month_str[:3])
    if month is None:
        return None
    try:
        day = int(day_str)
    except ValueError:
        return None
    year = season_start_year if month >= 8 else season_start_year + 1
    return f"{year:04d}-{month:02d}-{day:02d}"


def _resolve_wph_team_school_id(
    wph_team_name: str,
    game: Game,
    name_to_id: dict[str, str],
) -> str:
    """
    Map a WPH-rendered team name (e.g. "Wausau West Warriors") to a
    school_id. First tries the manifest's normalized-name index; if that
    misses, falls back to substring matching against the game's two team
    names — WPH's "<Name> <Mascot>" usually contains the WIAA name.
    """
    norm = _norm(wph_team_name)
    if norm in name_to_id:
        return name_to_id[norm]
    # Try progressively shorter prefixes (drop trailing tokens — usually
    # the mascot like "Warriors" / "Tritons").
    tokens = norm.split()
    for k in range(len(tokens) - 1, 0, -1):
        candidate = " ".join(tokens[:k])
        if candidate in name_to_id:
            return name_to_id[candidate]
    # Last resort: pick whichever side's WIAA name appears inside the WPH name.
    for side in (game.home, game.away):
        if side.school_id and _norm(side.name) and _norm(side.name) in norm:
            return side.school_id
    return ""


def _wph_num(value: str | None) -> float:
    """Parse a WPH stat string to float, treating missing/'-' as 0."""
    if not value or value == "-":
        return 0.0
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return 0.0


def _wph_minutes(value: str | None) -> float:
    """Parse MIN like '51:00' → 51.0; '0:00' → 0.0; '-' → 0.0."""
    if not value or value == "-":
        return 0.0
    if ":" in value:
        try:
            m, s = value.split(":", 1)
            return int(m) + int(s) / 60.0
        except ValueError:
            return 0.0
    return _wph_num(value)


def merge_wph_per_game_stats(
    dataset: Dataset,
    *,
    manifest: Manifest,
    sport: str,
    name_to_id: dict[str, str],
    console: Console | None = None,
) -> Dataset:
    """
    Per-game hockey stats: index each tracked school's WPH schedule,
    match (date, team-pair) against finalized games in our dataset, and
    attach a small set of stat_leaders per matched game.

    Categories emitted per team (frontend HOCKEY_GAME_LINE.order picks one):
      "Hockey Points" — top skater by PTS (must be > 0)
      "Hockey Goals"  — top skater by G (must be >= 2; suppressed when the
                        same player already leads in points)
      "Hockey Saves"  — top goalie by SV (only counts goalies who played)
    """
    subseason = wph.SUBSEASONS.get((sport, dataset.meta.season))
    if subseason is None:
        return dataset

    finals = [g for g in dataset.games if g.status == GameStatus.FINAL]
    targets = [s for s in manifest.schools if s.wph_team_id]
    if not finals or not targets:
        return dataset

    if console:
        console.print(
            f"[bold]Indexing WPH schedules[/bold] for {len(targets)} teams "
            f"(per-game stats; subseason={subseason})"
        )

    season_start_year = int(dataset.meta.season.split("-")[0])
    # (iso_date, tracked_school_id, opp_key) → wph_game_id. Keying off the
    # tracked side's school_id (not its display name) means co-op /
    # mascot-suffix mismatches between WIAA and WPH don't break the match.
    pair_index: dict[tuple[str, str, str], int] = {}

    for school in targets:
        tid = wph.find_team_instance_id(school.wph_team_id, subseason)
        if tid is None:
            time.sleep(POLITE_DELAY_SECONDS)
            continue
        try:
            sched = wph.fetch_team_schedule(tid, subseason=subseason)
        except Exception as e:  # noqa: BLE001
            if console:
                console.print(f"[yellow]  ! {school.id}: WPH schedule failed ({e})[/yellow]")
            time.sleep(POLITE_DELAY_SECONDS)
            continue
        for sg in sched:
            iso = _wph_date_to_iso(sg.date_text, season_start_year)
            if not iso:
                continue
            opp_clean = (sg.opponent or "").lstrip("@").strip()
            if not opp_clean:
                continue
            pair_index.setdefault((iso, school.id, _opp_key(opp_clean)), sg.game_id)
        time.sleep(POLITE_DELAY_SECONDS)

    if console:
        console.print(f"  [dim]{len(pair_index)} WPH game keys indexed[/dim]")

    matched_games = 0
    stat_lines_total = 0
    stats_cache: dict[int, list[wph.WPHGameStatRow]] = {}

    for game in finals:
        date_iso = game.date.strftime("%Y-%m-%d")
        # Try both sides as the tracked anchor — at least one side has a
        # wph_team_id for any game that ended up in our index.
        game_id = None
        for tracked, other in ((game.home, game.away), (game.away, game.home)):
            if not tracked.school_id:
                continue
            game_id = pair_index.get((date_iso, tracked.school_id, _opp_key(other.name)))
            if game_id is not None:
                break
        if game_id is None:
            continue

        if game_id in stats_cache:
            rows = stats_cache[game_id]
        else:
            try:
                rows = wph.fetch_game_stats(game_id)
            except Exception as e:  # noqa: BLE001
                if console:
                    console.print(f"[yellow]  ! game {game_id}: stats fetch failed ({e})[/yellow]")
                stats_cache[game_id] = []
                time.sleep(POLITE_DELAY_SECONDS)
                continue
            stats_cache[game_id] = rows
            time.sleep(POLITE_DELAY_SECONDS)

        attached = _attach_wph_per_game(game, rows, name_to_id)
        if attached:
            matched_games += 1
            stat_lines_total += attached
            if "wisconsinprephockey" not in game.sources:
                game.sources.append("wisconsinprephockey")

    if console:
        console.print(
            f"[green]WPH per-game stats:[/green] {matched_games}/{len(finals)} games · "
            f"{stat_lines_total} stat lines"
        )

    if matched_games > 0 and "wisconsinprephockey" not in dataset.meta.sources_used:
        dataset.meta.sources_used.append("wisconsinprephockey")

    return dataset


def _attach_wph_per_game(
    game: Game,
    rows: list[wph.WPHGameStatRow],
    name_to_id: dict[str, str],
) -> int:
    """
    Reduce a game's raw athlete rows to up to 3 stat-leader lines per
    team and attach them to game.stat_leaders. Returns the number of
    lines attached.
    """
    if not rows:
        return 0

    # Group by (resolved_team_id, raw_team_name) so two teams that fail
    # to resolve still get separated by their WPH display name.
    by_team: dict[tuple[str, str], dict[str, list[wph.WPHGameStatRow]]] = {}
    for r in rows:
        team_school_id = _resolve_wph_team_school_id(r.team_name, game, name_to_id)
        bucket = by_team.setdefault((team_school_id, r.team_name), {})
        bucket.setdefault(r.kind, []).append(r)

    out: list[StatLine] = []
    for (team_school_id, team_name), kinds in by_team.items():
        skaters = kinds.get("skater", [])
        points_leader = None
        if skaters:
            top_pts = max(skaters, key=lambda r: _wph_num(r.stats.get("PTS")))
            if _wph_num(top_pts.stats.get("PTS")) > 0:
                points_leader = top_pts
                out.append(StatLine(
                    team_school_id=team_school_id,
                    team_name=team_name,
                    category="Hockey Points",
                    player_name=top_pts.player_name,
                    player_year=None,
                    stats=dict(top_pts.stats),
                ))
            top_g = max(skaters, key=lambda r: _wph_num(r.stats.get("G")))
            if (
                _wph_num(top_g.stats.get("G")) >= 2
                and (points_leader is None or top_g.player_name != points_leader.player_name)
            ):
                out.append(StatLine(
                    team_school_id=team_school_id,
                    team_name=team_name,
                    category="Hockey Goals",
                    player_name=top_g.player_name,
                    player_year=None,
                    stats=dict(top_g.stats),
                ))
        goalies = [g for g in kinds.get("goalie", []) if _wph_minutes(g.stats.get("MIN")) > 0]
        if goalies:
            top_sv = max(goalies, key=lambda r: _wph_num(r.stats.get("SV")))
            out.append(StatLine(
                team_school_id=team_school_id,
                team_name=team_name,
                category="Hockey Saves",
                player_name=top_sv.player_name,
                player_year=None,
                stats=dict(top_sv.stats),
            ))

    if out:
        game.stat_leaders = out
    return len(out)


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
