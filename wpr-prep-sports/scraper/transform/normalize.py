"""
Raw WIAA records → canonical Dataset.

Inputs:
- The school manifest (config/schools.json, loaded into a Manifest object)
- Raw schedule dicts from `sources.wiaa.fetch_team_schedule(...)`. The
  caller attaches the manifest school id under `_school_id` on each schedule
  so we can resolve result perspectives.

Outputs:
- A pydantic Dataset (models/schema.py) ready to be JSON-serialized.

Responsibilities:
- Name resolution: map WIAA-displayed team names to manifest slugs.
  Unmatched opponents pass through with `school_id=""`.
- Date/time → US/Central tz-aware datetimes.
- Result parsing: "W 30-6" / "L 14-21" → home/away scores against the
  perspective of the schedule's owning team.
- Standings: aggregate W/L per conference from completed games.
- Deduplicate games (a conference game appears on both schools' schedules).
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Iterable
from zoneinfo import ZoneInfo

from config.loader import Manifest
from models.schema import (
    ConferenceMembership as ModelConferenceMembership,
)
from models.schema import (
    Dataset,
    Game,
    GameStatus,
    Meta,
    School,
    Sport,
    Standing,
    StandingRow,
    TeamScore,
)

CENTRAL = ZoneInfo("America/Chicago")

_RESULT_RE = re.compile(r"^([WL])\s+(\d+)\s*-\s*(\d+)", re.IGNORECASE)
_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})\s*([APap][Mm])$")


def build_dataset(
    *,
    manifest: Manifest,
    raw_team_schedules: list[dict],
    sport: str,
    season: str,
) -> Dataset:
    """Combine the manifest with raw per-team schedules into a Dataset."""
    sport_enum = Sport(sport)

    schools_out = _schools_to_model(manifest)
    name_to_id = _build_name_index(manifest)

    games: dict[str, Game] = {}
    for sched in raw_team_schedules:
        owner_school_id = sched.get("_school_id")
        for raw in sched["games"]:
            game = _raw_to_game(
                raw,
                sport=sport_enum,
                season=season,
                owner_school_id=owner_school_id,
                name_to_id=name_to_id,
            )
            if game is None:
                continue
            games.setdefault(game.id, game)

    games_list = sorted(games.values(), key=lambda g: g.date)
    standings = _build_standings(
        games_list,
        manifest=manifest,
        sport=sport_enum,
        season=season,
    )

    meta = Meta(
        last_updated=datetime.now(CENTRAL),
        season=season,
        sports_included=[sport_enum],
        sources_used=["wiaa"],
    )

    return Dataset(
        meta=meta,
        schools=schools_out,
        games=games_list,
        standings=standings,
    )


def _schools_to_model(manifest: Manifest) -> list[School]:
    return [
        School(
            id=s.id,
            name=s.name,
            full_name=s.full_name,
            mascot=s.mascot,
            city=s.city,
            colors=list(s.colors),
            conferences=[
                ModelConferenceMembership(
                    sport=Sport(c.sport),
                    conference=c.conference,
                )
                for c in s.conferences
            ],
            wiaa_division={},
            athletics_url=s.athletics_url,
        )
        for s in manifest.schools
    ]


# WIAA's name variants → manifest slug. Extend as new mismatches surface.
_NAME_ALIASES: dict[str, str] = {
    "wausau east": "wausau-east",
    "wausau west": "wausau-west",
    "d.c. everest": "dc-everest",
    "dc everest": "dc-everest",
    "marshfield": "marshfield",
    "stevens point": "spash",
    "stevens point area": "spash",
    "stevens point area sr.": "spash",
    "spash": "spash",
    "wisconsin rapids": "wisconsin-rapids",
    "wisconsin rapids lincoln": "wisconsin-rapids",
    "athens": "athens",
    "edgar": "edgar",
    "marathon": "marathon",
    "newman catholic": "newman-catholic",
    "stratford": "stratford",
    "spencer": "spencer",
    "spencer/columbus catholic": "spencer",
    "mosinee": "mosinee",
    "colby": "colby",
    "abbotsford": "abbotsford",
}


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().casefold())


def _build_name_index(manifest: Manifest) -> dict[str, str]:
    idx: dict[str, str] = dict(_NAME_ALIASES)
    for s in manifest.schools:
        idx.setdefault(_normalize_name(s.name), s.id)
        idx.setdefault(_normalize_name(s.full_name), s.id)
    return idx


def _resolve_school_id(wiaa_name: str, name_to_id: dict[str, str]) -> str:
    return name_to_id.get(_normalize_name(wiaa_name), "")


def _raw_to_game(
    raw: dict,
    *,
    sport: Sport,
    season: str,
    owner_school_id: str | None,
    name_to_id: dict[str, str],
) -> Game | None:
    date_iso = raw.get("date")
    if not date_iso:
        return None

    dt = _parse_datetime(date_iso, raw.get("time"))
    if dt is None:
        return None

    home_id = _resolve_school_id(raw["home"]["name"], name_to_id)
    away_id = _resolve_school_id(raw["away"]["name"], name_to_id)

    if not home_id and not away_id:
        return None  # game involves no tracked school — skip

    home_score, away_score, status = _parse_result(
        raw.get("result"),
        owner_school_id=owner_school_id,
        home_id=home_id,
        away_id=away_id,
    )

    home_anchor = home_id or _slugify(raw["home"]["name"])
    away_anchor = away_id or _slugify(raw["away"]["name"])
    game_id = f"{sport.value}-{date_iso}-{away_anchor}-at-{home_anchor}"

    return Game(
        id=game_id,
        sport=sport,
        season=season,
        date=dt,
        home=TeamScore(
            school_id=home_id,
            name=raw["home"]["name"],
            score=home_score,
            logo_url=raw["home"].get("logo_url"),
        ),
        away=TeamScore(
            school_id=away_id,
            name=raw["away"]["name"],
            score=away_score,
            logo_url=raw["away"].get("logo_url"),
        ),
        status=status,
        conference=None,
        venue=raw.get("venue"),
        sources=["wiaa"],
    )


def _parse_datetime(date_iso: str, time_str: str | None) -> datetime | None:
    try:
        d = datetime.strptime(date_iso, "%Y-%m-%d")
    except ValueError:
        return None
    hour, minute = 19, 0  # default kickoff if WIAA didn't print a time
    if time_str:
        m = _TIME_RE.match(time_str.strip())
        if m:
            h = int(m.group(1)) % 12
            if m.group(3).upper() == "PM":
                h += 12
            hour, minute = h, int(m.group(2))
    return d.replace(hour=hour, minute=minute, tzinfo=CENTRAL)


def _parse_result(
    result: str | None,
    *,
    owner_school_id: str | None,
    home_id: str,
    away_id: str,
) -> tuple[int | None, int | None, GameStatus]:
    """WIAA prints results from the owning team's perspective; flip to home/away."""
    if not result:
        return None, None, GameStatus.SCHEDULED
    m = _RESULT_RE.match(result.strip())
    if not m:
        return None, None, GameStatus.SCHEDULED

    win = m.group(1).upper() == "W"
    owner_pts = int(m.group(2))
    opp_pts = int(m.group(3))

    if owner_school_id == home_id:
        return (
            owner_pts if win else opp_pts,
            opp_pts if win else owner_pts,
            GameStatus.FINAL,
        )
    if owner_school_id == away_id:
        return (
            opp_pts if win else owner_pts,
            owner_pts if win else opp_pts,
            GameStatus.FINAL,
        )
    return None, None, GameStatus.FINAL


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    return _SLUG_RE.sub("-", name.casefold()).strip("-")


def _build_standings(
    games: Iterable[Game],
    *,
    manifest: Manifest,
    sport: Sport,
    season: str,
) -> list[Standing]:
    by_school = manifest.by_id()
    sport_key = sport.value

    buckets: dict[str, dict[str, StandingRow]] = {}
    for school in manifest.schools:
        conf = school.conference_for(sport_key)
        if not conf:
            continue
        buckets.setdefault(conf, {})[school.id] = StandingRow(
            school_id=school.id,
            name=school.name,
            conference_wins=0,
            conference_losses=0,
            overall_wins=0,
            overall_losses=0,
            points_for=0,
            points_against=0,
        )

    for game in games:
        if game.status != GameStatus.FINAL:
            continue
        if game.home.score is None or game.away.score is None:
            continue

        home_school = by_school.get(game.home.school_id)
        away_school = by_school.get(game.away.school_id)
        home_conf = home_school.conference_for(sport_key) if home_school else None
        away_conf = away_school.conference_for(sport_key) if away_school else None
        same_conference = home_conf is not None and home_conf == away_conf

        for school_id, conf, scored, allowed, won in (
            (
                game.home.school_id,
                home_conf,
                game.home.score,
                game.away.score,
                game.home.score > game.away.score,
            ),
            (
                game.away.school_id,
                away_conf,
                game.away.score,
                game.home.score,
                game.away.score > game.home.score,
            ),
        ):
            if not school_id or not conf:
                continue
            row = buckets.get(conf, {}).get(school_id)
            if row is None:
                continue
            row.points_for = (row.points_for or 0) + scored
            row.points_against = (row.points_against or 0) + allowed
            if won:
                row.overall_wins += 1
            else:
                row.overall_losses += 1
            if same_conference:
                if won:
                    row.conference_wins += 1
                else:
                    row.conference_losses += 1

    standings: list[Standing] = []
    for conf, rows_by_school in buckets.items():
        rows = sorted(
            rows_by_school.values(),
            key=lambda r: (-r.conference_wins, r.conference_losses, -r.overall_wins),
        )
        standings.append(
            Standing(
                sport=sport,
                season=season,
                conference=conf,
                division=None,
                rows=rows,
            )
        )
    return standings
