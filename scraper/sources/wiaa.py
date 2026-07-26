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
from typing import Any

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

BASE_URL = "https://schools.wiaawi.org"
USER_AGENT = "wpr-prep-sports/0.1 (+https://wausaupilotandreview.com)"
LOGO_URL_PREFIX = f"{BASE_URL}/Upload/School/Logo/"

# WIAA SSID (SportSeason ID) mapping. The site's per-school directory page
# uses these as <tr id="..."> on team rows.
#
# CAUTION: SSIDs are minted PER SEASON and rotate when WIAA rolls the site
# to a new school year (Boys Football 1499 in 2025-26 → 1533 in 2026-27).
# The live map is discovered at runtime from the SchoolSSID dropdown on any
# directory page (see `harvest_season_ssids`); this hardcoded map (2026-27
# vintage) is only the fallback for when no page has been fetched yet, and
# it doubles as the registry of known sport keys.
SSID_BY_SPORT: dict[str, int] = {
    "football": 1533,  # Boys Football (11-player)
    "football_8p": 1534,  # Boys Football 8-Player
    "boys_basketball": 1536,
    "girls_basketball": 1547,
    "boys_hockey": 1539,
    "girls_hockey": 1552,
    "volleyball": 1559,  # Girls Volleyball
    "boys_volleyball": 1545,
    "boys_soccer": 1541,
    "girls_soccer": 1554,
    "boys_wrestling": 1546,
    "girls_wrestling": 1560,
    "baseball": 1535,
    "softball": 1555,
    "boys_cross_country": 1537,
    "girls_cross_country": 1549,
    "boys_track": 1544,
    "girls_track": 1558,
    "boys_golf": 1538,
    "girls_golf": 1550,
    "boys_tennis": 1543,
    "girls_tennis": 1557,
    "boys_swimming": 1542,
    "girls_swimming": 1556,
}

# Season SSID map discovered from the live site (sport key → SSID). Populated
# for free from the SchoolSSID dropdown the first time `discover_team_ids`
# fetches a directory page, or lazily via `current_ssid_for_sport` for
# live-score mode (which skips team discovery entirely). Takes precedence
# over SSID_BY_SPORT.
_season_ssids: dict[str, int] = {}

# Any valid OrgID works for lazy SSID discovery — the SchoolSSID dropdown
# lists every sport regardless of which school's page carries it.
# 415 = Stratford.
_REFERENCE_ORG_ID = 415


@dataclass(frozen=True)
class TeamEntry:
    ssid: int
    sport_name: str  # as labeled by WIAA, e.g. "Boys Football"
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


def _is_retryable(exc: BaseException) -> bool:
    """4xx is terminal (the URL/params are wrong); 5xx + network errors retry."""
    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    return isinstance(exc, (httpx.TransportError, httpx.TimeoutException))


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _get(url: str, params: dict | None = None) -> httpx.Response:
    with _client() as client:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        return resp


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
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
    # Free SSID refresh: the sport dropdown is on the page we just fetched, so
    # this costs no extra request. Guarded on emptiness rather than run once —
    # the season can't change mid-run, but a page that lacks the dropdown
    # shouldn't stop the next one from populating it.
    if not _season_ssids:
        harvest_season_ssids(resp.text)
    return parse_team_entries_html(resp.text)


def parse_team_entries_html(html: str) -> list[TeamEntry]:
    """Parse a GetDirectorySchool response into TeamEntry rows. Split from
    the HTTP call so the parser can run against saved fixtures in tests."""
    soup = BeautifulSoup(html, "lxml")

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


def harvest_season_ssids(html: str) -> dict[str, int]:
    """
    Refresh `_season_ssids` from the SchoolSSID sport dropdown embedded in a
    directory page (`<option value=SSID>Sport Label</option>`), returning what
    was found.

    The dropdown always reflects the season the site is currently serving,
    even when the page's team grid was pinned to a past year via
    `SchoolYear=` — which is what makes it a trustworthy source for the
    current SSIDs. Split from the HTTP call so it can run against saved
    fixtures in tests, matching parse_team_entries_html.
    """
    soup = BeautifulSoup(html, "lxml")
    select = soup.select_one("select#SchoolSSID")
    if select is None:
        return {}
    found: dict[str, int] = {}
    for opt in select.select("option"):
        value = opt.get("value") or ""
        if not value.isdigit() or int(value) <= 0:
            continue
        label = opt.get_text(strip=True)
        for key in SSID_BY_SPORT:
            if _label_matches(key, label):
                found[key] = int(value)
                break
    _season_ssids.update(found)
    return found


def current_ssid_for_sport(sport: str) -> int | None:
    """
    SSID for a sport in the season the site is currently serving.

    Uses the map harvested from directory pages this run; if nothing has been
    fetched yet (live-score mode skips team discovery), pulls one reference
    directory page to populate it. Falls back to the hardcoded SSID_BY_SPORT
    vintage if the site is unreachable — stale, but better than nothing.
    """
    if not _season_ssids:
        try:
            discover_team_ids(_REFERENCE_ORG_ID)
        except httpx.HTTPError:
            pass
    return _season_ssids.get(sport, SSID_BY_SPORT.get(sport))


def _norm_label(label: str) -> str:
    return re.sub(r"\s+", " ", (label or "").strip()).casefold()


def _label_matches(sport: str, label: str) -> bool:
    """
    Match a sport key against WIAA's display label for a team row
    ("Boys Football", "Girls Swimming & Diving", "Boys Track and Field").
    Labels are stable across seasons, unlike SSIDs.
    """
    n = _norm_label(label)
    if sport == "football":
        return n == "boys football"
    if sport == "football_8p":
        return n.startswith("boys football") and "8" in n
    if sport == "volleyball":
        return n == "girls volleyball"
    if sport == "baseball":
        return n == "boys baseball"
    if sport == "softball":
        return n == "girls softball"
    gender, _, rest = sport.partition("_")
    if gender not in ("boys", "girls"):
        return False
    if rest in ("hockey",):
        return n.startswith(gender) and "hockey" in n
    if rest in ("swimming",):
        return n.startswith(gender) and "swimming" in n
    if rest in ("track",):
        return n.startswith(gender) and "track" in n
    return n == f"{gender} {rest.replace('_', ' ')}"


def discover_team_id_for_sport(org_id: int, sport: str) -> int | None:
    """Convenience: find one school's TeamID for a single sport key."""
    if sport not in SSID_BY_SPORT:
        raise ValueError(f"Unknown sport key '{sport}'. Add it to SSID_BY_SPORT.")
    # discover_team_ids also refreshes _season_ssids from this page's dropdown,
    # so the SSID candidates below match the grid we just got back.
    teams = discover_team_ids(org_id)
    # Small-school football fallback: WIAA splits 11-player from 8-player and a
    # given school only fields one format — try 11-player first.
    keys = [sport] + (["football_8p"] if sport == "football" else [])
    candidates: list[int] = []
    for key in keys:
        # Discovered SSIDs first; the hardcoded map is a stale-vintage backstop.
        for source in (_season_ssids, SSID_BY_SPORT):
            ssid = source.get(key)
            if ssid is not None and ssid not in candidates:
                candidates.append(ssid)
    for ssid in candidates:
        for team in teams:
            if team.ssid == ssid:
                return team.team_id
    # Last resort: match the sport's display label, which is stable across
    # seasons even when every SSID has rotated.
    for key in keys:
        for team in teams:
            if _label_matches(key, team.sport_name):
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
    return parse_team_schedule_html(resp.text, team_id)


def parse_team_schedule_html(html: str, team_id: int) -> dict[str, Any]:
    """Parse a Schedule/Index response into the raw-schedule dict (shape
    documented on fetch_team_schedule). Split from the HTTP call so the
    parser can run against saved fixtures in tests."""
    soup = BeautifulSoup(html, "lxml")

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
        lambda t: t.name in ("label", "span") and "text-muted" in (t.get("class") or [])
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
