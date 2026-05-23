"""
Wisconsin Prep Hockey source — wisconsinprephockey.net.

Used for hockey stats (Bound doesn't have hockey, MaxPreps hockey is
empty for our schools — see hockey_stats_gap.md memory note for the
investigation history).

Provides per-team season totals in two categories:
  - Skater stats: GP, G, A, PTS, SOG, PPG, PEN, PIM, ...
  - Goalie stats: GP, MIN, W, L, T, SOG, GA, SV, GAA, SV%, SO

How it works:

  1. `find_team_instance_id(team_page_id, subseason)` — fetches a team
     page and parses out the team_instance_id (varies per season). The
     team_page_id is stable across seasons; we store it in the manifest.

  2. `fetch_team_season_stats(team_instance_id, subseason)` — pulls the
     per-team player-stats page and returns flattened skater + goalie
     rows.

URL conventions:

  /page/show/<team_page_id>?subseason=<subseason>
      Team landing page. Contains the team_instance_id in subnav hrefs.

  /stats/team_instance/<team_instance_id>?subseason=<subseason>&
      tab=team_instance_player_stats&tool=<tool>
      Player-stats page with skater + goalie tables.

  /schedule/team_instance/<team_instance_id>?subseason=<subseason>
      Schedule page with game-show links and result strings.

Subseason values discovered 2026-05-23:
  boys hockey 2025-26 varsity → 951906
  girls hockey 2025-26 varsity → 953552
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

BASE_URL = "https://www.wisconsinprephockey.net"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Stat-tool IDs observed on the player-stats page. These appear stable
# enough that we just hardcode rather than discovering per-fetch.
DEFAULT_TOOL_ID = 5762186

# Subseason IDs by (sport_key, season).
SUBSEASONS: dict[tuple[str, str], int] = {
    ("boys_hockey", "2025-26"): 951906,
    ("girls_hockey", "2025-26"): 953552,
}


@dataclass(frozen=True)
class SkaterRow:
    jersey: str | None
    player_name: str
    stats: dict[str, str]  # GP, G, A, PTS, SOG, PPG, ... — raw header → value


@dataclass(frozen=True)
class GoalieRow:
    jersey: str | None
    player_name: str
    stats: dict[str, str]  # GP, MIN, W, L, SV, GAA, SV%, ...


# ---------------------------------------------------------------------------
# HTTP plumbing
# ---------------------------------------------------------------------------


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=20.0,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _get(url: str) -> str:
    with _client() as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.text


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


_TEAM_INSTANCE_RE = re.compile(r"/(?:schedule|stats|roster)/team_instance/(\d+)")


def find_team_instance_id(team_page_id: int, subseason: int) -> int | None:
    """
    Parse the team_instance_id out of a team page's subnav hrefs. Returns
    None if the page can't be loaded or the link isn't present (e.g. the
    school doesn't field that sport this season).
    """
    url = f"{BASE_URL}/page/show/{team_page_id}?subseason={subseason}"
    try:
        html = _get(url)
    except httpx.HTTPError:
        return None
    m = _TEAM_INSTANCE_RE.search(html)
    return int(m.group(1)) if m else None


# Skater and goalie tables are distinguishable by their header set. Goalies
# always carry MIN/SV/GAA; skaters always carry G/A/PTS without GAA.
_SKATER_HEADERS = {"G", "A", "PTS", "SOG"}
_GOALIE_HEADERS = {"MIN", "SV", "GAA"}


def _table_kind(headers: list[str]) -> str | None:
    h = set(headers)
    if _GOALIE_HEADERS.issubset(h):
        return "goalie"
    if _SKATER_HEADERS.issubset(h):
        return "skater"
    return None


_ATHLETE_NUM_RE = re.compile(r"^\s*(\d+)\s*$")


def fetch_team_season_stats(
    team_instance_id: int,
    *,
    subseason: int,
    tool_id: int = DEFAULT_TOOL_ID,
) -> tuple[list[SkaterRow], list[GoalieRow]]:
    """
    Pull a team's full-season stats from the player-stats page.

    Returns (skaters, goalies). The page sometimes carries multiple
    matching tables (e.g. varsity + JV); we accumulate from all that
    parse cleanly. The "Totals" footer row is filtered out.
    """
    url = (
        f"{BASE_URL}/stats/team_instance/{team_instance_id}"
        f"?subseason={subseason}&tab=team_instance_player_stats&tool={tool_id}"
    )
    html = _get(url)
    soup = BeautifulSoup(html, "lxml")

    skaters: list[SkaterRow] = []
    goalies: list[GoalieRow] = []

    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        # Strip trailing "Totals" header cells that some tables include.
        # Body rows have empty header context — keep only the leading set.
        kind = _table_kind(headers)
        if kind is None:
            continue
        # Find the canonical column order from the thead row specifically
        thead = table.find("thead")
        if thead is not None:
            cols = [th.get_text(strip=True) for th in thead.find_all("th")]
        else:
            cols = headers
        if not cols or cols[0] != "#":
            continue

        for tr in table.find_all("tr"):
            cells = tr.find_all("td")
            if not cells:
                continue  # header row
            values = [td.get_text(" ", strip=True) for td in cells]
            if len(values) < len(cols):
                continue
            jersey_cell = values[0]
            if not _ATHLETE_NUM_RE.match(jersey_cell):
                # "Totals" row or similar
                continue
            jersey = jersey_cell.strip()
            player_name = values[1].strip()
            if not player_name:
                continue
            stats = {cols[i]: values[i] for i in range(2, len(cols))}
            if kind == "skater":
                skaters.append(SkaterRow(jersey=jersey, player_name=player_name, stats=stats))
            else:
                goalies.append(GoalieRow(jersey=jersey, player_name=player_name, stats=stats))

    return skaters, goalies


@dataclass(frozen=True)
class WPHGame:
    game_id: int
    date_text: str          # raw, e.g. "Fri Nov 28"
    result_text: str | None # e.g. "W 5-4"
    opponent: str
    location: str | None


@dataclass(frozen=True)
class WPHGameStatRow:
    """One athlete's per-game line from a /game/show/<id> page."""
    team_name: str         # e.g. "Wausau West Warriors" — full display name as WPH renders it
    kind: str              # "skater" | "goalie"
    jersey: str | None
    player_name: str
    stats: dict[str, str]  # column header → cell value


def _parse_stat_table(table, kind: str, team_name: str) -> list[WPHGameStatRow]:
    """Parse a single skater or goalie table — shared between season and
    per-game pages. Filters footer/Totals rows by requiring a numeric
    jersey in the first cell."""
    thead = table.find("thead")
    cols = [th.get_text(strip=True) for th in (thead.find_all("th") if thead else table.find_all("th"))]
    if not cols or cols[0] != "#":
        return []
    out: list[WPHGameStatRow] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        values = [td.get_text(" ", strip=True) for td in cells]
        if len(values) < len(cols):
            continue
        if not _ATHLETE_NUM_RE.match(values[0]):
            continue
        jersey = values[0].strip()
        player_name = values[1].strip()
        if not player_name:
            continue
        stats = {cols[i]: values[i] for i in range(2, len(cols))}
        out.append(WPHGameStatRow(
            team_name=team_name, kind=kind, jersey=jersey,
            player_name=player_name, stats=stats,
        ))
    return out


def fetch_game_stats(game_id: int) -> list[WPHGameStatRow]:
    """
    Pull one game's per-player stats. The /game/show/<id> page lays out
    four tables under <h3> headings shaped "<Team Name> Skaters" /
    "<Team Name> Goalies" — one pair per team. Returns flattened rows
    tagged with their team_name and kind ('skater' | 'goalie').
    """
    url = f"{BASE_URL}/game/show/{game_id}"
    html = _get(url)
    soup = BeautifulSoup(html, "lxml")
    out: list[WPHGameStatRow] = []
    for h3 in soup.find_all("h3"):
        text = h3.get_text(" ", strip=True)
        if text.endswith(" Skaters"):
            kind = "skater"
            team_name = text[: -len(" Skaters")].strip()
        elif text.endswith(" Goalies"):
            kind = "goalie"
            team_name = text[: -len(" Goalies")].strip()
        else:
            continue
        table = h3.find_next("table")
        if table is None:
            continue
        out.extend(_parse_stat_table(table, kind, team_name))
    return out


@dataclass(frozen=True)
class WPHRosterRow:
    jersey: str | None
    player_name: str
    position: str | None       # "F" (forward) | "D" (defense) | "G" (goalie)
    grad_year: int | None      # graduating class — convert to class letter at use site


def fetch_team_roster(team_page_id: int, *, subseason: int) -> list[WPHRosterRow]:
    """
    Pull a team's varsity roster — used to enrich stat lines with
    position + grad year, which the per-game and per-team-stats pages
    don't expose. Returns one row per athlete; ignores empty rows.
    """
    url = f"{BASE_URL}/roster/show/{team_page_id}?subseason={subseason}"
    html = _get(url)
    soup = BeautifulSoup(html, "lxml")

    out: list[WPHRosterRow] = []
    for table in soup.find_all("table"):
        thead = table.find("thead")
        if thead is None:
            continue
        cols = [th.get_text(strip=True) for th in thead.find_all("th")]
        try:
            j_i = cols.index("Number")
            n_i = cols.index("Name")
            p_i = cols.index("Pos.")
            g_i = cols.index("Grad Year")
        except ValueError:
            continue
        for tr in table.find_all("tr"):
            cells = tr.find_all("td")
            if not cells:
                continue
            values = [td.get_text(" ", strip=True) for td in cells]
            if max(j_i, n_i, p_i, g_i) >= len(values):
                continue
            jersey = values[j_i].strip() or None
            name = values[n_i].strip()
            if not name:
                continue
            position = (values[p_i].strip() or None)
            grad_text = values[g_i].strip()
            try:
                grad_year = int(grad_text) if grad_text else None
            except ValueError:
                grad_year = None
            out.append(WPHRosterRow(
                jersey=jersey, player_name=name,
                position=position, grad_year=grad_year,
            ))
    return out


def fetch_team_schedule(
    team_instance_id: int,
    *,
    subseason: int,
) -> list[WPHGame]:
    """
    Pull a team's schedule — used by the per-game stats merge (if/when we
    add one). Each row gives date, result, opponent, and a link to the
    game page (/game/show/<game_id>).
    """
    url = f"{BASE_URL}/schedule/team_instance/{team_instance_id}?subseason={subseason}"
    html = _get(url)
    soup = BeautifulSoup(html, "lxml")

    out: list[WPHGame] = []
    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        if "Date" not in headers or "Opponent" not in headers:
            continue
        col_idx = {h: i for i, h in enumerate(headers)}
        date_i = col_idx.get("Date")
        result_i = col_idx.get("Result")
        opp_i = col_idx.get("Opponent")
        loc_i = col_idx.get("Location")
        for tr in table.find_all("tr"):
            cells = tr.find_all("td")
            if not cells:
                continue
            game_link = tr.find("a", href=re.compile(r"/game/show/\d+"))
            if not game_link:
                continue
            m = re.search(r"/game/show/(\d+)", game_link.get("href") or "")
            if not m:
                continue
            game_id = int(m.group(1))
            values = [td.get_text(" ", strip=True) for td in cells]

            def col(i: int | None) -> str | None:
                return values[i].strip() if i is not None and i < len(values) else None

            out.append(WPHGame(
                game_id=game_id,
                date_text=col(date_i) or "",
                result_text=col(result_i),
                opponent=col(opp_i) or "",
                location=col(loc_i),
            ))
    return out
