"""
WIAA source — schools.wiaawi.org

Primary data source. Server-rendered ASP.NET grids. See docs/data-sources.md
for endpoint details and the rationale for picking WIAA over Bound.

Three things this module knows how to do:

1. `search_org_id(name)` — look up an OrganizationID for a school.
2. `discover_team_ids(org_id)` — given an OrganizationID, list every team
   the school has this season as `(ssid, sport_name, team_id)` tuples.
3. `fetch_team_schedule(team_id)` — full-season game rows for one team,
   returned as a list of raw dicts (normalized later by `transform/normalize.py`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

BASE_URL = "https://schools.wiaawi.org"
USER_AGENT = "wpr-prep-sports/0.1 (+https://wausaupilotandreview.com)"
LOGO_URL_PREFIX = f"{BASE_URL}/Upload/School/Logo/"

# WIAA SSID (SportSeason ID) mapping. The site's per-school directory page
# uses these as <tr id="..."> on team rows.
SSID_BY_SPORT: dict[str, int] = {
    "football": 1499,           # Boys Football (11-player)
    "football_8p": 1500,        # Boys Football 8-Player
    "boys_basketball": 1502,
    "girls_basketball": 1512,
    "boys_hockey": 1505,
    "girls_hockey": 1517,
    "volleyball": 1523,         # Girls Volleyball
    "boys_volleyball": 1510,
    "boys_soccer": 1506,
    "girls_soccer": 1518,
    "boys_wrestling": 1511,
    "girls_wrestling": 1524,
    "baseball": 1501,
    "softball": 1519,
    "boys_cross_country": 7382,
    "girls_cross_country": 1514,
    "boys_track": 1509,
    "girls_track": 1522,
    "boys_golf": 1504,
    "girls_golf": 1515,
    "boys_tennis": 1508,
    "girls_tennis": 1521,
    "boys_swimming": 1507,
    "girls_swimming": 1520,
}


@dataclass(frozen=True)
class TeamEntry:
    ssid: int
    sport_name: str       # as labeled by WIAA, e.g. "Boys Football"
    team_id: int


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
def _get(url: str, params: dict | None = None) -> httpx.Response:
    with _client() as client:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        return resp


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _post(url: str, params: dict | None = None) -> httpx.Response:
    # WIAA's directory POSTs are bodyless but the IIS frontend requires
    # an explicit Content-Length: 0.
    with _client() as client:
        resp = client.post(url, params=params, headers={"Content-Length": "0"})
        resp.raise_for_status()
        return resp


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def search_org_id(name: str) -> int | None:
    """
    Look up the WIAA OrganizationID for a school by name.

    Returns the first exact (case-insensitive) match, falling back to the
    first result with a prefix match. Returns None if nothing matches —
    caller should warn and skip rather than crash.
    """
    resp = _get(
        f"{BASE_URL}/Directory/School/SearchOrg",
        params={"query": name, "levelT": 0, "classT": 0, "memberT": 20},
    )
    results: list[dict[str, Any]] = resp.json()
    if not results or (len(results) == 1 and results[0].get("OrganizationID") == 0):
        return None

    needle = name.casefold()
    for r in results:
        if (r.get("OrgName") or "").casefold() == needle:
            return int(r["OrganizationID"])
    for r in results:
        org_name = (r.get("OrgName") or "").casefold()
        if org_name.startswith(needle) or needle.startswith(org_name):
            return int(r["OrganizationID"])
    return None


def discover_team_ids(org_id: int) -> list[TeamEntry]:
    """
    Pull a school's profile page and extract its current-season team list.

    Returns one TeamEntry per (sport × gender). The school year defaulted-to
    on the profile page is the current WIAA season — we accept that default
    rather than driving the year dropdown (which would require ASP.NET
    postback handling).
    """
    resp = _post(
        f"{BASE_URL}/Directory/School/GetDirectorySchool",
        params={"OrgID": org_id, "showPub": "False"},
    )
    soup = BeautifulSoup(resp.text, "lxml")

    entries: list[TeamEntry] = []
    for tr in soup.select("tr.gridTableRow"):
        ssid_str = tr.get("id")
        if not ssid_str or not ssid_str.isdigit():
            continue
        link = tr.select_one("a[href*='TeamID=']")
        if link is None:
            continue
        href = link.get("href") or ""
        m = re.search(r"TeamID=(\d+)", href)
        if not m:
            continue
        sport_span = link.select_one("span")
        sport_name = sport_span.get_text(strip=True) if sport_span else ""
        entries.append(
            TeamEntry(
                ssid=int(ssid_str),
                sport_name=sport_name,
                team_id=int(m.group(1)),
            )
        )
    return entries


# Fallback chain — when a school doesn't field a team for a sport's primary
# SSID, try alternates. The clearest case is small-school football: WIAA
# splits 11-player (1499) from 8-player (1500) and a given school only
# plays one format. We try 1499 first, then 1500.
_SSID_FALLBACKS: dict[str, list[int]] = {
    "football": [SSID_BY_SPORT["football"], SSID_BY_SPORT["football_8p"]],
}


def discover_team_id_for_sport(org_id: int, sport: str) -> int | None:
    """Convenience: find one school's TeamID for a single sport key."""
    primary = SSID_BY_SPORT.get(sport)
    if primary is None:
        raise ValueError(f"Unknown sport key '{sport}'. Add it to SSID_BY_SPORT.")
    candidates = _SSID_FALLBACKS.get(sport, [primary])
    teams = discover_team_ids(org_id)
    for ssid in candidates:
        for team in teams:
            if team.ssid == ssid:
                return team.team_id
    return None


def fetch_team_schedule(team_id: int) -> dict[str, Any]:
    """
    Fetch the full-season schedule for one team.

    Returns:
        {
          "team_id": int,
          "school_name": str (as displayed by WIAA, e.g. "Wausau East"),
          "mascot": str | None,
          "coach": str | None,
          "level": str | None,           # "Varsity", "JV", etc.
          "year": str | None,            # e.g. "2025-2026"
          "games": [<raw game dict>, ...],
        }

    Raw game dict shape:
        {
          "date": "2025-08-22",          # ISO yyyy-mm-dd, parsed from hidden sort key
          "time": "7:00 PM" | None,
          "label": "WIAA Tournament - Level1" | None,  # sub-label, e.g. tournament round
          "home": {"team_id": int|None, "name": str, "logo_url": str|None},
          "away": {"team_id": int|None, "name": str, "logo_url": str|None},
          "venue": "@Westby" | "Home" | None,
          "result": "W 30-6" | "L 14-21" | None,       # None for not-yet-played
          "conference_game": bool,                      # True if "(C)" marker present
        }
    """
    resp = _get(
        f"{BASE_URL}/Directory/Schedule/Index",
        params={"TeamID": team_id},
    )
    soup = BeautifulSoup(resp.text, "lxml")

    headers = [h.get_text(strip=True) for h in soup.select("h1, h2, h3, h4, h5, h6")][:6]
    school_name = headers[0] if len(headers) > 0 else None
    mascot = headers[1] if len(headers) > 1 else None
    coach = headers[2] if len(headers) > 2 else None
    level = headers[3] if len(headers) > 3 else None
    year = headers[5] if len(headers) > 5 else None

    games: list[dict[str, Any]] = []
    for row in soup.select("tr.gridTableRow"):
        game = _parse_schedule_row(row)
        if game is not None:
            games.append(game)

    return {
        "team_id": team_id,
        "school_name": school_name,
        "mascot": mascot,
        "coach": coach,
        "level": level,
        "year": year,
        "games": games,
    }


# ---------------------------------------------------------------------------
# Row parsing
# ---------------------------------------------------------------------------


_DATE_KEY_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})$")
_TIME_RE = re.compile(r"\d{1,2}:\d{2}\s*[APap][Mm]")
_CONF_MARK_RE = re.compile(r"\(\s*C\s*\)")


def _parse_schedule_row(row) -> dict[str, Any] | None:
    cells = row.find_all("td", recursive=False)
    if len(cells) < 5:
        return None

    # cells[0] is the "visible" date cell.
    # cells[1] is a mobile-hidden duplicate ("never d-none" class).
    # cells[2] is the home team, cells[3] is the away team,
    # cells[4] is the venue, cells[5] (if present) is the result.
    visible_date_cell = cells[0]
    home_cell = cells[2]
    away_cell = cells[3]
    venue_cell = cells[4]
    result_cell = cells[5] if len(cells) > 5 else None

    # --- date ---
    date_iso: str | None = None
    sort_key = visible_date_cell.find("span", style=lambda s: s and "display:none" in s)
    if sort_key is not None:
        m = _DATE_KEY_RE.match(sort_key.get_text(strip=True))
        if m:
            date_iso = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    if date_iso is None:
        return None  # no parseable date = not a game row

    # --- time and sub-label ---
    cell_text = visible_date_cell.get_text(" ", strip=True)
    time_match = _TIME_RE.search(cell_text)
    time_str = time_match.group(0).upper().replace(" ", "") if time_match else None
    # Sub-label (e.g. "WIAA Tournament - Level1") sits in a muted span/label
    sub_label_el = visible_date_cell.find(
        lambda t: t.name in ("label", "span")
        and "text-muted" in (t.get("class") or [])
    )
    sub_label = sub_label_el.get_text(strip=True) if sub_label_el else None

    conference_game = bool(_CONF_MARK_RE.search(cell_text))

    home = _parse_team_cell(home_cell)
    away = _parse_team_cell(away_cell)

    venue_label = venue_cell.find("label")
    venue = venue_label.get_text(strip=True) if venue_label else None

    result_text: str | None = None
    if result_cell is not None:
        result_span = result_cell.find(
            "span",
            class_=lambda c: c and ("winningTeamText" in c or "losingTeamText" in c),
        )
        if result_span is not None:
            result_text = result_span.get_text(" ", strip=True)

    return {
        "date": date_iso,
        "time": time_str,
        "label": sub_label,
        "home": home,
        "away": away,
        "venue": venue,
        "result": result_text,
        "conference_game": conference_game,
    }


def _parse_team_cell(cell) -> dict[str, Any]:
    img = cell.find("img")
    logo_url = img.get("src") if img else None
    link = cell.find("a", href=lambda h: h and "TeamID=" in h)
    team_id: int | None = None
    name = ""
    if link is not None:
        m = re.search(r"TeamID=(\d+)", link.get("href", ""))
        if m:
            team_id = int(m.group(1))
        span = link.find("span")
        name = (span.get_text(strip=True) if span else link.get_text(strip=True)) or ""
    return {"team_id": team_id, "name": name, "logo_url": logo_url}


# ---------------------------------------------------------------------------
# Legacy entry point used by main.py before this refactor
# ---------------------------------------------------------------------------


def fetch(sport: str, season: str) -> list[dict[str, Any]]:
    """Legacy no-op kept so existing main.py imports don't break during rollout."""
    _ = (sport, season)
    return []
