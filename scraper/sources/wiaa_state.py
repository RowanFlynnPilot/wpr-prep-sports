"""
WIAA state-tournament games — www.wiaawi.org per-sport pages.

Why this source exists (root cause found 2026-10-31): no season we ever
scraped held a STATE-level game. WIAA's two machine-readable surfaces both
stop at the last tournament-*series* round:

- `schools.wiaawi.org/Directory/Schedule/Index?TeamID=X` (our backbone):
  Edgar's 2025 football schedule (TeamID 128267) ends at the 2025-11-14
  "WIAA Tournament - Level4" row vs Mondovi; the Nov 20 D6 final at Camp
  Randall (Darlington 42, Edgar 18) is not on it. Same for Gilman 8-player
  (ends at Level4, Nov 8), Newman Catholic / SPASH volleyball (end at
  "Sectional Final", Nov 1) and Prentice boys basketball (ends Mar 14).
- ScoreCenter `GameResultsList` (ContestType=10): `Global/GetTournRounds`
  lists rounds 1-4 for football and 1-5 for volleyball/soccer, i.e. the
  series only.
- The tournaments.wiaawi.org bracket files (the old halftime.wiaawi.org
  /CustomApps/Tournaments/Brackets/HTML/ URLs redirect there) end in
  "State Qualifier" slots and stop updating at the sectional/Level 4 night
  ("[Last Updated: 11-14-2025 - 9:30PM]" on the 2025 D6 football bracket).

The state games live only on WIAA's editorial sport pages, as hand-typed
prose:

- `/sports/<sport>/<sport>-tournament` — the CURRENT season's "Tournament
  Schedule & Results" block (placeholders like "#2 Seed vs. #7 Seed" until
  teams are known, then results), plus a hero with the dates and venue.
- `/sports/<sport>/<sport>-state-archive(s)` — one accordion per year,
  "<YYYY> Tournament Results", where that block lands after the season.

Line shapes seen (all handled by `parse_result_line`):

    10 a.m. – Division 7:  Kenosha St. Joseph Catholic (14-0) 35, Cochrane-Fountain City (13-1), 19 - Stats
    #2 Hamilton (37-8) def. #7 Verona (30-6) - 25-20, 25-9, 25-11 - Stats
    #2 Marquette (11-5-4) 3, #3 Hudson (20-0-3) 3 (Marquette advances with 4-2 SO) - Stats
    Game 3 - Waukesha West (15-4-2) 0, Elkhorn (20-0) 0 (Waukesha West wins shootout 2-1)
    McDonell Central Catholic (12-1) 22, vs. Gilman (12-1) 0 - Stats

Round/date headers ("Quarterfinals - Thursday, Nov. 6", "Saturday, March 7
(Championship)", "Thursday, Nov. 20") and "Division N" headers carry state
across lines. Prose is fragile by nature: the fixture tests pin today's
shapes, and `data/state_games.json` (see `load_state_overrides`) is the
manual escape hatch when WIAA types something new.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

BASE_URL = "https://www.wiaawi.org"
USER_AGENT = "wpr-prep-sports/0.1 (+https://wausaupilotandreview.com)"
POLITE_DELAY_SECONDS = 1.0

# Sport key -> [(tournament page path, archive page path)]. Football has two
# tournaments (11-player at Camp Randall, 8-player at its own site). Slugs are
# WIAA's and are NOT uniform ("-state-archive" vs "-state-archives"); every
# one below was fetched 2026-10-31.
STATE_PAGES: dict[str, list[tuple[str, str]]] = {
    "football": [
        ("/sports/football/football-tournament", "/sports/football/football-state-archive"),
        (
            "/sports/8-player-football/8-player-football-tournament",
            "/sports/8-player-football/8-player-football-state-archive",
        ),
    ],
    "volleyball": [
        (
            "/sports/girls-volleyball/girls-volleyball-tournament",
            "/sports/girls-volleyball/girls-volleyball-state-archive",
        )
    ],
    "boys_soccer": [
        (
            "/sports/boys-soccer/boys-soccer-tournament",
            "/sports/boys-soccer/boys-soccer-state-archive",
        )
    ],
    "girls_soccer": [
        (
            "/sports/girls-soccer/girls-soccer-tournament",
            "/sports/girls-soccer/girls-soccer-state-archive",
        )
    ],
    "boys_basketball": [
        (
            "/sports/boys-basketball/boys-basketball-tournament",
            "/sports/boys-basketball/boys-basketball-state-archive",
        )
    ],
    "girls_basketball": [
        (
            "/sports/girls-basketball/girls-basketball-tournament",
            "/sports/girls-basketball/girls-basketball-state-archives",
        )
    ],
    "boys_hockey": [
        (
            "/sports/boys-hockey/boys-hockey-tournament",
            "/sports/boys-hockey/boys-hockey-state-archives",
        )
    ],
    "girls_hockey": [
        (
            "/sports/girls-hockey/girls-hockey-tournament",
            "/sports/girls-hockey/girls-hockey-state-archives",
        )
    ],
}

# Calendar year of the state tournament relative to the season's start year:
# fall sports finish in the start year, winter/spring sports the next one.
_TOURNAMENT_YEAR_OFFSET = {
    "football": 0,
    "volleyball": 0,
    "boys_soccer": 0,
    "boys_basketball": 1,
    "girls_basketball": 1,
    "boys_hockey": 1,
    "girls_hockey": 1,
    "girls_soccer": 1,
}

# Football's state pages name no round on the game lines — every 11-player
# game at Camp Randall is a division final (Level 4 is the semifinal), and
# the 8-player page heads its one game "Championship Game".
_DEFAULT_ROUND = {"football": "State Championship"}


@dataclass
class StateGame:
    """One state-tournament game as WIAA printed it. Team order is WIAA's
    (winner first on result lines) and carries no home/away meaning — the
    normalizer picks a canonical orientation for these neutral-site games."""

    sport: str
    date: date
    round: str
    team_a: str
    team_b: str
    score_a: int | None = None
    score_b: int | None = None
    time: str | None = None  # "7:00PM", the format normalize._parse_datetime takes
    division: str | None = None
    venue: str | None = None
    note: str | None = None  # "(OT)", "(Marquette advances with 4-2 SO)"
    set_scores: list[tuple[int, int]] = field(default_factory=list)  # (a, b) per set
    source: str = "wiaa-state"


def tournament_year(sport: str, season: str) -> int:
    return int(season.split("-")[0]) + _TOURNAMENT_YEAR_OFFSET.get(sport, 0)


# ---------------------------------------------------------------------------
# Text plumbing
# ---------------------------------------------------------------------------

_BLOCK_TAGS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "li", "tr")


def _norm(text: str) -> str:
    text = text.replace("\xa0", " ").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text).strip()


def _block_lines(el) -> list[str]:
    """An element's text as lines, breaking at <br> and block tags only —
    inline tags (<strong>, <a>) stay on their line, so "Semifinals -
    <strong>Friday, June 19</strong>" reads as one header."""
    el = BeautifulSoup(str(el), "lxml")
    for br in el.find_all("br"):
        br.replace_with("\n")
    for tag in el.find_all(_BLOCK_TAGS):
        tag.insert_before("\n")
        tag.append("\n")
    lines = []
    for raw in el.get_text("").split("\n"):
        line = _norm(raw)
        if line and line.lower() not in ("stats", "boxscore", "box score", "-"):
            lines.append(line)
    return lines


_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}
_DATE_RE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b", re.IGNORECASE
)
_TIME_RE = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?", re.IGNORECASE)
_ROUND_RE = re.compile(
    r"\b(quarterfinals?|semifinals?|championship(?:\s+(?:final|game))?|finals?)\b", re.IGNORECASE
)
_DIVISION_RE = re.compile(r"^division\s+(\d)\b", re.IGNORECASE)
_TEAM_RE = re.compile(
    r"\s*(?:#(?P<seed>\d+)\s*)?(?P<name>[^#()]+?)\s*\((?P<rec>\d{1,2}-\d{1,2}(?:-\d{1,2})?)\)"
)
_SCORE_RE = re.compile(r"\s*,?\s*(\d{1,3})(?!\s*-\s*\d)\b")
_CONNECTOR_RE = re.compile(r"\s*,?\s*(?:(?:vs\.?|def\.?|defeated|over)\s+)?", re.IGNORECASE)
_LINE_PREFIX_RE = re.compile(
    r"^(?:\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?\s*-?\s*"
    r"|(?:division|div\.?)\s*(?P<div>\d)\s*[:\-]\s*"
    r"|game\s*\d+\s*[:\-]\s*)",
    re.IGNORECASE,
)
_PLACEHOLDER_RE = re.compile(r"\b(seed|winner|loser|tbd|tba)\b", re.IGNORECASE)
_VENUE_RE = re.compile(r"\b(center|stadium|arena|park|fieldhouse|field|randall)\b", re.IGNORECASE)


def _parse_time(text: str) -> str | None:
    m = _TIME_RE.search(text)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    if not 1 <= hour <= 12:
        return None
    return f"{hour}:{minute:02d}{m.group(3).upper()}M"


def _parse_date(text: str, year: int) -> date | None:
    m = _DATE_RE.search(text)
    if not m:
        return None
    try:
        return date(year, _MONTHS[m.group(1).lower()[:3]], int(m.group(2)))
    except ValueError:
        return None


def _round_label(text: str) -> str | None:
    m = _ROUND_RE.search(text)
    if not m:
        return None
    word = m.group(1).lower()
    if word.startswith("quarter"):
        return "State Quarterfinal"
    if word.startswith("semi"):
        return "State Semifinal"
    if word.startswith("championship"):
        return "State Championship"
    return "State Final"


def _clean_name(name: str) -> str:
    return _norm(name).strip(" ,-")


# ---------------------------------------------------------------------------
# Line + block parsing
# ---------------------------------------------------------------------------


def parse_result_line(line: str, *, sport: str) -> dict[str, Any] | None:
    """Parse one game line into {team_a, team_b, score_a, score_b, division,
    time, note, set_scores}, or None when the line isn't a game with two
    real teams (headers, prose, "#2 Seed vs. #7 Seed" placeholders)."""
    text = _norm(line)
    division = None
    while True:
        m = _LINE_PREFIX_RE.match(text)
        if not m or m.end() == 0:
            break
        if m.group("div"):
            division = m.group("div")
        text = text[m.end() :]
    line_time = _parse_time(line)

    m1 = _TEAM_RE.match(text)
    if m1 is None:
        return _parse_recordless_line(text, sport=sport, division=division, line_time=line_time)
    rest = text[m1.end() :]
    s1 = _SCORE_RE.match(rest)
    score_a = int(s1.group(1)) if s1 else None
    if s1:
        rest = rest[s1.end() :]
    rest = rest[_CONNECTOR_RE.match(rest).end() :]
    m2 = _TEAM_RE.match(rest)
    if m2 is None:
        return None
    tail = rest[m2.end() :]
    s2 = _SCORE_RE.match(tail)
    score_b = int(s2.group(1)) if s2 else None
    if s2:
        tail = tail[s2.end() :]

    team_a, team_b = _clean_name(m1.group("name")), _clean_name(m2.group("name"))
    if not team_a or not team_b or _PLACEHOLDER_RE.search(team_a + " " + team_b):
        return None

    note_m = re.search(r"\(([^)]*)\)", tail)
    note = note_m.group(1).strip() if note_m else None
    set_scores: list[tuple[int, int]] = []
    if sport == "volleyball":
        sets_text = re.sub(r"\([^)]*\)", "", tail)
        set_scores = [
            (int(a), int(b)) for a, b in re.findall(r"(\d{1,2})\s*-\s*(\d{1,2})", sets_text)
        ]
        if set_scores:
            score_a = sum(1 for a, b in set_scores if a > b)
            score_b = sum(1 for a, b in set_scores if b > a)
    if score_a is None or score_b is None:
        score_a = score_b = None
    return {
        "team_a": team_a,
        "team_b": team_b,
        "score_a": score_a,
        "score_b": score_b,
        "division": division,
        "time": line_time,
        "note": note,
        "set_scores": set_scores,
    }


def _parse_recordless_line(
    text: str, *, sport: str, division: str | None, line_time: str | None
) -> dict[str, Any] | None:
    """Scheduled pairings typed without records ("#2 Hamilton vs. #7 Verona
    - 5 p.m."). Unresolvable names are dropped later by the tracked-school
    filter, so a stray prose "vs." costs nothing."""
    if _PLACEHOLDER_RE.search(text):
        return None
    parts = re.split(r"\s+(?:vs\.?|def\.?)\s+", text, maxsplit=1, flags=re.IGNORECASE)
    if len(parts) != 2:
        return None
    a = re.sub(r"^#\d+\s*", "", parts[0])
    b = re.sub(r"^#\d+\s*", "", re.split(r"\s+-\s+|\s*\(", parts[1], maxsplit=1)[0])
    a, b = _clean_name(a), _clean_name(b)
    if not a or not b or len(a) > 60 or len(b) > 60 or re.search(r"\d", a + b):
        return None
    return {
        "team_a": a,
        "team_b": b,
        "score_a": None,
        "score_b": None,
        "division": division,
        "time": line_time,
        "note": None,
        "set_scores": [],
    }


def parse_state_block(
    lines: list[str], *, sport: str, year: int, venue: str | None = None
) -> list[StateGame]:
    """Walk a results block's lines, carrying division / round / date /
    time headers down onto each game line."""
    out: list[StateGame] = []
    division: str | None = None
    round_label: str | None = None
    day: date | None = None
    header_time: str | None = None
    for line in lines:
        game = parse_result_line(line, sport=sport)
        if game is None:
            dm = _DIVISION_RE.match(line)
            if dm:
                division, round_label, header_time = dm.group(1), None, None
                continue
            new_round = _round_label(line)
            new_day = _parse_date(line, year)
            if venue is None and not (new_round or new_day) and _VENUE_RE.search(line):
                venue = line
                continue
            if new_round:
                round_label = new_round
            if new_day:
                day = new_day
                header_time = _parse_time(line)
            elif new_round:
                header_time = _parse_time(line) or header_time
            continue
        if day is None:
            continue
        out.append(
            StateGame(
                sport=sport,
                date=day,
                round=round_label or _DEFAULT_ROUND.get(sport, "State Championship"),
                team_a=game["team_a"],
                team_b=game["team_b"],
                score_a=game["score_a"],
                score_b=game["score_b"],
                time=game["time"] or header_time,
                division=game["division"] or division,
                venue=venue,
                note=game["note"],
                set_scores=game["set_scores"],
            )
        )
    return out


def parse_tournament_page(html: str, *, sport: str, year: int) -> list[StateGame]:
    """The current-season `<sport>-tournament` page. Returns [] unless the
    hero's dates are in `year` — at rollover the page can still show the
    previous season, whose results must not be stamped with this year."""
    soup = BeautifulSoup(html, "lxml")
    years = {t.get("datetime", "")[:4] for t in soup.select(".tournament__location time[datetime]")}
    if str(year) not in years:
        return []
    venue_el = soup.select_one(".tournament__venue")
    venue = _norm(venue_el.get_text(" ")) if venue_el else None
    for block in soup.select(".text-long"):
        heading = block.find(["h2", "h3"])
        if heading and "schedule" in heading.get_text().lower():
            return parse_state_block(_block_lines(block), sport=sport, year=year, venue=venue)
    return []


def parse_archive_page(html: str, *, sport: str, year: int) -> list[StateGame]:
    """The `<sport>-state-archive(s)` page: the accordion item titled
    "<year> ..." ("2025 Tournament Results", "2026 State Boys Basketball
    Tournament")."""
    soup = BeautifulSoup(html, "lxml")
    for item in soup.select(".accordion__item"):
        title = item.select_one(".accordion__title")
        if title is None or not re.match(rf"^\s*{year}\b", title.get_text(" ")):
            continue
        content = item.select_one(".accordion__content") or item
        return parse_state_block(_block_lines(content), sport=sport, year=year)
    return []


def _key(g: StateGame) -> tuple:
    names = frozenset(re.sub(r"\s+", " ", n.casefold()) for n in (g.team_a, g.team_b))
    return (g.date, names)


def merge_state_rows(*sources: list[StateGame]) -> list[StateGame]:
    """Union of row lists, one row per (date, pair). Earlier sources win,
    except that a scored row always replaces a scoreless one."""
    merged: dict[tuple, StateGame] = {}
    for rows in sources:
        for g in rows:
            k = _key(g)
            prev = merged.get(k)
            if prev is None or (prev.score_a is None and g.score_a is not None):
                merged[k] = g
    return sorted(merged.values(), key=lambda g: (g.date, g.time or "", g.team_a))


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    return isinstance(exc, (httpx.TransportError, httpx.TimeoutException))


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _get(client: httpx.Client, url: str) -> str:
    resp = client.get(url)
    resp.raise_for_status()
    return resp.text


def fetch_state_games(sport: str, season: str, *, console=None) -> list[StateGame]:
    """Every state-tournament game WIAA has posted for `sport`/`season`
    (tracked or not — the normalizer filters). Never raises: a page that
    fails or changes shape logs and contributes nothing, so the schedule
    scrape still publishes."""
    pages = STATE_PAGES.get(sport)
    if not pages:
        return []
    year = tournament_year(sport, season)
    current: list[StateGame] = []
    archived: list[StateGame] = []
    with httpx.Client(
        timeout=25.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
    ) as client:
        first = True
        for tourn_path, archive_path in pages:
            for path, parser, bucket in (
                (tourn_path, parse_tournament_page, current),
                (archive_path, parse_archive_page, archived),
            ):
                if not first:
                    time.sleep(POLITE_DELAY_SECONDS)
                first = False
                try:
                    html = _get(client, BASE_URL + path)
                    bucket.extend(parser(html, sport=sport, year=year))
                except Exception as e:  # noqa: BLE001 — never sink the scrape
                    if console is not None:
                        console.print(f"[yellow]  state page {path} failed: {e}[/yellow]")
    rows = merge_state_rows(current, archived)
    if console is not None:
        console.print(f"  WIAA state pages: {len(rows)} {sport} state game(s) for {year}")
    return rows


# ---------------------------------------------------------------------------
# Manual override (data/state_games.json)
# ---------------------------------------------------------------------------


def load_state_overrides(path: Path, sport: str, season: str) -> list[StateGame]:
    """Editor-entered state games for when WIAA's prose defeats the parser
    or posts late. Schema in docs/data-sources.md ("State tournament
    games"). Missing file = no overrides; a malformed row is skipped with a
    printed warning rather than failing the scrape."""
    if not path.exists():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"[wiaa_state] WARN unreadable {path}: {e}")
        return []
    rows = doc.get("games", []) if isinstance(doc, dict) else doc
    out: list[StateGame] = []
    for row in rows:
        if row.get("sport") != sport or row.get("season") != season:
            continue
        try:
            sets = [(int(a), int(b)) for a, b in row.get("set_scores") or []]
            out.append(
                StateGame(
                    sport=sport,
                    date=date.fromisoformat(row["date"]),
                    round=row["round"],
                    team_a=row["home"],
                    team_b=row["away"],
                    score_a=row.get("home_score"),
                    score_b=row.get("away_score"),
                    time=_parse_time(row["time"]) if row.get("time") else None,
                    division=row.get("division"),
                    venue=row.get("venue"),
                    note=row.get("note"),
                    set_scores=sets,
                    source="state-override",
                )
            )
        except (KeyError, TypeError, ValueError) as e:
            print(f"[wiaa_state] WARN skipping bad override row {row!r}: {e}")
    return out


# ---------------------------------------------------------------------------
# Fixture trimming (tests/capture_fixtures.py --state)
# ---------------------------------------------------------------------------


def trim_page_for_fixture(html: str, *, keep_years: int = 2) -> str:
    """Keep only what the parsers read (hero location, the schedule block,
    the newest `keep_years` archive accordions) so fixtures stay small."""
    soup = BeautifulSoup(html, "lxml")
    parts = [str(el) for el in soup.select(".tournament__location-list")]
    for block in soup.select(".text-long"):
        heading = block.find(["h2", "h3"])
        if heading and "schedule" in heading.get_text().lower():
            parts.append(str(block))
    parts += [str(item) for item in soup.select(".accordion__item")[:keep_years]]
    return "<html><body><main>\n" + "\n".join(parts) + "\n</main></body></html>\n"
