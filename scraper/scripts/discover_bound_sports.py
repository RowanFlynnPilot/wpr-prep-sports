"""
Discover Bound's sport_abbr identifier + stat-category vocabulary for
each non-football sport we care about. Used to plumb generalized
season-stats pulls into transform/stats.py and the sportConfig
registry on the frontend.

Approach:
  1. For each candidate sport_abbr, fetch Bound's scores page on a date
     that should have games. If the page returns >=1 game row, the
     abbr works.
  2. For each working abbr, fetch one tracked team's season-stats page
     (using their bound_slug) and print every stat-category card title
     plus its column-header keys. That tells us what categories we
     need to recognize in _CATEGORY_BY_TITLE.

Run:
  cd scraper
  python scripts/discover_bound_sports.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import re  # noqa: E402

import httpx  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

from sources.bound import BASE_URL, USER_AGENT  # noqa: E402

# Pairs of (sport_abbr, date-with-games, descriptive name) we'll probe.
# Dates picked from prior scrapes so we know games existed.
PROBES = [
    ("bb", "2026-01-09", "boys basketball"),
    ("gb", "2026-01-09", "girls basketball"),
    ("bh", "2026-01-09", "boys hockey"),
    ("gh", "2026-01-09", "girls hockey"),
    ("vb", "2025-09-09", "girls volleyball"),
    # Alternates to try if the above don't work:
    ("bbb", "2026-01-09", "boys basketball alt"),
    ("gbb", "2026-01-09", "girls basketball alt"),
    ("bhk", "2026-01-09", "boys hockey alt"),
    ("ghk", "2026-01-09", "girls hockey alt"),
    ("gv", "2025-09-09", "girls volleyball alt"),
    ("gvb", "2025-09-09", "girls volleyball alt2"),
]

# A team slug known to play multiple sports.
TEAM_SLUG = "wausaueast"


def fetch(url: str, params: dict | None = None) -> str | None:
    try:
        with httpx.Client(
            timeout=15.0,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            resp = client.get(url, params=params)
            if resp.status_code != 200:
                return None
            return resp.text
    except Exception:
        return None


def count_games_on_date(sport_abbr: str, date: str) -> int:
    url = f"{BASE_URL}/wi/wiaa/{sport_abbr}/2025-26/scores"
    html = fetch(url, params={"selectedDate": date})
    if html is None:
        return -1
    rows = re.findall(r'<tr[^>]+data-id="([^"]+)"', html)
    return len(rows)


def categories_for(sport_abbr: str, slug: str) -> list[tuple[str, list[str]]]:
    """Return [(category_title, [column_keys])] for every stat-card on the team page."""
    url = f"{BASE_URL}/wi/wiaa/{sport_abbr}/2025-26/{slug}/v/stats"
    html = fetch(url)
    if html is None:
        return []
    soup = BeautifulSoup(html, "lxml")
    out: list[tuple[str, list[str]]] = []
    for card in soup.select("div.card-table"):
        title_el = card.select_one(".card-title")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        table = card.find("table")
        if table is None:
            out.append((title, []))
            continue
        keys: list[str] = []
        for th in table.select("thead th"):
            a = th.find("a")
            label = (a.get_text(strip=True) if a and a.get_text(strip=True) else th.get_text(strip=True))
            keys.append(label)
        out.append((title, keys))
    return out


def main() -> int:
    print("=== Step 1: probe sport_abbrs for game presence ===\n")
    working: dict[str, str] = {}  # abbr -> sport name
    for abbr, date, name in PROBES:
        n = count_games_on_date(abbr, date)
        print(f"  {abbr:5} ({name:25}) on {date}: {n} game rows")
        if n > 0 and abbr not in working:
            working[abbr] = name

    print("\n=== Step 2: stat categories on a team page per working abbr ===\n")
    for abbr, name in working.items():
        cats = categories_for(abbr, TEAM_SLUG)
        print(f"--- {abbr} ({name}) — {TEAM_SLUG}'s stats page ---")
        if not cats:
            print("  (no stat cards found — team may not be on Bound for this sport)")
            continue
        for title, keys in cats:
            preview = ", ".join(keys[:8]) + (" ..." if len(keys) > 8 else "")
            print(f"  {title:18}  cols=[{preview}]")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
