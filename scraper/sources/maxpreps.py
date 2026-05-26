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


@dataclass(frozen=True)
class BoxScore:
    """Bundles everything we extract from one MaxPreps box-score URL —
    per-player stat lines plus the team-level set-by-set scores. Both
    pieces come from the same page, so one HTTP fetch produces both."""
    stat_lines: list[StatLine]
    # Set-by-set scores keyed by MP-rendered team name. Empty when the
    # box score didn't surface a Score by Period table (rare).
    set_scores_by_team: dict[str, list[int]]


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


# Per-sport map: MP's section header (above each table) → (canonical
# category we expose downstream, MP-column carrying the leader stat).
# Each player who registers in a category gets one StatLine using that
# table's full column set as the stats dict.
#
# Volleyball gotcha: the Serving table's "A" is Aces and "SA" is Serves
# Attempted, NOT the other way around — verify any retune against a
# real box score.
_CATEGORY_FROM_HEADER_BY_SPORT: dict[str, dict[str, tuple[str, str]]] = {
    "volleyball": {
        "Attacking":     ("Kills",        "K"),
        "Serving":       ("Serve Aces",   "A"),
        "Blocking":      ("Total Blocks", "Tot Blks"),
        "Digging":       ("Digs",         "D"),
        "Ball Handling": ("Assists",      "Ast"),
        # Serve Receiving deliberately omitted — receptions don't slot
        # into our existing "leader" schema.
    },
    "football": {
        # MaxPreps' All Purpose Yards table has Rush/Rec/KR/PR/IR/Total
        # — we lift Rec out of it as a receiving leader since MP doesn't
        # publish a dedicated Receiving table.
        "Passing":            ("Passing Yards",   "Yds"),
        "Rushing":            ("Rushing Yards",   "Yds"),
        "All Purpose Yards":  ("Receiving Yards", "Rec"),
        "Tackles":            ("Total Tackles",   "Tot Tckls"),
    },
    "basketball": {
        # "Shooting" carries Pts + FG splits; "Totals" carries
        # Reb/Ast/Stl/Blk/TO/PF — we map both into our existing
        # Points/Rebounds leader categories. MP uses one `basketball`
        # URL path for both genders; ssid disambiguates.
        "Shooting":  ("Points",   "Pts"),
        "Totals":    ("Rebounds", "Reb"),
    },
}


def _category_map_for(sport_path: str) -> dict[str, tuple[str, str]]:
    """Return the header→(category, leader_key) map for a sport, falling
    back to volleyball's for back-compat with callers that don't pass a
    sport (none in tree, but defensive)."""
    return _CATEGORY_FROM_HEADER_BY_SPORT.get(sport_path, _CATEGORY_FROM_HEADER_BY_SPORT["volleyball"])


_ATHLETE_RE = re.compile(r"^(?P<name>.+?)\((?P<year>\w{1,3})\)$")


def fetch_box_score(url: str, sport_path: str = "volleyball") -> BoxScore:
    """Parse a MaxPreps box score (any sport we map) into a BoxScore
    bundle — per-player stat lines plus per-period scores.

    The DOM is the same shape across sports — a Match/Game Stats
    anchor, then per-team `<h3>` blocks with per-category `<h4>` +
    table pairs — only the category labels differ. `sport_path`
    selects the per-sport header→category map; see
    `_CATEGORY_FROM_HEADER_BY_SPORT`.

    Only teams that input stats show up — single-team coverage is the
    common case across every sport.
    """
    html = _get(url)
    soup = BeautifulSoup(html, "html.parser")

    set_scores = _parse_set_scores_table(soup)

    category_map = _category_map_for(sport_path)

    # Find the "Match Stats" anchor — labeled "Game Stats" on football
    # and basketball pages, "Match Stats" on volleyball.
    match_stats = None
    for hdr in soup.find_all(["h2", "h3"]):
        text = hdr.get_text(strip=True)
        if text in ("Match Stats", "Game Stats"):
            match_stats = hdr
            break
    if match_stats is None:
        return BoxScore(stat_lines=[], set_scores_by_team=set_scores)

    # Per-team stat block: <span class="school">TeamName</span> +
    # <h4>Category</h4> + <table>. Two flavors of wrapper:
    #   1. Two-team upload — outer <div class="stat-category"> with
    #      inner <div class="team-list__team"> per team, each holding
    #      one (span, h4, table) triple.
    #   2. Single-team upload — <div class="stat-category"> holds the
    #      triple directly, no inner team-list__team wrapper.
    # Walk every stat-category div, prefer its inner team-list__team
    # children when present; fall back to the div itself otherwise.
    out: list[StatLine] = []
    boundary = None
    for h in match_stats.find_all_next(["h2", "h3"]):
        text = h.get_text(strip=True)
        if text in ("Match Story", "Players of the Match", "Rankings & Records"):
            boundary = h
            break

    def _emit(container):
        school_span = container.find("span", class_="school")
        h4 = container.find("h4")
        table = container.find("table")
        if not (school_span and h4 and table):
            return
        category_text = h4.get_text(strip=True)
        mapping = category_map.get(category_text)
        if mapping is None:
            return
        category, leader_key = mapping
        team_name = school_span.get_text(strip=True)
        if not team_name:
            return
        out.extend(_parse_box_table(table, team_name, category, leader_key))

    for div in match_stats.find_all_next("div", class_="stat-category"):
        if boundary is not None and _is_after(div, boundary):
            break
        inner_blocks = div.find_all("div", class_="team-list__team", recursive=False)
        if inner_blocks:
            for blk in inner_blocks:
                _emit(blk)
        else:
            _emit(div)

    return BoxScore(stat_lines=out, set_scores_by_team=set_scores)


def _is_after(node, boundary) -> bool:
    """True if `node` appears later in document order than `boundary`."""
    cur = boundary
    while cur is not None:
        cur = cur.find_next()
        if cur is node:
            return True
    return False


def _parse_set_scores_table(soup) -> dict[str, list[int]]:
    """Find the Score by Period table at the top of a box-score page
    and pull set scores per team. Returns `{team_name: [s1, s2, ...]}`.

    The table's header row reads `['', 'S1', 'S2', 'S3', 'S4', 'Wins']`
    (or fewer S* columns for shorter matches); each subsequent row is
    `[team_name, score_s1, score_s2, ..., total_wins]`. We discard the
    Wins column — total set count is derivable from the per-set scores
    and is already in game.home.score / game.away.score from WIAA.
    """
    out: dict[str, list[int]] = {}
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        headers = [th.get_text(strip=True) for th in rows[0].find_all(["th", "td"])]
        if len(headers) < 3:
            continue
        set_cols = [i for i, h in enumerate(headers) if re.fullmatch(r"S\d+", h)]
        if not set_cols:
            continue
        # The header row ends in "Wins"; everything after the last S*
        # column we ignore.
        for row in rows[1:]:
            cells = [c.get_text(strip=True) for c in row.find_all(["th", "td"])]
            if len(cells) <= max(set_cols):
                continue
            team_name = cells[0]
            if not team_name:
                continue
            scores: list[int] = []
            for i in set_cols:
                try:
                    scores.append(int(cells[i]))
                except (ValueError, IndexError):
                    scores.append(0)
            # Trim trailing zeros — matches that go 3 sets show "0" for
            # set 4 in a 4-column table; we don't want phantom 25-0 sets.
            while scores and scores[-1] == 0:
                scores.pop()
            if scores:
                out[team_name] = scores
        if out:
            # First table with valid set scores wins; the page repeats
            # a similar table further down which we don't need.
            return out
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
        # Add additional canonical aliases for common stats Bound also
        # surfaces (TDS, ATT, COMP, INT, REC, AVG, etc.) so format
        # strings can use one set of keys regardless of source.
        for canon_key, src_key in _EXTRA_CANON_BY_CATEGORY.get(category, {}).items():
            if src_key in stats and canon_key not in stats:
                stats[canon_key] = stats[src_key]
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


# Map canonical category → canonical stats-dict key the frontend looks
# up. Mirrors Bound's emitted keys for back-compat (so frontend code
# that filters by "YDS" or "KLS" works regardless of source). When MP
# doesn't surface this exact key in the raw stats dict, the parser
# copies the leader_key's value to this canonical key so the lookup
# always lands.
_CANON_KEY = {
    # Volleyball.
    "Kills":          "KLS",
    "Assists":        "AST",
    "Digs":           "DIG",
    "Total Blocks":   "BLK",
    "Serve Aces":     "ACE",
    # Football — matches Bound's per-game keys.
    "Passing Yards":  "YDS",
    "Rushing Yards":  "YDS",
    "Receiving Yards": "YDS",
    "Total Tackles":  "TKL",
    # Basketball.
    "Points":   "PTS",
    "Rebounds": "RBD",
}


# Additional canonical aliases per category — these don't replace the
# raw MP column names (we keep those for the Full Box Score view) but
# DO let the frontend format strings use one stable key set across
# sources. Example: Bound emits "ATT" for rushing carries, MP emits
# "Car"; both end up as stats["ATT"] after this pass.
_EXTRA_CANON_BY_CATEGORY: dict[str, dict[str, str]] = {
    "Rushing Yards": {"TDS": "TD", "ATT": "Car", "AVG": "Avg", "LNG": "Lng"},
    "Passing Yards": {"TDS": "TD", "COMP": "C", "ATT": "Att", "INT": "Int", "AVG": "Avg"},
    "Receiving Yards": {"TDS": "TD"},
    "Total Tackles": {"SOLO": "Solo", "AST": "Asst"},
    "Points": {"FGM": "FGM", "FGA": "FGA", "FT_PCT": "FT%", "FG_PCT": "FG%", "MIN": "Min"},
    "Rebounds": {"OREB": "OReb", "DREB": "DReb", "AST": "Ast", "STL": "Stl", "BLK_BB": "Blk", "TO": "TO"},
}


def _normalize_year(yr: str) -> str | None:
    """MaxPreps writes (Sr)/(Jr)/(So)/(Fr); normalize to SR/JR/SO/FR."""
    yr = (yr or "").strip().upper()
    return yr if yr in {"SR", "JR", "SO", "FR"} else None


def _norm(name: str) -> str:
    """Match transform/stats.py:_norm conventions."""
    return re.sub(r"\s+", " ", (name or "").strip().casefold())
