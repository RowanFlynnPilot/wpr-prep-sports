"""
Halftime / ScoreCenter live-scores source.

Parses the WIAA ScoreCenter scoreboards (which update within ~10
minutes of a score being reported) into a structured list of game
states. Designed for the high-frequency live-update cadence — we
DON'T pull full schedules here, just current scores.

What we get:
  - Final scores (already covered by the per-team WIAA scrape, but
    landing on this scoreboard sooner)
  - In-progress games with markers like "PROGRESS", "HALF", "Q1"-"Q4",
    "OT" — exact wording varies by sport
  - Scheduled games with no score yet

Sport coverage today:
  - football: /ScoreCenter/Results/FBScoreboard

Other sports (basketball/volleyball/hockey) are accessible via
halftime.wiaawi.org's tournament endpoints, but their HTML structure
differs and tournament-window-only data is sparse off-season. Coverage
extends per sport as we add parsers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

CENTRAL = ZoneInfo("America/Chicago")


@dataclass(frozen=True)
class LiveGame:
    """One row from a WIAA scoreboard scrape."""
    date: datetime              # game start (tz-aware, US/Central)
    home_name: str              # WIAA-rendered name
    away_name: str
    home_score: int | None
    away_score: int | None
    status: str                 # "scheduled" | "in_progress" | "final"
    live_indicator: str | None  # raw period/clock text when in_progress ("Q3", "Halftime", "OT", etc.)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=8))
def _get(url: str) -> str:
    with httpx.Client(
        timeout=15.0,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.text


# In-progress markers WIAA uses in the team cell. Match before the score
# pattern so we don't classify "Q1 — Madison West 14-7" as final.
_IN_PROGRESS_RE = re.compile(
    r"\b(IN\s*PROGRESS|PROGRESS|HALF(?:TIME)?|OT(?:\d+)?|Q[1-4]|1st|2nd|3rd|4th)\b",
    re.IGNORECASE,
)

# Final "WIN" cell pattern: "TeamName WIN 30-6"
_WIN_CELL_RE = re.compile(r"^(.*?)\s+WIN\s+(\d+)\s*-\s*(\d+)\s*$")
# Loss cell: "TeamName LOSS"
_LOSS_CELL_RE = re.compile(r"^(.*?)\s+LOSS\s*$")
# Date+time format like "10/16/2025 6:00PM" or "10/16/2025 6:00 PM (C)"
_DATETIME_RE = re.compile(
    r"^(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?",
    re.IGNORECASE,
)


def _parse_datetime(text: str) -> datetime | None:
    m = _DATETIME_RE.match(text.strip())
    if not m:
        return None
    month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hour, minute = int(m.group(4)), int(m.group(5))
    ampm = (m.group(6) or "PM").upper()
    if ampm == "PM" and hour < 12:
        hour += 12
    if ampm == "AM" and hour == 12:
        hour = 0
    return datetime(year, month, day, hour, minute, tzinfo=CENTRAL)


def _parse_team_cell(text: str) -> tuple[str, int | None, str | None]:
    """
    Parse a team cell into (team_name, score, marker). Markers:
      None          — final winner cell with score parsed, OR scheduled (no score)
      "WIN"         — winner, score returned
      "LOSS"        — loser, no score here (winner cell carries it)
      "PROGRESS"    — game in progress; team_name preserved, score may be None
    """
    text = text.strip()
    if not text:
        return ("", None, None)

    # Check in-progress first — the marker may appear next to the team
    # name with a partial score.
    progress = _IN_PROGRESS_RE.search(text)
    if progress:
        score_m = re.search(r"(\d{1,3})\s*-\s*(\d{1,3})", text)
        score_val = int(score_m.group(1)) if score_m else None
        # Strip both the period marker AND the score so the team name
        # comes back clean. "Mosinee Q3 14-7" → "Mosinee", Q3, 14.
        clean = _IN_PROGRESS_RE.sub("", text)
        clean = re.sub(r"\d{1,3}\s*-\s*\d{1,3}", "", clean)
        clean = re.sub(r"\s+", " ", clean).strip(" -")
        return (clean, score_val, progress.group(0).upper())

    # WIN with score
    win = _WIN_CELL_RE.match(text)
    if win:
        return (win.group(1).strip(), int(win.group(2)), "WIN")

    # LOSS only
    loss = _LOSS_CELL_RE.match(text)
    if loss:
        return (loss.group(1).strip(), None, "LOSS")

    # No marker — treat as scheduled (team name only).
    return (text, None, None)


def fetch_football_live() -> list[LiveGame]:
    """
    Pull the statewide football scoreboard and return one entry per
    row. Filters out rows that fail to parse (defensive — WIAA's HTML
    occasionally mangles a row).
    """
    url = "https://schools.wiaawi.org/ScoreCenter/Results/FBScoreboard"
    html = _get(url)
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table")
    if table is None:
        return []

    out: list[LiveGame] = []
    for tr in table.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(cells) < 3:
            continue
        home_text, away_text, date_text = cells[0], cells[1], cells[2]
        home_name, home_score, home_mark = _parse_team_cell(home_text)
        away_name, away_score, away_mark = _parse_team_cell(away_text)
        dt = _parse_datetime(date_text)
        if not (home_name and away_name and dt):
            continue

        # When the loser's cell hides the score, the winner's cell has
        # the full "A-B" reading. We need to know which way: WIAA puts
        # the winner's score first.
        # Final classification: either side carries WIN or LOSS.
        is_in_progress = home_mark and home_mark.upper() not in {"WIN", "LOSS"}
        is_in_progress = is_in_progress or (
            away_mark and away_mark.upper() not in {"WIN", "LOSS"}
        )

        if is_in_progress:
            status = "in_progress"
            indicator = home_mark or away_mark
            # In progress: the scores on each cell are partial. If the
            # parser pulled a score from one cell, use it.
            out.append(LiveGame(
                date=dt,
                home_name=home_name,
                away_name=away_name,
                home_score=home_score,
                away_score=away_score,
                status=status,
                live_indicator=indicator,
            ))
            continue

        # Final classification — one cell has WIN with score, other LOSS.
        if home_mark == "WIN" and away_mark == "LOSS":
            # home_score holds "winner-loser"; assign both sides.
            ws, ls = home_score, _opposite_score(home_text)
            out.append(LiveGame(
                date=dt, home_name=home_name, away_name=away_name,
                home_score=ws, away_score=ls,
                status="final", live_indicator=None,
            ))
        elif away_mark == "WIN" and home_mark == "LOSS":
            ws, ls = away_score, _opposite_score(away_text)
            out.append(LiveGame(
                date=dt, home_name=home_name, away_name=away_name,
                home_score=ls, away_score=ws,
                status="final", live_indicator=None,
            ))
        else:
            # No marker — scheduled, no scores yet
            out.append(LiveGame(
                date=dt, home_name=home_name, away_name=away_name,
                home_score=None, away_score=None,
                status="scheduled", live_indicator=None,
            ))
    return out


def _opposite_score(winner_cell_text: str) -> int | None:
    """Pull the second number from a 'TeamName WIN X-Y' cell."""
    m = re.search(r"WIN\s+\d+\s*-\s*(\d+)", winner_cell_text)
    return int(m.group(1)) if m else None
