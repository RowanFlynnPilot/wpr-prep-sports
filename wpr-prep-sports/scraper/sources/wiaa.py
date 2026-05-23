"""
WIAA ScoreCenter source — schools.wiaawi.org

Fallback / verification source. Official WIAA scoreboards.

URL patterns:
- Football scoreboard: https://schools.wiaawi.org/ScoreCenter/Results/FBScoreboard
- (Other sports have similar URLs — discover as needed)
- Halftime live scores: http://halftime.wiaawi.org

WIAA scoreboards are typically classic server-rendered HTML tables.
"""

from __future__ import annotations

from typing import Any

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

BASE_URL = "https://schools.wiaawi.org/ScoreCenter"

SCOREBOARD_PATH = {
    "football": "/Results/FBScoreboard",
    # TODO: discover other sport URLs
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _get(url: str) -> str:
    headers = {
        "User-Agent": "wpr-prep-sports/0.1 (+https://wausaupilotandreview.com)",
    }
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
        return resp.text


def fetch(sport: str, season: str) -> list[dict[str, Any]]:
    """
    Fetch raw records from WIAA ScoreCenter as verification/fallback.

    Records returned have the same shape as bound.fetch() output but with
    source="wiaa".
    """
    path = SCOREBOARD_PATH.get(sport)
    if not path:
        # No WIAA URL discovered yet; silently skip rather than fail.
        return []

    url = f"{BASE_URL}{path}"
    html = _get(url)
    soup = BeautifulSoup(html, "lxml")

    # TODO: parse the scoreboard table.
    _ = soup
    return []
