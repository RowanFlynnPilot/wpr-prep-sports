"""
Bound source — gobound.com

Primary data source. Wisconsin-specific HS sports aggregator with structured
per-conference, per-sport, per-season pages.

URL patterns observed (verify and extend):
- All-state scores by sport:
    https://www.gobound.com/wi/wiaa/{sport_abbr}/{season}/scores
- Conference index:
    https://www.gobound.com/wi/conferences
- Per-conference pages:
    https://www.gobound.com/wi/conferences/{conference_slug}

Sport abbreviations used by Bound (confirm via inspection):
    fb  = football
    bb  = boys basketball (verify)
    gb  = girls basketball (verify)
    vb  = volleyball
    sb  = softball / soccer (disambiguate)
    bbl = baseball (verify)
"""

from __future__ import annotations

from typing import Any

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

BASE_URL = "https://www.gobound.com"

SPORT_ABBR = {
    "football": "fb",
    "volleyball": "vb",
    "boys_basketball": "bb",   # TODO verify
    "girls_basketball": "gb",  # TODO verify
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _get(url: str) -> str:
    """Fetch a URL with retries."""
    headers = {
        "User-Agent": "wpr-prep-sports/0.1 (+https://wausaupilotandreview.com)",
    }
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
        return resp.text


def fetch(sport: str, season: str) -> list[dict[str, Any]]:
    """
    Fetch raw game/standings records for a sport and season from Bound.

    Returns a list of raw dicts that the normalize step will canonicalize.
    """
    abbr = SPORT_ABBR.get(sport)
    if not abbr:
        raise ValueError(f"Unknown sport for Bound: {sport}")

    scores_url = f"{BASE_URL}/wi/wiaa/{abbr}/{season}/scores"
    html = _get(scores_url)
    soup = BeautifulSoup(html, "lxml")

    # TODO: implement parsing.
    # Bound's scores page lists games grouped by date.
    # Each row typically has: date, time, away_team, home_team, score, conference.
    # Inspect the page DOM and extract into raw dicts of shape:
    # {
    #     "source": "bound",
    #     "sport": sport,
    #     "season": season,
    #     "date": "2025-09-05",
    #     "time": "19:00",
    #     "away": {"name": "...", "score": int_or_null},
    #     "home": {"name": "...", "score": int_or_null},
    #     "status": "final" | "scheduled" | "in_progress",
    #     "conference": "Wisconsin Valley" or None,
    # }
    _ = soup  # placeholder
    return []


def fetch_standings(sport: str, season: str, conference: str) -> list[dict[str, Any]]:
    """Fetch standings for a given conference, sport, and season."""
    # TODO: implement
    return []


def fetch_schools_in_conference(conference_slug: str) -> list[dict[str, Any]]:
    """List schools belonging to a conference."""
    # TODO: implement
    return []
