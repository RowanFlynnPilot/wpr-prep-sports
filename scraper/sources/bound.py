"""
Bound source — gobound.com — player statistics layer.

Bound's score pages and game-detail pages are actually server-rendered
HTML when fetched with a real browser User-Agent (they return a JS shell
to bot-y agents — we have to look like Chrome). With a normal UA we get
fully-rendered markup including the 8 stat-leader blocks per game:
passing, rushing, receiving, and tackles for each team.

What we do here:

1. `find_game_ids(date)` — for a given Friday/Saturday in football season,
   fetch Bound's scores page and harvest every game's Bound competition
   ID, paired with the team names and final score so we can match against
   the WIAA-scraped games.

2. `fetch_game_stats(comp_id)` — fetch one competition's detail page and
   parse out the per-team stat-leader blocks. Returns raw stat dicts;
   transform/normalize.py merges them into Game records.

Bound does not require auth. We keep the request rate polite (one fetch
per game per scrape cycle).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

BASE_URL = "https://www.gobound.com"

# Bound serves a JS shell to non-browser UAs. Using a real Chrome UA is
# the difference between getting no game data and getting fully-rendered
# stat tables. This isn't an attempt to deceive — Bound's content is
# public — we just have to ask for HTML the way browsers do.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class BoundGame:
    comp_id: str
    date: str        # YYYY-MM-DD
    away_team: str
    home_team: str
    away_score: int | None
    home_score: int | None


@dataclass(frozen=True)
class StatLine:
    """One stat-leader entry from Bound's box-score panel."""
    team_name: str         # the Bound-rendered name of the team this player plays for
    category: str          # "Passing Yards" | "Rushing Yards" | "Receiving Yards" | "Total Tackles"
    player_name: str
    player_year: str | None
    stats: dict[str, str]  # raw label → value, e.g. {"YDS": "197", "TDS": "1"}


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=20.0,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _get(url: str, params: dict | None = None) -> str:
    with _client() as client:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        return resp.text


# ---------------------------------------------------------------------------
# Scores index: date → list of (comp_id, away, home, scores)
# ---------------------------------------------------------------------------


_GAME_ROW_RE = re.compile(
    r'<tr[^>]+data-id="([^"]+)"[^>]*>(.*?)</tr>',
    re.DOTALL,
)
_SPAN_RE = re.compile(r"<span[^>]*>\s*([^<]{2,40}?)\s*</span>")
_SCORE_RE = re.compile(r'<span class="d-block[^"]*">\s*([^<]+?)\s*</span>')


def find_game_ids(date: str, season: str = "2025-26", sport_abbr: str = "fb") -> list[BoundGame]:
    """Return every game Bound has on a given ISO date."""
    url = f"{BASE_URL}/wi/wiaa/{sport_abbr}/{season}/scores"
    html = _get(url, params={"selectedDate": date})

    games: list[BoundGame] = []
    for comp_id, body in _GAME_ROW_RE.findall(html):
        team_spans = _SPAN_RE.findall(body)
        teams = [
            t for t in team_spans
            if t not in {"vs.", "FINAL", "C", "Home", "Away"}
            and not re.match(r"^[\d\-:]+$", t)
        ]
        if len(teams) < 2:
            continue
        away_team, home_team = teams[0], teams[1]

        score_match = _SCORE_RE.search(body)
        away_score, home_score = None, None
        if score_match:
            m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", score_match.group(1))
            if m:
                away_score, home_score = int(m.group(1)), int(m.group(2))

        games.append(
            BoundGame(
                comp_id=comp_id,
                date=date,
                away_team=away_team,
                home_team=home_team,
                away_score=away_score,
                home_score=home_score,
            )
        )
    return games


# ---------------------------------------------------------------------------
# Game detail: comp_id → list of stat lines
# ---------------------------------------------------------------------------


def fetch_game_stats(comp_id: str, season: str = "2025-26", sport_abbr: str = "fb") -> list[StatLine]:
    """
    Fetch one game's stat-leader blocks.

    Bound shows up to 8 blocks per game: passing / rushing / receiving /
    tackles, for each of the two teams. Each block's header is shaped
    "{Category} | {Player Name}, {Year}" with stat key/value pairs in
    the body. Empty categories show "No Stats" — those are skipped.
    """
    url = f"{BASE_URL}/wi/wiaa/{sport_abbr}/{season}/comps/{comp_id}"
    html = _get(url)

    title_match = re.search(r"<title>[^|]+\|\s*([^|]+)\s+vs\.\s+([^|]+?)\s*\|", html)
    away_team = title_match.group(1).strip() if title_match else ""
    home_team = title_match.group(2).strip() if title_match else ""

    soup = BeautifulSoup(html, "lxml")

    # Bound renders the away team's stat blocks first, then the home
    # team's, but other <li.list-group-item> elements on the page
    # (sidebars, etc.) break a naive "first half = away" split. Detect
    # team boundary instead by tracking which stat categories we've
    # already seen — when a category repeats, we've flipped sides.
    lines: list[StatLine] = []
    current_team = away_team
    seen_categories: set[str] = set()
    seen_no_stats: set[str] = set()  # for "No Stats" blocks (no player) we also count

    for li in soup.select("li.list-group-item"):
        h7 = li.find("h7")
        if not h7:
            continue
        header = h7.get_text(" ", strip=True)

        # Detect "No Stats" entries — they still mark a category and so
        # contribute to side detection.
        no_stats = "|" not in header
        category = header.split("|", 1)[0].strip() if not no_stats else header.strip()

        # Side flip: if this category was already seen for the current side
        # (in either stat-bearing or "No Stats" form), we've crossed over.
        if category in seen_categories or category in seen_no_stats:
            current_team = home_team if current_team == away_team else away_team
            seen_categories = set()
            seen_no_stats = set()

        if no_stats:
            seen_no_stats.add(category)
            continue
        seen_categories.add(category)

        player_part = header.split("|", 1)[1].strip()
        player_name, player_year = player_part, None
        if "," in player_part:
            split_idx = player_part.rfind(",")
            player_name = player_part[:split_idx].strip()
            player_year = player_part[split_idx + 1:].strip()

        # Body div sits next to the h7; pull alternating <strong>K</strong> V pairs.
        stats: dict[str, str] = {}
        body_div = h7.find_next_sibling("div")
        if body_div is not None:
            current_key: str | None = None
            for kid in body_div.children:
                name = getattr(kid, "name", None)
                if name == "strong":
                    current_key = kid.get_text(strip=True)
                else:
                    text = (kid.get_text(strip=True) if hasattr(kid, "get_text") else str(kid)).strip()
                    if current_key and text:
                        stats[current_key] = text
                        current_key = None

        lines.append(
            StatLine(
                team_name=current_team,
                category=category,
                player_name=player_name,
                player_year=player_year,
                stats=stats,
            )
        )

    return lines


# ---------------------------------------------------------------------------
# Season stats: per-team aggregate tables
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SeasonStatRow:
    """One athlete's season totals in one category (Bound team stats page)."""
    category: str                 # "Passing" | "Rushing" | "Receiving" | "Defense"
    player_name: str
    player_year: str | None
    jersey: str | None
    stats: dict[str, str]         # column header → cell value, e.g. {"YDS": "1247", "TDS": "12"}


# Map the category title on Bound's stats page → our canonical category key,
# per sport. Bound's titles vary by sport: football has Passing/Rushing/
# Receiving/Defense; basketball collapses everything into a single "Player
# Stats" card; volleyball splits into Offense/Defense/Serving. Anything not
# in this map is silently ignored.
_CATEGORY_BY_TITLE_BY_SPORT: dict[str, dict[str, str]] = {
    "fb": {
        "Passing": "Passing",
        "Rushing": "Rushing",
        "Receiving": "Receiving",
        "Tackles": "Defense",
        "Defense": "Defense",
    },
    "boysbasketball": {
        "Player Stats": "Basketball",
    },
    "girlsbasketball": {
        "Player Stats": "Basketball",
    },
    "vb": {
        "Offense": "Volleyball Offense",
        "Defense": "Volleyball Defense",
        "Serving": "Volleyball Serving",
    },
}

# Backwards-compatible alias — old callers reading the football map directly.
_CATEGORY_BY_TITLE = _CATEGORY_BY_TITLE_BY_SPORT["fb"]


def fetch_team_season_stats(
    slug: str,
    *,
    season: str = "2025-26",
    sport_abbr: str = "fb",
    level: str = "v",
) -> list[SeasonStatRow]:
    """
    Fetch one team's full season stats from Bound.

    Each "card" on the page wraps a stat category — for football
    Passing/Rushing/Receiving/Defense, for basketball a single "Player
    Stats" card, for volleyball Offense/Defense/Serving — with a table
    whose header row defines the column keys (YDS, TDS, INT, etc.) and
    whose body rows are athletes. First cell is "{jersey}, {player
    name}, {YR}".

    Returns flattened SeasonStatRow records. The caller is responsible
    for resolving these into our manifest school (the slug itself is
    already mapped one level up).
    """
    url = f"{BASE_URL}/wi/wiaa/{sport_abbr}/{season}/{slug}/{level}/stats"
    html = _get(url)
    soup = BeautifulSoup(html, "lxml")

    category_map = _CATEGORY_BY_TITLE_BY_SPORT.get(sport_abbr, {})

    out: list[SeasonStatRow] = []
    for card in soup.select("div.card-table"):
        title_el = card.select_one(".card-title")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        category = category_map.get(title)
        if category is None:
            continue

        table = card.find("table")
        if table is None:
            continue
        # Column headers — sortable header anchors hold the canonical short
        # label (YDS, TDS, etc.); fall back to the th's title attribute.
        col_keys: list[str] = []
        for th in table.select("thead th"):
            label_anchor = th.find("a")
            if label_anchor and label_anchor.get_text(strip=True):
                col_keys.append(label_anchor.get_text(strip=True))
            else:
                col_keys.append(th.get_text(strip=True))

        for tr in table.select("tbody tr"):
            cells = tr.find_all("td")
            if not cells:
                continue
            athlete_text = cells[0].get_text(" ", strip=True)
            jersey, player_name, player_year = _parse_athlete_cell(athlete_text)
            stats: dict[str, str] = {}
            # cells[0] is the Athlete column; the rest line up with col_keys[1:]
            for key, td in zip(col_keys[1:], cells[1:]):
                value = td.get_text(" ", strip=True)
                if value:
                    stats[key] = value
            out.append(
                SeasonStatRow(
                    category=category,
                    player_name=player_name,
                    player_year=player_year,
                    jersey=jersey,
                    stats=stats,
                )
            )
    return out


_ATHLETE_RE = re.compile(
    r"^\s*(?:(\d+),\s*)?(.+?)(?:,\s*([A-Z]{2}))?\s*$",
)


def _parse_athlete_cell(text: str) -> tuple[str | None, str, str | None]:
    """
    Bound formats the athlete cell as "{jersey}, {Player Name}, {YR}".
    Jersey and year are optional; the name itself can contain spaces.
    """
    m = _ATHLETE_RE.match(text)
    if not m:
        return None, text.strip(), None
    jersey, name, year = m.group(1), m.group(2).strip(), m.group(3)
    return jersey, name, year


# ---------------------------------------------------------------------------
# Legacy entry point
# ---------------------------------------------------------------------------


def fetch(sport: str, season: str) -> list[dict]:
    """Legacy no-op kept so existing main.py imports don't break during rollout."""
    _ = (sport, season)
    return []
