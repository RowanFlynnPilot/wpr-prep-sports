"""
MaxPreps source — per-game and per-team stats for sports where Bound's
central-WI coverage is too thin (notably volleyball).

Why MaxPreps: per the WSN sunset article
(https://www.wissports.net/news_article/show/1344219), Wisconsin Sports
Network is migrating to MaxPreps Wisconsin starting this school year.
MaxPreps already has comprehensive central-WI volleyball box scores
(Hitting / Serving / Blocking / Digging / Ball Handling / Serve
Receiving) where Bound has effectively nothing.

URL surfaces in use:
  Team home          /wi/<city>/<school-mascot>/<sport>/
  Match history      /wi/<city>/<school-mascot>/<sport>/schedule/all-time/
  Box score          /games/<M-D-YYYY>/<sport>-<YY>/<away>-vs-<home>.htm?c=<8>

The match-history page is server-rendered legacy HTML (good for us); the
"current schedule" page is JS-rendered (`__NEXT_DATA__` with an empty
contests array off-season). Box-score pages are server-rendered HTML
with one set of 6 stat tables per team that input stats to MaxPreps.
Not every team inputs — see _split_team_sections.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

BASE_URL = "https://www.maxpreps.com"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class MaxPrepsGame:
    """One row from a team's match-history page."""
    box_score_url: str   # absolute
    date: str            # YYYY-MM-DD
    opponent: str
    home: bool           # True if this team was home, False if away
    result: str | None   # "W 3-1", "L 0-3" — set wins/losses


@dataclass(frozen=True)
class StatLine:
    """One per-player stat line scraped from a MaxPreps box score.

    Shape mirrors `bound.StatLine` so the merge layer can stay shared.
    """
    team_name: str          # team this player plays for (as displayed by MP)
    category: str           # canonical: "Kills" | "Digs" | "Total Blocks" | "Assists" | "Serve Aces"
    player_name: str
    player_year: str | None # "SR" | "JR" | "SO" | "FR" | None
    stats: dict[str, str]   # raw label → value


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=20.0,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )


def _is_retryable(exc: BaseException) -> bool:
    """4xx is terminal (the URL is wrong); 5xx + network errors are retryable."""
    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    return isinstance(exc, (httpx.TransportError, httpx.TimeoutException))


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _get(url: str) -> str:
    with _client() as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.text


# ---------------------------------------------------------------------------
# Slug construction + discovery
# ---------------------------------------------------------------------------


_SLUG_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_INITIALS_RE = re.compile(r"\b([a-z])\.")


def _slug(text: str) -> str:
    """kebab-case slug. Collapses non-alphanumerics, strips leading/trailing."""
    s = _SLUG_NON_ALNUM.sub("-", (text or "").casefold()).strip("-")
    return s


def _slug_collapse_initials(text: str) -> str:
    """Variant that collapses single-letter initials (D.C. → dc, A.J. → aj).

    MaxPreps prefers `dc-everest-evergreens` over `d-c-everest-evergreens`.
    """
    # Lowercase, remove the period after a single letter, then standard slugify.
    lowered = (text or "").lower()
    collapsed = _INITIALS_RE.sub(r"\1", lowered)
    return _slug(collapsed)


def auto_slug_candidates(school) -> list[str]:
    """Yield candidate `<city>/<school-mascot>` slug paths to probe.

    School manifest cases that diverge from naive construction:
      - SPASH → MP uses "stevens-point-panthers" (city as school name)
      - Newman Catholic Wausau → MP uses "newman-fighting-cardinals"
        (different mascot from our manifest)
      - Marathon (city = "Marathon City") → MP uses just "marathon"
    Discovery tries each candidate; the first to return 200 wins.
    """
    city = _slug(school.city or "")
    name = _slug(school.name or "")
    name_compact = _slug_collapse_initials(school.name or "")
    full = _slug((school.full_name or "").replace("High School", "").replace("Senior High", "").strip())
    full_compact = _slug_collapse_initials(
        (school.full_name or "").replace("High School", "").replace("Senior High", "").strip()
    )
    mascot = _slug(school.mascot or "")

    # MaxPreps sometimes prefixes the mascot with "red" (Marathon Red
    # Raiders) or other adjectives. We can't enumerate every such case,
    # so a colored-mascot variant is the easiest catch-all.
    mascot_variants: list[str] = [mascot] if mascot else []
    if mascot in {"raiders", "robins", "wolves", "tigers", "wings"}:
        mascot_variants.append(f"red-{mascot}")
    if mascot == "cardinals":
        mascot_variants.append("fighting-cardinals")

    city_variants: list[str] = [city] if city else []
    if city.endswith("-city"):
        city_variants.append(city[:-len("-city")])
    if " " in (school.city or ""):
        first = _slug((school.city or "").split()[0])
        if first and first not in city_variants:
            city_variants.append(first)

    candidates: list[str] = []

    def push(c: str) -> None:
        if c and c not in candidates:
            candidates.append(c)

    name_variants = [v for v in {name, name_compact, full, full_compact, city} if v]

    # Standard first (matches the vast majority), then variants.
    for cv in city_variants:
        for nv in name_variants:
            for mv in mascot_variants:
                push(f"{cv}/{nv}-{mv}")

    return candidates


def team_home_url(slug_path: str, sport_path: str = "volleyball") -> str:
    return f"{BASE_URL}/wi/{slug_path}/{sport_path}/"


def discover_slug(school, sport_path: str = "volleyball") -> str | None:
    """Probe each auto-slug candidate; return the first whose team-home
    page exists and resolves to the right team. Returns the slug fragment
    (e.g., `wausau/wausau-east-lumberjacks`), or None if no candidate fits.
    """
    # MaxPreps's <head><title>...</title></head> for a team home page is
    # roughly "<School name as MP knows it> (WI) Varsity <Sport>". The
    # school name in the title isn't always our manifest's `name` — for
    # SPASH it reads "Stevens Point High School". Accept any of the
    # identity tokens we know as substring evidence the page is theirs.
    identity_tokens = {
        _norm(school.name),
        _norm((school.full_name or "").replace("High School", "").strip()),
        _norm(school.city or ""),
        _norm(school.mascot or ""),
    }
    identity_tokens = {t for t in identity_tokens if t}

    for cand in auto_slug_candidates(school):
        url = team_home_url(cand, sport_path)
        try:
            html = _get(url)
        except httpx.HTTPStatusError:
            continue
        # An SVG `<title>MaxPreps Logo</title>` sits earlier in the
        # document than the head `<title>`, so we need the head's title
        # specifically.
        soup = BeautifulSoup(html, "html.parser")
        head_title = soup.head.title if soup.head and soup.head.title else None
        if head_title is None:
            continue
        title_norm = _norm(head_title.get_text())
        # Title is the form "<School> High School (<City>, WI) Volleyball".
        # Any of our identity tokens (name / full_name / city) being a
        # substring is strong evidence: the URL we picked already encodes
        # the mascot, so we only need confirmation the page is for the
        # right school name, not a sibling using the same mascot.
        if any(t in title_norm for t in identity_tokens):
            return cand
    return None


# ---------------------------------------------------------------------------
# Match history → list of box-score URLs
# ---------------------------------------------------------------------------


_BOX_SCORE_RE = re.compile(
    r'https?://www\.maxpreps\.com/games/'
    r'(?P<m>\d{1,2})-(?P<d>\d{1,2})-(?P<y>\d{4})/'
    r'[a-z0-9-]+/'  # sport-yy, e.g. "volleyball-25" (digits in the year suffix)
    r'(?P<away>[a-z0-9-]+)-vs-(?P<home>[a-z0-9-]+)\.htm'
    r'\?c=(?P<token>[A-Za-z0-9_-]+)'
)


def fetch_team_match_history(
    slug_path: str,
    *,
    sport_path: str = "volleyball",
    season_year: int | None = None,
    school_slug: str | None = None,
) -> list[MaxPrepsGame]:
    """Pull every box-score URL the team has on file from
    /<sport>/schedule/all-time/. Filters to `season_year` (the calendar
    year the season started) when given.

    The all-time history page is server-rendered legacy HTML — much
    easier to parse than the JS-rendered current-season schedule page.

    Box-score URLs use the school slug *without the mascot*, e.g.
    `wausau-east-vs-wisconsin-rapids-lincoln`. Pass `school_slug` to
    enable accurate home/away detection; otherwise we fall back to
    treating every game as away.
    """
    url = f"{BASE_URL}/wi/{slug_path}/{sport_path}/schedule/all-time/"
    html = _get(url)
    games: list[MaxPrepsGame] = []
    seen_urls: set[str] = set()
    for m in _BOX_SCORE_RE.finditer(html):
        year = int(m.group("y"))
        if season_year and year != season_year:
            continue
        href = m.group(0)
        if href in seen_urls:
            continue
        seen_urls.add(href)
        home = False
        opponent_slug = m.group("away")
        if school_slug:
            if m.group("home") == school_slug:
                home = True
                opponent_slug = m.group("away")
            elif m.group("away") == school_slug:
                home = False
                opponent_slug = m.group("home")
        date_iso = f"{year:04d}-{int(m.group('m')):02d}-{int(m.group('d')):02d}"
        games.append(
            MaxPrepsGame(
                box_score_url=href,
                date=date_iso,
                opponent=_unslug(opponent_slug),
                home=home,
                result=None,
            )
        )
    return games


def _unslug(s: str) -> str:
    """Best-effort reverse of _slug — for display only, never name matching."""
    return s.replace("-", " ").title()


# ---------------------------------------------------------------------------
# Box-score parsing
# ---------------------------------------------------------------------------


# Maps MP's section header (above the 6 tables) to our canonical category
# and the stat-column key that's most newsworthy. Each player in a team's
# section gets one StatLine per category they registered in.
_CATEGORY_FROM_HEADER = {
    # (canonical category, MP-column-with-the-leader-stat)
    # NOTE: MP volleyball columns are abbreviated and overloaded — in the
    # Serving table, "A" is Aces and "SA" is Serves Attempted, not the
    # other way around. Verify any retune against an actual box score.
    "Attacking": ("Kills", "K"),
    "Serving": ("Serve Aces", "A"),
    "Blocking": ("Total Blocks", "Tot Blks"),
    "Digging": ("Digs", "D"),
    "Ball Handling": ("Assists", "Ast"),
    # Serve Receiving deliberately omitted — receptions are a role stat
    # that doesn't translate into a "leader" category in our schema.
}


_ATHLETE_RE = re.compile(r"^(?P<name>.+?)\((?P<year>\w{1,3})\)$")


def fetch_box_score(url: str) -> list[StatLine]:
    """Parse a MaxPreps volleyball box score into per-player StatLines.

    Layout: each team that input stats has a `<h3>Team Name (YY-YY)</h3>`
    followed by six section headers (Attacking / Serving / Blocking /
    Digging / Ball Handling / Serve Receiving), each with one table.
    Only teams that input stats show up — single-team coverage is the
    common case.
    """
    html = _get(url)
    soup = BeautifulSoup(html, "html.parser")

    # Find the "Match Stats" anchor, then walk forward picking up team
    # headers and the tables that belong to each.
    match_stats = None
    for hdr in soup.find_all(["h2", "h3"]):
        if hdr.get_text(strip=True) == "Match Stats":
            match_stats = hdr
            break
    if match_stats is None:
        return []

    out: list[StatLine] = []
    current_team: str | None = None
    current_category: tuple[str, str] | None = None

    # Section labels (Attacking/Serving/Blocking/Digging/Ball Handling/Serve
    # Receiving) live in <h4> elements between each stat table; team
    # headers ("Wausau East (25-26)") are <h3>. Walk all of them in
    # document order.
    for el in match_stats.find_all_next(["h2", "h3", "h4", "table"]):
        if el.name in ("h2", "h3", "h4"):
            text = el.get_text(strip=True)
            if text in ("Match Story", "Players of the Match", "Rankings & Records"):
                break
            team_match = re.match(r"^(.+?)\s*\(\d{2}-\d{2}\)\s*$", text)
            if team_match and el.name == "h3":
                current_team = team_match.group(1).strip()
                current_category = None
                continue
            if text in _CATEGORY_FROM_HEADER:
                current_category = _CATEGORY_FROM_HEADER[text]
            else:
                current_category = None
            continue

        if el.name == "table" and current_team and current_category:
            category, leader_key = current_category
            out.extend(_parse_box_table(el, current_team, category, leader_key))

    return out


def _parse_box_table(
    table,
    team_name: str,
    category: str,
    leader_key: str,
) -> list[StatLine]:
    """Pull per-player rows out of one stat table. Skips the Team Totals
    row, which sits at the top with no jersey number."""
    headers = [th.get_text(strip=True) for th in table.find_all("th")]
    if not headers:
        return []
    lines: list[StatLine] = []
    for row in table.find_all("tr"):
        cells = [c.get_text(strip=True) for c in row.find_all(["th", "td"])]
        if len(cells) != len(headers):
            continue
        # First cell is jersey number; "Team Totals" has empty jersey.
        jersey = cells[0]
        athlete_cell = cells[1] if len(cells) > 1 else ""
        if not jersey or not athlete_cell or athlete_cell == "Athlete Name":
            continue
        # Strip "(Jr)"/"(Sr)" suffix into player_year.
        m = _ATHLETE_RE.match(athlete_cell)
        if m:
            player_name = m.group("name").strip()
            player_year = _normalize_year(m.group("year"))
        else:
            player_name = athlete_cell
            player_year = None
        # Build raw stats dict from remaining columns.
        stats: dict[str, str] = {}
        for hdr, val in zip(headers[2:], cells[2:]):
            if hdr and val:
                stats[hdr] = val
        # Don't emit a line if the leader stat is zero/empty — keeps the
        # frontend's "stat leaders" surface focused on actual performances.
        leader_val = stats.get(leader_key, "")
        if not leader_val or leader_val in ("0", "0.0", ""):
            continue
        # Rename the leader column to a canonical key so the frontend
        # `formatLine` lookup hits regardless of source (Bound uses
        # different short labels for volleyball stats).
        stats[_CANON_KEY[category]] = stats.get(leader_key, leader_val)
        lines.append(
            StatLine(
                team_name=team_name,
                category=category,
                player_name=player_name,
                player_year=player_year,
                stats=stats,
            )
        )
    return lines


# Map canonical category → canonical stats-dict key the frontend looks up.
# Mirrors Bound's emitted keys for volleyball (KLS/AST/DIG/BLK/ACE).
_CANON_KEY = {
    "Kills": "KLS",
    "Assists": "AST",
    "Digs": "DIG",
    "Total Blocks": "BLK",
    "Serve Aces": "ACE",
}


def _normalize_year(yr: str) -> str | None:
    """MaxPreps writes (Sr)/(Jr)/(So)/(Fr); normalize to SR/JR/SO/FR."""
    yr = (yr or "").strip().upper()
    return yr if yr in {"SR", "JR", "SO", "FR"} else None


def _norm(name: str) -> str:
    """Match transform/stats.py:_norm conventions."""
    return re.sub(r"\s+", " ", (name or "").strip().casefold())
