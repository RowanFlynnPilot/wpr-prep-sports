"""
Crawl every Wisconsin Prep Hockey conference page (both boys + girls
2025-26 varsity) and collect (page_id, slug, display_name) for every
team. Output a map we can hand-match to our manifest.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE = "https://www.wisconsinprephockey.net"
UA = "Mozilla/5.0 Chrome/124"

# Conference page IDs from the team page subnav, plus the boys/girls 2025-26
# varsity roots that link to them.
BOYS_PARENT = 9183950
GIRLS_PARENT = 9225440
BOYS_SUBSEASON = 951906
GIRLS_SUBSEASON = 953552


def fetch(url: str) -> str:
    with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": UA}) as c:
        r = c.get(url)
    return r.text if r.status_code == 200 else ""


_PAGE_SHOW_RE = re.compile(r"/page/show/(\d+)-([a-z0-9\-]+)")


def conference_pages_from(parent_id: int, subseason: int) -> list[tuple[int, str]]:
    """Return [(page_id, slug), ...] for every conference linked off a parent page."""
    html = fetch(f"{BASE}/page/show/{parent_id}?subseason={subseason}")
    soup = BeautifulSoup(html, "lxml")
    seen = set()
    uniq = []
    for a in soup.find_all("a", href=True):
        m = _PAGE_SHOW_RE.search(a["href"])
        if not m:
            continue
        pid = int(m.group(1))
        slug = m.group(2)
        if pid == parent_id or pid in seen:
            continue
        seen.add(pid)
        uniq.append((pid, slug))
    return uniq


def teams_on_conference(conf_id: int, subseason: int) -> list[tuple[int, str]]:
    """Crawl a conference page and return its [(team_page_id, slug), ...]."""
    html = fetch(f"{BASE}/page/show/{conf_id}?subseason={subseason}")
    soup = BeautifulSoup(html, "lxml")
    out = []
    seen_ids = set()
    for a in soup.find_all("a", href=True):
        m = _PAGE_SHOW_RE.search(a["href"])
        if not m:
            continue
        pid = int(m.group(1))
        slug = m.group(2)
        if pid == conf_id or pid in seen_ids:
            continue
        # Skip the parent/season root and obvious non-team pages.
        if slug in {"news", "calendar", "varsity-stat-leaders", "out-of-state-teams",
                    "other", "wisconsin-valley", "great-northern", "big-rivers",
                    "badger", "badgerland", "big-eight", "classic-eight",
                    "fox-river-classic", "middle-border", "north-shore",
                    "independents", "boys-2025-2026-", "girls-2025-2026-",
                    "western-wisc", "submit-scores", "search-wisconsin-prep-hockey",
                    "seniors", "information"}:
            continue
        seen_ids.add(pid)
        out.append((pid, slug))
    return out


def main() -> int:
    print("=== BOYS HOCKEY conferences + teams ===")
    confs = conference_pages_from(BOYS_PARENT, BOYS_SUBSEASON)
    for conf_id, conf_slug in confs:
        teams = teams_on_conference(conf_id, BOYS_SUBSEASON)
        print(f"\n[{conf_slug}] (page {conf_id}) — {len(teams)} teams:")
        for pid, slug in teams:
            print(f"  {pid:>8}  {slug}")

    print("\n\n=== GIRLS HOCKEY conferences + teams ===")
    confs = conference_pages_from(GIRLS_PARENT, GIRLS_SUBSEASON)
    for conf_id, conf_slug in confs:
        teams = teams_on_conference(conf_id, GIRLS_SUBSEASON)
        print(f"\n[{conf_slug}] (page {conf_id}) — {len(teams)} teams:")
        for pid, slug in teams:
            print(f"  {pid:>8}  {slug}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
