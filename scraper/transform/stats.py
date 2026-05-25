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
from models.schema import Dataset, Game, GameStatus, Goal, SeasonStat, Sport, StatLine
from sources import bound, maxpreps, wph

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


# ---------------------------------------------------------------------------
# MaxPreps — per-game stat leaders for sports where Bound's central-WI
# coverage is too thin (volleyball, primarily).
# ---------------------------------------------------------------------------


def merge_maxpreps_stats(
    dataset: Dataset,
    *,
    manifest: Manifest,
    name_to_id: dict[str, str],
    season: str,
    console: Console | None = None,
) -> Dataset:
    """Attach per-player stat lines from MaxPreps to each finalized game
    in the dataset where at least one side has a `maxpreps_slug`.

    Discovery: for each tracked school, fetch their all-time match
    history page and harvest box-score URLs for the current season.
    Then dedupe URLs across schools (both sides of a game point at the
    same box score) and fetch each unique URL once.

    Games without a MaxPreps box score are left with whatever
    stat_leaders Bound already attached (often none for volleyball).
    """
    finals = [g for g in dataset.games if g.status == GameStatus.FINAL]
    if not finals:
        return dataset

    season_year = _season_start_year(season)
    if season_year is None:
        if console:
            console.print(f"[yellow]Cannot parse season year from {season!r} — skipping MaxPreps[/yellow]")
        return dataset

    # Index our finalized games by (date, our_school_id, opponent_school_id)
    # so multiple games on the same day (tournament play) don't collapse
    # to one bucket. Untracked opponents key on "" — those games match
    # any MP URL on that date for the tracked side, but only one such
    # URL can exist per pair so collisions are unlikely.
    games_by_key: dict[tuple[str, str, str], Game] = {}
    for g in finals:
        date = g.date.strftime("%Y-%m-%d")
        home_id = g.home.school_id or ""
        away_id = g.away.school_id or ""
        if home_id:
            games_by_key[(date, home_id, away_id)] = g
        if away_id:
            games_by_key[(date, away_id, home_id)] = g

    sport_path = "volleyball"  # the only sport using MaxPreps today
    targeted = [s for s in manifest.schools if s.maxpreps_slug]
    if not targeted:
        if console:
            console.print("[yellow]No maxpreps_slug values in manifest — skipping[/yellow]")
        return dataset

    # Build an MP-slug → our school_id map so MaxPreps URL fragments
    # (e.g. "dc-everest", "wausau-east") resolve back to our manifest
    # ids. Used to disambiguate multiple games per day.
    mp_slug_to_id: dict[str, str] = {}
    for s in targeted:
        slug = _strip_mascot_from_slug(s.maxpreps_slug, s.mascot)
        if slug:
            mp_slug_to_id[slug] = s.id

    if console:
        console.print(
            f"[bold]Discovering MaxPreps box scores[/bold] across "
            f"{len(targeted)} teams for {season_year} season"
        )

    # url → (Game, MaxPrepsGame, school_id). Dedupe across schools.
    url_index: dict[str, tuple[Game, maxpreps.MaxPrepsGame, str]] = {}
    for school in targeted:
        school_slug = _strip_mascot_from_slug(school.maxpreps_slug, school.mascot)
        try:
            history = maxpreps.fetch_team_match_history(
                school.maxpreps_slug,
                sport_path=sport_path,
                season_year=season_year,
                school_slug=school_slug,
            )
        except Exception as e:  # noqa: BLE001
            if console:
                console.print(f"[yellow]  ! {school.id} match-history failed: {e}[/yellow]")
            time.sleep(POLITE_DELAY_SECONDS)
            continue
        time.sleep(POLITE_DELAY_SECONDS)
        for mp_game in history:
            # mp_game.opponent is unslug'd from the URL; we need the
            # opponent's our-school-id to look up the right tournament
            # entry. Extract the opponent's slug from the URL directly
            # (more reliable than re-slugging the display name).
            opp_slug = _extract_opponent_slug_from_url(
                mp_game.box_score_url, school_slug,
            )
            opp_id = mp_slug_to_id.get(opp_slug or "", "")
            our_game = games_by_key.get((mp_game.date, school.id, opp_id))
            if our_game is None:
                # Fallback: try the date/school pair without opponent
                # (covers untracked opponents). Only use it when EXACTLY
                # one game exists for the day — otherwise we'd risk the
                # tournament cross-attach bug all over again.
                same_day = [
                    g for k, g in games_by_key.items()
                    if k[0] == mp_game.date and k[1] == school.id
                ]
                if len(same_day) == 1:
                    our_game = same_day[0]
            if our_game is None:
                continue
            url_index.setdefault(mp_game.box_score_url, (our_game, mp_game, school.id))

    if console:
        console.print(f"  [dim]{len(url_index)} unique box scores to fetch[/dim]")

    matched = 0
    stat_lines_total = 0
    for url, (game, _mp_game, _school_id) in url_index.items():
        try:
            box = maxpreps.fetch_box_score(url)
        except Exception as e:  # noqa: BLE001
            if console:
                console.print(f"[yellow]  ! box score failed: {url[:80]} ({e})[/yellow]")
            continue
        # Set scores are independent of stat lines — a game can have
        # set scores even when neither coach input player stats.
        if box.set_scores_by_team:
            _attach_set_scores(game, box.set_scores_by_team)
            if "maxpreps" not in game.sources:
                game.sources.append("maxpreps")
        if not box.stat_lines:
            time.sleep(POLITE_DELAY_SECONDS)
            continue
        attached = _attach_maxpreps_stats(game, box.stat_lines, name_to_id)
        if attached:
            matched += 1
            stat_lines_total += attached
            if "maxpreps" not in game.sources:
                game.sources.append("maxpreps")
        time.sleep(POLITE_DELAY_SECONDS)

    if console:
        console.print(
            f"[green]MaxPreps stats merged:[/green] {matched}/{len(url_index)} box scores · "
            f"{stat_lines_total} stat lines"
        )

    if matched > 0 and "maxpreps" not in dataset.meta.sources_used:
        dataset.meta.sources_used.append("maxpreps")

    return dataset


def aggregate_volleyball_season_stats(
    dataset: Dataset,
    *,
    console: Console | None = None,
) -> Dataset:
    """Roll per-game volleyball stat_leaders up into per-player season
    totals and write to dataset.season_stats.

    Why aggregate locally instead of scraping MP's season-stats UI:
    MaxPreps's team home `wallCards.teamLeaders` panel is the
    season-leader surface, but it goes empty off-season (selects the
    upcoming season's data set, which is empty until the schedule
    publishes). Rolling our own from the per-game lines we already
    extracted avoids the dependency and works year-round.

    Output shape mirrors what Bound used to emit so the frontend's
    sportConfig.stats.categories pickup works unchanged: one
    SeasonStat row per (school_id, player, raw category) where raw
    category is "Volleyball Offense" / "Volleyball Defense" /
    "Volleyball Serving". The stats dict aggregates every canonical
    key relevant to that raw category (KLS+AST+ATT for offense,
    DIG+BLK for defense, ACE for serving).
    """
    if Sport.VOLLEYBALL not in (dataset.meta.sports_included or []):
        return dataset

    # Per-game StatLine.category → (raw season category, [(canonical
    # stat key, source key in per-game stats dict)...]) — the keys we
    # accumulate when this category shows up for a player in a game.
    CATEGORY_MAP = {
        "Kills":        ("Volleyball Offense",  [("KLS", "KLS"), ("ATT", "Att"), ("E", "E"), ("SP", "SP")]),
        "Assists":      ("Volleyball Offense",  [("AST", "AST"), ("SP", "SP")]),
        "Digs":         ("Volleyball Defense",  [("DIG", "DIG"), ("SP", "SP")]),
        "Total Blocks": ("Volleyball Defense",  [("BLK", "BLK"), ("SP", "SP")]),
        "Serve Aces":   ("Volleyball Serving",  [("ACE", "ACE"), ("SP", "SP")]),
    }

    finals = [g for g in dataset.games if g.status == GameStatus.FINAL]
    if not finals:
        return dataset

    # (school_id, player_name, raw_category) → {canon_key: total, "GP": games_seen}
    bucket: dict[tuple[str, str, str], dict] = {}
    for game in finals:
        # GP per (player, raw_cat) — a player who registers in BOTH Kills
        # and Assists rows in one game still counts as one GP for offense.
        gp_seen: set[tuple[str, str, str]] = set()
        for line in game.stat_leaders or []:
            mapping = CATEGORY_MAP.get(line.category)
            if not mapping:
                continue
            school_id = line.team_school_id or ""
            if not school_id:
                continue
            raw_cat, key_pairs = mapping
            key = (school_id, line.player_name, raw_cat)
            entry = bucket.setdefault(
                key,
                {
                    "school_id": school_id,
                    "player_name": line.player_name,
                    "player_year": line.player_year,
                    "raw_category": raw_cat,
                    "totals": {},
                    "gp": 0,
                },
            )
            if line.player_year and not entry["player_year"]:
                entry["player_year"] = line.player_year
            gp_id = (school_id, line.player_name, raw_cat)
            first_line_in_game = gp_id not in gp_seen
            if first_line_in_game:
                gp_seen.add(gp_id)
                entry["gp"] += 1
            for canon, src_key in key_pairs:
                raw_val = (line.stats or {}).get(src_key)
                if raw_val is None:
                    continue
                try:
                    val = float(str(raw_val).replace(",", ""))
                except ValueError:
                    continue
                # SP (sets played) appears in every category line for the
                # same player — Kills, Assists, etc. all expose the same
                # count. Only accumulate it once per (player, game, raw_cat)
                # to avoid double-counting when a player registers in
                # multiple sub-categories of the same raw category.
                if canon == "SP" and not first_line_in_game:
                    continue
                entry["totals"][canon] = entry["totals"].get(canon, 0.0) + val

    # Compute derived hitting efficiency (EFF) where possible:
    #   EFF = (KLS - E) / ATT, three decimals, with leading "." if positive
    # — matches the MaxPreps convention.
    for entry in bucket.values():
        t = entry["totals"]
        if entry["raw_category"] == "Volleyball Offense":
            kls, errs, atts = t.get("KLS"), t.get("E"), t.get("ATT")
            if kls is not None and atts and atts > 0:
                eff = (kls - (errs or 0)) / atts
                t["EFF"] = f"{eff:.3f}" if eff < 0 else f"{eff:.3f}".lstrip("0")

    prior = [s for s in dataset.season_stats if s.sport != Sport.VOLLEYBALL]
    new_rows: list[SeasonStat] = []
    for e in bucket.values():
        stats: dict[str, str] = {"GP": str(e["gp"])}
        for k, v in e["totals"].items():
            if isinstance(v, str):
                stats[k] = v
            elif v == int(v):
                stats[k] = str(int(v))
            else:
                stats[k] = f"{v:.1f}"
        new_rows.append(
            SeasonStat(
                school_id=e["school_id"],
                sport=Sport.VOLLEYBALL,
                category=e["raw_category"],
                player_name=e["player_name"],
                player_year=e["player_year"],
                stats=stats,
            )
        )

    dataset.season_stats = prior + new_rows
    if console:
        console.print(
            f"[green]Volleyball season stats:[/green] aggregated "
            f"{len(new_rows)} player-rows from {len(finals)} games"
        )
    return dataset


def _attach_maxpreps_stats(
    game: Game,
    lines: Iterable[maxpreps.StatLine],
    name_to_id: dict[str, str],
) -> int:
    """Attach MaxPreps stat lines to a game, replacing any existing
    line with the same (school_id, player_name, category). Keeps any
    Bound-sourced lines that *don't* overlap (different category or
    different player), so a game can still carry both sources without
    duplicates piling up on re-runs."""
    existing = list(game.stat_leaders or [])

    # Build the set of keys MaxPreps is about to provide so we know
    # which existing lines to drop.
    incoming_keys = set()
    new_lines: list[StatLine] = []
    for line in lines:
        school_id = name_to_id.get(_norm(line.team_name), "")
        key = (school_id, line.player_name, line.category)
        incoming_keys.add(key)
        new_lines.append(
            StatLine(
                team_school_id=school_id,
                team_name=line.team_name,
                category=line.category,
                player_name=line.player_name,
                player_year=line.player_year,
                stats=dict(line.stats),
            )
        )

    # Keep existing lines whose key isn't being replaced.
    kept = [
        e for e in existing
        if (e.team_school_id, e.player_name, e.category) not in incoming_keys
    ]
    game.stat_leaders = kept + new_lines
    return len(new_lines)


def _attach_set_scores(
    game: Game,
    set_scores_by_team: dict[str, list[int]],
) -> None:
    """Map MaxPreps team-name → set scores onto the game's
    home/away set_scores. Picks the best name match; falls back to
    URL-position when names diverge (e.g. "WRLHS" abbreviation vs
    "Wisconsin Rapids Lincoln")."""
    if not set_scores_by_team:
        return
    teams = list(set_scores_by_team.items())
    # Try direct name match first.
    home_scores = _match_team_scores(game.home.name, teams)
    away_scores = _match_team_scores(game.away.name, teams)
    # If names didn't disambiguate cleanly, fall back to "the first
    # listed team is the away team" — matches MaxPreps' usual order,
    # and gracefully degrades when wrong (the values are still real,
    # just possibly swapped). Frontend can detect a swap by comparing
    # set-count to game.home.score / game.away.score.
    if home_scores is None and away_scores is None and len(teams) == 2:
        away_scores = teams[0][1]
        home_scores = teams[1][1]
    if home_scores is None and away_scores is not None and len(teams) == 2:
        # Whatever isn't the away team must be home.
        for name, scores in teams:
            if scores is not away_scores:
                home_scores = scores
                break
    if away_scores is None and home_scores is not None and len(teams) == 2:
        for name, scores in teams:
            if scores is not home_scores:
                away_scores = scores
                break
    if not home_scores or not away_scores:
        return
    sets = min(len(home_scores), len(away_scores))
    game.set_scores = [
        {"home": home_scores[i], "away": away_scores[i]}
        for i in range(sets)
    ]


def _match_team_scores(
    side_name: str,
    teams: list[tuple[str, list[int]]],
) -> list[int] | None:
    """Find the team in `teams` whose MP-rendered name best matches
    `side_name`. Uses casefold equality first, then loose containment."""
    needle = _norm(side_name)
    for name, scores in teams:
        if _norm(name) == needle:
            return scores
    for name, scores in teams:
        n = _norm(name)
        if n in needle or needle in n:
            return scores
    return None


def _dedupe_wph_athletes(athletes):
    """Collapse duplicate WPH player rows down to one per (name, jersey),
    keeping the row with the highest GP. WPH renders Overall + Conference
    sections on the same page; the Conference rows are subsets we don't
    want to ship alongside the totals."""
    best: dict[tuple[str, str], tuple[int, object]] = {}
    for a in athletes:
        key = (a.player_name, a.jersey or "")
        try:
            gp = int(a.stats.get("GP", "0") or "0")
        except (ValueError, AttributeError):
            gp = 0
        existing = best.get(key)
        if existing is None or gp > existing[0]:
            best[key] = (gp, a)
    # Preserve original first-seen ordering.
    seen_keys: list[tuple[str, str]] = []
    seen_set: set[tuple[str, str]] = set()
    for a in athletes:
        key = (a.player_name, a.jersey or "")
        if key not in seen_set:
            seen_set.add(key)
            seen_keys.append(key)
    return [best[k][1] for k in seen_keys]


def _season_start_year(season: str) -> int | None:
    """'2025-26' → 2025. For volleyball (a fall sport) the season starts
    in calendar year N and ends N+1."""
    try:
        return int(season.split("-")[0])
    except (ValueError, IndexError):
        return None


_MP_URL_TEAMS_RE = re.compile(
    r"/games/\d+-\d+-\d+/[a-z0-9-]+/(?P<away>[a-z0-9-]+)-vs-(?P<home>[a-z0-9-]+)\.htm"
)


def _extract_opponent_slug_from_url(url: str, our_slug: str | None) -> str | None:
    """Pull the opponent's MaxPreps school slug from a box-score URL.
    `our_slug` is this team's slug (e.g. 'mosinee') — whichever side of
    the URL isn't us is the opponent."""
    if not url or not our_slug:
        return None
    m = _MP_URL_TEAMS_RE.search(url)
    if not m:
        return None
    away, home = m.group("away"), m.group("home")
    if away == our_slug:
        return home
    if home == our_slug:
        return away
    # Neutral-site / tournament URL where our slug isn't either side —
    # nothing we can disambiguate by.
    return None


def _strip_mascot_from_slug(slug_path: str | None, mascot: str | None) -> str | None:
    """Box-score URLs use `<school-slug>` without the mascot, so to
    detect home/away we need the school slug without our manifest's
    trailing mascot tokens.

      "wausau/wausau-east-lumberjacks"  + mascot="Lumberjacks"  →
      "wausau-east"
      "park-falls/chequamegon-screaming-eagles" + "Screaming Eagles" →
      "chequamegon"
    """
    if not slug_path or not mascot:
        return None
    last = slug_path.split("/")[-1]
    tokens = len(_norm(mascot).split())
    parts = last.rsplit("-", tokens)
    return parts[0] if len(parts) > tokens else last


_COOP_SUFFIX_RE = re.compile(r"\s+co[\-\s]?op\b", re.IGNORECASE)


def _class_letter(grad_year: int | None, season: str) -> str | None:
    """
    Convert a graduation year to SR/JR/SO/FR for the given season label.
    Season "2025-26" → SR for class of 2026, JR for 2027, and so on.
    Returns None for missing or out-of-range grad years.
    """
    if grad_year is None:
        return None
    try:
        end_year = int(season.split("-")[0]) + 1
    except (ValueError, IndexError):
        return None
    diff = grad_year - end_year
    return {0: "SR", 1: "JR", 2: "SO", 3: "FR"}.get(diff)


def build_wph_roster_index(
    manifest: Manifest,
    *,
    subseason: int,
    season: str,
    console: Console | None = None,
) -> dict[str, dict[tuple[str, str], tuple[str | None, str | None]]]:
    """
    For each manifest school with a wph_team_id, fetch the WPH roster and
    return school.id → {(jersey, name_norm): (position, player_year)}.
    Also stores a name-only fallback under jersey="". Schools without a
    roster (e.g. team didn't field this season) are simply missing from
    the map.
    """
    index: dict[str, dict[tuple[str, str], tuple[str | None, str | None]]] = {}
    for school in manifest.schools:
        if not school.wph_team_id:
            continue
        try:
            rows = wph.fetch_team_roster(school.wph_team_id, subseason=subseason)
        except Exception as e:  # noqa: BLE001
            if console:
                console.print(f"[yellow]  ! {school.id}: WPH roster failed ({e})[/yellow]")
            time.sleep(POLITE_DELAY_SECONDS)
            continue
        time.sleep(POLITE_DELAY_SECONDS)
        bucket: dict[tuple[str, str], tuple[str | None, str | None]] = {}
        for r in rows:
            year = _class_letter(r.grad_year, season)
            name_norm = _norm(r.player_name)
            jersey = (r.jersey or "").strip()
            bucket[(jersey, name_norm)] = (r.position, year)
            # Name-only fallback for stat rows whose jersey diverges
            # (mid-season number change, etc.). First win keeps original.
            bucket.setdefault(("", name_norm), (r.position, year))
        if bucket:
            index[school.id] = bucket
    return index


def _lookup_roster(
    roster_index: dict[str, dict[tuple[str, str], tuple[str | None, str | None]]],
    school_id: str,
    jersey: str | None,
    player_name: str,
) -> tuple[str | None, str | None]:
    """Return (position, player_year) for an athlete; falls back to name-only
    when the jersey doesn't match. Returns (None, None) when unmapped."""
    if not school_id or school_id not in roster_index:
        return (None, None)
    bucket = roster_index[school_id]
    name_norm = _norm(player_name)
    j = (jersey or "").strip()
    hit = bucket.get((j, name_norm))
    if hit is not None:
        return hit
    return bucket.get(("", name_norm), (None, None))


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
    roster_index: dict[str, dict[tuple[str, str], tuple[str | None, str | None]]] | None = None,
    name_to_id: dict[str, str] | None = None,
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
    subseasons = wph.all_subseasons(sport, dataset.meta.season)
    if not subseasons:
        return dataset

    finals = [g for g in dataset.games if g.status == GameStatus.FINAL]
    targets = [s for s in manifest.schools if s.wph_team_id]
    if not finals or not targets:
        return dataset

    if console:
        console.print(
            f"[bold]Indexing WPH schedules[/bold] for {len(targets)} teams "
            f"(per-game stats; subseasons={subseasons})"
        )

    if roster_index is None:
        roster_index = build_wph_roster_index(
            manifest, subseason=subseasons[0], season=dataset.meta.season, console=console,
        )
    if console:
        console.print(f"  [dim]rosters loaded: {len(roster_index)} teams[/dim]")

    season_start_year = int(dataset.meta.season.split("-")[0])
    # (iso_date, tracked_school_id, opp_key) → wph_game_id. Keying off the
    # tracked side's school_id (not its display name) means co-op /
    # mascot-suffix mismatches between WIAA and WPH don't break the match.
    pair_index: dict[tuple[str, str, str], int] = {}

    # Iterate every subseason so playoff games (Sectional Final, State
    # Tournament) get indexed alongside regular season — WPH stores them
    # under distinct subseason IDs.
    for school in targets:
        for sub in subseasons:
            tid = wph.find_team_instance_id(school.wph_team_id, sub)
            if tid is None:
                time.sleep(POLITE_DELAY_SECONDS)
                continue
            try:
                sched = wph.fetch_team_schedule(tid, subseason=sub)
            except Exception as e:  # noqa: BLE001
                if console:
                    console.print(f"[yellow]  ! {school.id} sub={sub}: WPH schedule failed ({e})[/yellow]")
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
        time.sleep(POLITE_DELAY_SECONDS)

    if console:
        console.print(f"  [dim]{len(pair_index)} WPH game keys indexed[/dim]")

    matched_games = 0
    stat_lines_total = 0
    stats_cache: dict[int, wph.WPHGameDetail | None] = {}

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
            detail = stats_cache[game_id]
        else:
            try:
                detail = wph.fetch_game_detail(game_id)
            except Exception as e:  # noqa: BLE001
                if console:
                    console.print(f"[yellow]  ! game {game_id}: fetch failed ({e})[/yellow]")
                stats_cache[game_id] = None
                time.sleep(POLITE_DELAY_SECONDS)
                continue
            stats_cache[game_id] = detail
            time.sleep(POLITE_DELAY_SECONDS)

        if detail is None:
            continue

        attached = _attach_wph_per_game(game, detail.stat_rows, roster_index, name_to_id)
        _attach_wph_scoring(game, detail.goals, name_to_id)
        if attached or detail.goals:
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


def _match_wph_team_to_side(wph_team_name: str, game: Game, name_to_id: dict[str, str] | None = None):
    """
    Pick which side (game.home / game.away) a WPH team_name corresponds
    to.

    Strategy (first non-None wins):
      1. Alias-table lookup — _norm(wph_team_name) → school_id, then match
         against home.school_id / away.school_id. Handles cases where WPH
         uses a different display than WIAA ("SPASH Panthers" vs
         "Stevens Point") but our normalize.py _NAME_ALIASES already
         maps both to the same slug.
      2. Prefix overlap on _opp_key — handles mascot-laden WPH names
         ("Notre Dame Academy Tritons" against WIAA's "Notre Dame") and
         co-op stripping ("Marshfield/Columbus Catholic" → "Marshfield").
    Returns None on no confident match.
    """
    wph_norm = _norm(wph_team_name)

    # Alias lookup — try the full normalized name first, then trim
    # trailing mascot tokens. "spash panthers" doesn't resolve, but
    # "spash" does; same trick handles "Notre Dame Academy Tritons"
    # via "notre dame academy" → "notre dame".
    def _alias_to_side(candidate: str):
        if not (name_to_id and candidate and candidate in name_to_id):
            return None
        sid = name_to_id[candidate]
        if sid == game.home.school_id:
            return game.home
        if sid == game.away.school_id:
            return game.away
        return None

    if name_to_id:
        tokens = wph_norm.split()
        for k in range(len(tokens), 0, -1):
            hit = _alias_to_side(" ".join(tokens[:k]))
            if hit is not None:
                return hit

    # Prefix overlap on _opp_key
    wph_key = _opp_key(wph_team_name)
    if not wph_key:
        return None
    best = None
    best_overlap = 0
    for side in (game.home, game.away):
        side_key = _opp_key(side.name)
        if not side_key:
            continue
        if side_key == wph_key:
            return side
        if wph_key.startswith(side_key + " "):
            overlap = len(side_key)
        elif side_key.startswith(wph_key + " "):
            overlap = len(wph_key)
        else:
            continue
        if overlap > best_overlap:
            best_overlap = overlap
            best = side
    return best


def _attach_wph_scoring(game: Game, wph_goals: list[wph.WPHGoal], name_to_id: dict[str, str] | None = None) -> int:
    """
    Convert WPH scoring-summary goals into schema Goal records and
    attach them to game.scoring. Each goal's team_name is resolved to
    one of the game's two sides via _match_wph_team_to_side so the
    frontend can compare against game.home.name / game.away.name
    without re-fuzzy-matching.
    """
    if not wph_goals:
        return 0
    side_for_team: dict[str, object] = {}
    out: list[Goal] = []
    for wg in wph_goals:
        side = side_for_team.get(wg.team_name)
        if side is None:
            side = _match_wph_team_to_side(wg.team_name, game, name_to_id)
            if side is not None:
                side_for_team[wg.team_name] = side
        out.append(Goal(
            period=wg.period,
            time=wg.time,
            team_school_id=(side.school_id if side else ""),
            team_name=(side.name if side else wg.team_name),
            scorer_jersey=wg.scorer_jersey,
            scorer_name=wg.scorer_name,
            strength=wg.strength,
            assists=[{"jersey": j, "name": n} for j, n in wg.assists],
            away_score=wg.away_score,
            home_score=wg.home_score,
        ))
    if out:
        game.scoring = out
    return len(out)


def _attach_wph_per_game(
    game: Game,
    rows: list[wph.WPHGameStatRow],
    roster_index: dict[str, dict[tuple[str, str], tuple[str | None, str | None]]],
    name_to_id: dict[str, str] | None = None,
) -> int:
    """
    Reduce a game's raw athlete rows to up to 3 stat-leader lines per
    team and attach them to game.stat_leaders. Returns the number of
    lines attached.

    Each WPH team_name is matched to one of the game's two sides so the
    StatLine carries the WIAA-rendered team_name even for untracked
    opponents — that lets the frontend's GamePage group stats by team
    when team_school_id is empty.
    """
    if not rows:
        return 0

    # Resolve each unique WPH team_name → game side once.
    side_for_team: dict[str, object] = {}
    for r in rows:
        if r.team_name in side_for_team:
            continue
        side = _match_wph_team_to_side(r.team_name, game, name_to_id)
        if side is None:
            continue
        side_for_team[r.team_name] = side

    # Group by the matched side. Keying by id(side) deduplicates without
    # caring whether school_id is set.
    by_side: dict[int, dict[str, list[wph.WPHGameStatRow]]] = {}
    side_objs: dict[int, object] = {}
    for r in rows:
        side = side_for_team.get(r.team_name)
        if side is None:
            continue
        bucket = by_side.setdefault(id(side), {})
        bucket.setdefault(r.kind, []).append(r)
        side_objs[id(side)] = side

    def _line(side, category, athlete):
        position, year = _lookup_roster(
            roster_index, side.school_id, athlete.jersey, athlete.player_name,
        )
        return StatLine(
            team_school_id=side.school_id,
            team_name=side.name,
            category=category,
            player_name=athlete.player_name,
            player_year=year,
            position=position,
            stats=dict(athlete.stats),
        )

    out: list[StatLine] = []
    for side_id, kinds in by_side.items():
        side = side_objs[side_id]
        skaters = kinds.get("skater", [])
        points_leader = None
        if skaters:
            top_pts = max(skaters, key=lambda r: _wph_num(r.stats.get("PTS")))
            if _wph_num(top_pts.stats.get("PTS")) > 0:
                points_leader = top_pts
                out.append(_line(side, "Hockey Points", top_pts))
            top_g = max(skaters, key=lambda r: _wph_num(r.stats.get("G")))
            if (
                _wph_num(top_g.stats.get("G")) >= 2
                and (points_leader is None or top_g.player_name != points_leader.player_name)
            ):
                out.append(_line(side, "Hockey Goals", top_g))
        goalies = [g for g in kinds.get("goalie", []) if _wph_minutes(g.stats.get("MIN")) > 0]
        if goalies:
            top_sv = max(goalies, key=lambda r: _wph_num(r.stats.get("SV")))
            out.append(_line(side, "Hockey Saves", top_sv))

    if out:
        game.stat_leaders = out
    return len(out)


def merge_wph_season_stats(
    dataset: Dataset,
    *,
    manifest: Manifest,
    sport: str,
    roster_index: dict[str, dict[tuple[str, str], tuple[str | None, str | None]]] | None = None,
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

    if roster_index is None:
        roster_index = build_wph_roster_index(
            manifest, subseason=subseason, season=dataset.meta.season, console=console,
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

        def _season_stat(category: str, athlete) -> SeasonStat:
            position, year = _lookup_roster(
                roster_index, school.id, athlete.jersey, athlete.player_name,
            )
            return SeasonStat(
                school_id=school.id,
                sport=sport_enum,
                category=category,
                player_name=athlete.player_name,
                player_year=year,
                position=position,
                jersey=athlete.jersey,
                stats=dict(athlete.stats),
            )

        # WPH's player-stats page emits two "Player Stats" sections per
        # team — Overall first, then Conference (a subset of Overall).
        # Both come back as separate rows from fetch_team_season_stats;
        # dedupe by (player_name, jersey) keeping the row with the
        # highest GP so we preserve full-season totals, not the
        # conference-only subset.
        for athlete in _dedupe_wph_athletes(skaters):
            out.append(_season_stat("Hockey Skater", athlete))
        for athlete in _dedupe_wph_athletes(goalies):
            out.append(_season_stat("Hockey Goalie", athlete))
        if console:
            console.print(
                f"  · {school.id} (team_instance={tid}): {len(skaters)} skaters · {len(goalies)} goalies (raw)"
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
