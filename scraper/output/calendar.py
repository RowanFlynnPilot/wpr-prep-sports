"""Team calendar feeds (.ics) for phone calendar subscriptions.

Readers subscribe once and every game lands in Apple, Google or Outlook
calendar, with the result written into the event once it is final.
Research for review run 21 (2026-11-21): Bound, TeamSnap and SportsYou all
hand parents an iCal link per team, and a subscribed feed keeps the site's
name and game-page link on a parent's phone all season.

Two files per school, both under ``data/calendar/<school_id>/``:

    <sport>.ics   one team (school + sport)
    all.ics       every sport the school plays that the hub tracks

Everything here is pure (games in, text out) so it tests without the data
tree; ``scripts/build_calendars.py`` does the file I/O.

Format notes (RFC 5545):
* CRLF line endings, lines folded at 75 octets, TEXT values escaped.
* Times are written in UTC (``...Z``), so no VTIMEZONE block is needed and
  every client converts to the reader's zone. A game listed at local
  midnight has no real start time and becomes an all-day event.
* DTSTAMP is fixed per season, not "now": the feed is regenerated on every
  scrape, and a moving stamp would rewrite every file in every commit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

# Rough game lengths, for DTEND. Clients need an end; nobody needs it exact.
DURATION_MIN = {
    "football": 150,
    "boys_basketball": 90,
    "girls_basketball": 90,
    "volleyball": 120,
    "boys_hockey": 150,
    "girls_hockey": 150,
    "boys_soccer": 120,
    "girls_soccer": 120,
}
DEFAULT_DURATION_MIN = 120

# How often subscribed clients should re-fetch. Apple and Outlook honour
# these hints; Google polls on its own schedule (hours to a day).
REFRESH = "PT4H"

SITE_CONFIG = Path(__file__).resolve().parents[2] / "frontend" / "src" / "config" / "site.js"


@dataclass(frozen=True)
class Site:
    origin: str  # "https://sports.wausaupilotandreview.com" (no trailing slash)
    org_name: str  # "Wausau Pilot & Review"
    title: str  # "Central Wisconsin Prep Sports"

    @property
    def host(self) -> str:
        return re.sub(r"^https?://", "", self.origin).split("/")[0]


def read_site(path: Path = SITE_CONFIG) -> Site:
    """widgetOrigin / orgName / title from site.js (pure data; regex read,
    same as scripts/generate_site_card.py), so a white-label tenant's feeds
    carry its own name and links."""
    text = path.read_text(encoding="utf-8") if path.exists() else ""

    def field(name: str, default: str) -> str:
        m = re.search(rf'^\s*{name}:\s*"([^"]*)"', text, re.MULTILINE)
        return m.group(1) if m else default

    origin = field("widgetOrigin", "https://sports.wausaupilotandreview.com/").rstrip("/")
    title = f"{field('titleLead', 'Central Wisconsin')} {field('titleEm', 'Prep Sports')}"
    return Site(origin=origin, org_name=field("orgName", "Wausau Pilot & Review"), title=title)


def sport_label(sport: str) -> str:
    """'girls_basketball' -> 'Girls Basketball' (matches config/sports.js)."""
    return sport.replace("_", " ").title()


# ---------------------------------------------------------------- iCal text


def escape_text(value: str) -> str:
    """RFC 5545 TEXT escaping: backslash, semicolon, comma, newline."""
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def fold(line: str) -> str:
    """Fold a content line at 75 octets (continuations start with a space),
    never splitting a multi-byte UTF-8 character."""
    out: list[str] = []
    current = ""
    size = 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        if size + n > 75:
            out.append(current)
            current = " " + ch
            size = 1 + n
        else:
            current += ch
            size += n
    out.append(current)
    return "\r\n".join(out)


def _utc_stamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


# ---------------------------------------------------------------- games


def _parse_date(value: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else None


def is_forfeit_score(game: dict) -> bool:
    """WIAA posts forfeits as 1-0 / 2-0 finals in football and basketball
    (frontend utils/games.js isForfeitScore, same rule)."""
    h, a = game["home"].get("score"), game["away"].get("score")
    if not isinstance(h, int) or not isinstance(a, int):
        return False
    hi, lo = max(h, a), min(h, a)
    sport = game.get("sport", "")
    return (sport == "football" or "basketball" in sport) and hi in (1, 2) and lo == 0


def _venue_line(game: dict, schools: dict[str, dict]) -> str:
    venue = (game.get("venue") or "").strip()
    home = game["home"]
    if venue.startswith("@") or not venue:
        school = schools.get(home.get("school_id") or "")
        if school:
            place = school.get("full_name") or school.get("name") or home["name"]
            city = school.get("city")
            return f"{place}, {city}" if city else place
        return venue.lstrip("@").strip() or home["name"]
    return venue


def _neutral(game: dict) -> bool:
    """State and sectional sites name neither school (postseason.js
    isNeutralSite): those read 'vs', never 'at' the listed home side."""
    venue = (game.get("venue") or "").lower()
    if not game.get("playoff") or not venue or venue.startswith("@"):
        return False
    names = [game["home"]["name"].lower(), game["away"]["name"].lower()]
    return not any(n and n in venue for n in names)


def event_summary(game: dict, school_id: str | None, with_sport: bool = True) -> str:
    """The calendar line a parent reads in their day view, from the
    subscribed school's side: 'W 62-47 · Wausau West at Merrill · ...'."""
    home, away = game["home"], game["away"]
    if school_id and away.get("school_id") == school_id:
        own, opp, at = away, home, "vs" if _neutral(game) else "at"
    else:
        own, opp, at = home, away, "vs"
    matchup = f"{own['name']} {at} {opp['name']}"

    status = game.get("status")
    prefix = ""
    if status == "final":
        o, t = own.get("score"), opp.get("score")
        if isinstance(o, int) and isinstance(t, int):
            mark = "W" if o > t else "L" if o < t else "T"
            prefix = f"{mark} (forfeit) · " if is_forfeit_score(game) else f"{mark} {o}-{t} · "
    elif status == "postponed":
        prefix = "Postponed · "
    elif status == "cancelled":
        prefix = "Canceled · "

    parts = [prefix + matchup]
    if game.get("playoff_round"):
        parts.append(str(game["playoff_round"]))
    if with_sport:
        parts.append(sport_label(game.get("sport", "")))
    return " · ".join(parts)


def game_url(site: Site, game: dict) -> str:
    return f"{site.origin}/#/{game.get('sport')}/game/{game.get('id')}"


def render_event(
    game: dict,
    school_id: str | None,
    site: Site,
    schools: dict[str, dict],
    dtstamp: str,
    sponsor_line: str | None = None,
) -> list[str]:
    start = _parse_date(game.get("date", ""))
    if not start:
        return []
    lines = [
        "BEGIN:VEVENT",
        f"UID:{game['id']}@{site.host}",
        f"DTSTAMP:{dtstamp}",
    ]
    if start.hour == 0 and start.minute == 0:
        # Listed at midnight = no start time posted: an all-day event.
        day = start.date()
        lines.append(f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}")
        lines.append(f"DTEND;VALUE=DATE:{(day + timedelta(days=1)).strftime('%Y%m%d')}")
    else:
        minutes = DURATION_MIN.get(game.get("sport", ""), DEFAULT_DURATION_MIN)
        lines.append(f"DTSTART:{_utc_stamp(start)}")
        lines.append(f"DTEND:{_utc_stamp(start + timedelta(minutes=minutes))}")

    url = game_url(site, game)
    lines.append(f"SUMMARY:{escape_text(event_summary(game, school_id))}")
    lines.append(f"LOCATION:{escape_text(_venue_line(game, schools))}")
    desc = [f"Scores, stats and recap: {url}"]
    if game.get("status") != "final":
        desc.append(
            "Times come from WIAA school schedules and can change; "
            "this calendar updates when they do."
        )
    if sponsor_line:
        desc.append(sponsor_line)
    desc.append(f"{site.title} · {site.org_name}")
    lines.append(f"DESCRIPTION:{escape_text(chr(10).join(desc))}")
    lines.append(f"URL:{url}")
    if game.get("status") in ("postponed", "cancelled"):
        lines.append("STATUS:CANCELLED")
    elif game.get("status") != "final":
        lines.append("STATUS:CONFIRMED")
    # A game on the calendar never blocks a parent's day as "busy".
    lines.append("TRANSP:TRANSPARENT")
    lines.append("END:VEVENT")
    return lines


def season_stamp(games: Iterable[dict]) -> str:
    """A DTSTAMP that only moves when a new season starts: Aug 1 of the
    earliest game's school year (00:00 UTC)."""
    first: date | None = None
    for g in games:
        d = _parse_date(g.get("date", ""))
        if d and (first is None or d.date() < first):
            first = d.date()
    if first is None:
        return "20260801T000000Z"
    year = first.year if first.month >= 8 else first.year - 1
    return f"{year}0801T000000Z"


def render_calendar(
    name: str,
    description: str,
    games: list[dict],
    school_id: str | None,
    site: Site,
    schools: dict[str, dict],
    sponsor_line: str | None = None,
) -> str:
    """A whole VCALENDAR, CRLF-terminated, games in date order."""
    ordered = sorted(games, key=lambda g: (g.get("date", ""), g.get("id", "")))
    stamp = season_stamp(ordered)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:-//{escape_text(site.org_name)}//{escape_text(site.title)}//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(name)}",
        f"X-WR-CALDESC:{escape_text(description)}",
        "X-WR-TIMEZONE:America/Chicago",
        f"REFRESH-INTERVAL;VALUE=DURATION:{REFRESH}",
        f"X-PUBLISHED-TTL:{REFRESH}",
    ]
    seen: set[str] = set()
    for g in ordered:
        if g.get("id") in seen:
            continue
        seen.add(g.get("id"))
        lines.extend(render_event(g, school_id, site, schools, stamp, sponsor_line))
    lines.append("END:VCALENDAR")
    return "".join(fold(line) + "\r\n" for line in lines)


def team_games(games: Iterable[dict], school_id: str) -> list[dict]:
    return [
        g
        for g in games
        if g["home"].get("school_id") == school_id or g["away"].get("school_id") == school_id
    ]


def sponsor_line_from(sponsors: dict | None) -> str | None:
    """'Team calendars presented by X · https://...' from the `calendar`
    slot of data/sponsors.json, or None while the slot is unsold."""
    slot = ((sponsors or {}).get("slots") or {}).get("calendar") or {}
    name = (slot.get("name") or "").strip()
    if not name:
        return None
    label = (slot.get("label") or "Presented by").strip()
    link = (slot.get("link_url") or "").strip()
    return f"{label} {name}" + (f" · {link}" if link else "")


def build_all(
    games_by_sport: dict[str, list[dict]],
    schools: list[dict],
    site: Site,
    sponsors: dict | None = None,
) -> dict[str, str]:
    """Every feed, keyed by path relative to data/calendar/:
    '<school_id>/<sport>.ics' and '<school_id>/all.ics'. Only tracked
    schools with at least one game get files."""
    by_id = {s["id"]: s for s in schools if s.get("id")}
    sponsor = sponsor_line_from(sponsors)
    out: dict[str, str] = {}
    for school_id, school in by_id.items():
        name = school.get("name") or school_id
        every: list[dict] = []
        sports_played: list[str] = []
        for sport, games in games_by_sport.items():
            mine = team_games(games, school_id)
            if not mine:
                continue
            every.extend(mine)
            sports_played.append(sport_label(sport))
            out[f"{school_id}/{sport}.ics"] = render_calendar(
                name=f"{name} {sport_label(sport)}",
                description=(
                    f"{name} {sport_label(sport).lower()} schedule and results from "
                    f"{site.title} ({site.org_name}). {site.origin}/#/{sport}/team/{school_id}"
                ),
                games=mine,
                school_id=school_id,
                site=site,
                schools=by_id,
                sponsor_line=sponsor,
            )
        if every:
            out[f"{school_id}/all.ics"] = render_calendar(
                name=f"{name} sports",
                description=(
                    f"Every {name} team {site.title} covers: {', '.join(sports_played)}. "
                    f"Schedules and results from {site.org_name}."
                ),
                games=every,
                school_id=school_id,
                site=site,
                schools=by_id,
                sponsor_line=sponsor,
            )
    return out
