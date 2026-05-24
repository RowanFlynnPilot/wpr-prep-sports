"""
WPR Power Index — cross-conference algorithmic team ranking.

Combines three components per team:
  - Win percentage           (40%)
  - Strength of schedule     (35%) — avg opponent W%, tracked opponents
  - Margin of victory        (25%) — avg point/goal/set differential,
                                     capped per-game so a blowout doesn't
                                     inflate a team's index

Score is a 0..100 value; ties broken by win pct, then SOS, then rank
alphabetically. Only manifest schools are ranked (untracked opponents
have no display surface).

Minimum games threshold filters out teams with too few datapoints —
prevents an early-season flash with one big win from running away
with #1.
"""

from __future__ import annotations

from typing import Iterable

from rich.console import Console

from config.loader import Manifest
from models.schema import Dataset, Game, GameStatus, PowerRanking, Sport

# Per-sport caps on the margin component so a single 70-0 football game
# or a 3-0 volleyball sweep doesn't drown out a season of close wins.
# Tuned to roughly 1.5× the typical winning margin in central WI play.
MARGIN_CAPS: dict[Sport, int] = {
    Sport.FOOTBALL: 28,
    Sport.BOYS_BASKETBALL: 25,
    Sport.GIRLS_BASKETBALL: 25,
    Sport.VOLLEYBALL: 3,       # set differential
    Sport.BOYS_HOCKEY: 5,
    Sport.GIRLS_HOCKEY: 5,
}

# Minimum games a team must have played to qualify for the rankings.
# Below this we don't have enough signal to rank fairly.
MIN_GAMES_PLAYED = 3

# Component weights — must sum to 1.0.
WEIGHT_WIN_PCT = 0.40
WEIGHT_SOS = 0.35
WEIGHT_MARGIN = 0.25

# Method line stored in the published JSON so a reader (or future-you)
# knows the algorithm version without spelunking through commits.
METHOD_DESCRIPTION = (
    f"WPR Power Index v1: {int(WEIGHT_WIN_PCT * 100)}% W%, "
    f"{int(WEIGHT_SOS * 100)}% SOS, {int(WEIGHT_MARGIN * 100)}% margin (capped per sport)"
)


# How long to keep a "previous" snapshot before rotating in the
# current rankings as the new comparison baseline. Picked at 6 days so
# a weekly cron lands neatly — Friday's scrape becomes next Friday's
# comparison point.
PREV_SNAPSHOT_AGE_DAYS = 6


def compute_power_rankings(
    dataset: Dataset,
    *,
    manifest: Manifest,
    prev_rankings: dict | None = None,
    console: Console | None = None,
) -> Dataset:
    """Compute Power Rankings for the dataset's sport. Writes to
    `dataset.power_rankings` and returns the dataset.

    `prev_rankings` (optional) is the wrapped JSON shape we write to
    `data/<sport>/power_rankings_prev.json`. When supplied, movement
    arrows fill in vs that snapshot. The caller decides when to rotate
    — see `output.writer:_maybe_rotate_prev_rankings`.
    """

    if not dataset.meta.sports_included:
        return dataset
    sport = dataset.meta.sports_included[0]
    cap = MARGIN_CAPS.get(sport)
    if cap is None:
        if console:
            console.print(f"[yellow]No margin cap for {sport} — skipping power rankings[/yellow]")
        return dataset

    tracked_ids = {s.id for s in manifest.schools}
    name_by_id = {s.id: s.name for s in manifest.schools}

    teams: dict[str, dict] = {}

    def _bucket(school_id: str) -> dict:
        return teams.setdefault(
            school_id,
            {"wins": 0, "losses": 0, "opponents": [], "margins": []},
        )

    for g in dataset.games:
        if g.status != GameStatus.FINAL:
            continue
        if g.home.score is None or g.away.score is None:
            continue
        # Cap margin in the absolute, then re-sign per side.
        raw_margin = g.home.score - g.away.score
        capped_home = _clamp(raw_margin, -cap, cap)

        if g.home.school_id and g.home.school_id in tracked_ids:
            t = _bucket(g.home.school_id)
            if g.home.score > g.away.score:
                t["wins"] += 1
            elif g.away.score > g.home.score:
                t["losses"] += 1
            t["opponents"].append(g.away.school_id or None)
            t["margins"].append(capped_home)

        if g.away.school_id and g.away.school_id in tracked_ids:
            t = _bucket(g.away.school_id)
            if g.away.score > g.home.score:
                t["wins"] += 1
            elif g.home.score > g.away.score:
                t["losses"] += 1
            t["opponents"].append(g.home.school_id or None)
            t["margins"].append(-capped_home)

    # Filter teams below the minimum.
    for tid in list(teams.keys()):
        if teams[tid]["wins"] + teams[tid]["losses"] < MIN_GAMES_PLAYED:
            del teams[tid]

    # Pass 1: win percentages.
    for t in teams.values():
        gp = t["wins"] + t["losses"]
        t["win_pct"] = t["wins"] / gp if gp > 0 else 0.0

    # Pass 2: SOS (only tracked opponents contribute to avg). Teams
    # that played mostly untracked opponents fall back to .500 so the
    # weight doesn't go to zero.
    for t in teams.values():
        opp_pcts = [
            teams[o]["win_pct"]
            for o in t["opponents"]
            if o and o in teams
        ]
        t["sos"] = sum(opp_pcts) / len(opp_pcts) if opp_pcts else 0.5

    # Pass 3: avg capped margin + final score.
    out: list[PowerRanking] = []
    for tid, t in teams.items():
        avg_margin = sum(t["margins"]) / len(t["margins"]) if t["margins"] else 0
        # Normalize margin to 0..1 against the cap window (-cap..+cap).
        margin_norm = (avg_margin + cap) / (2 * cap)
        score = 100.0 * (
            t["win_pct"] * WEIGHT_WIN_PCT
            + t["sos"] * WEIGHT_SOS
            + margin_norm * WEIGHT_MARGIN
        )
        out.append(
            PowerRanking(
                rank=0,  # filled in after sort
                school_id=tid,
                school_name=name_by_id.get(tid, tid),
                wins=t["wins"],
                losses=t["losses"],
                win_pct=round(t["win_pct"], 4),
                sos=round(t["sos"], 4),
                avg_margin_capped=round(avg_margin, 2),
                score=round(score, 2),
            )
        )

    # Sort + assign ranks. Ties: score desc, then W% desc, then SOS
    # desc, then name asc — deterministic so re-runs don't shuffle.
    out.sort(
        key=lambda r: (-r.score, -r.win_pct, -r.sos, r.school_name)
    )
    for i, r in enumerate(out, 1):
        r.rank = i

    # Fill in movement vs the previous snapshot. Positive = improved
    # (e.g., was #5, now #2 → movement=3). New teams in the list get
    # movement=None and render as "NEW" in the UI.
    if prev_rankings:
        prev_rank_by_id = _prev_rank_map(prev_rankings)
        for r in out:
            prev_rank = prev_rank_by_id.get(r.school_id)
            if prev_rank is not None:
                r.movement = prev_rank - r.rank

    dataset.power_rankings = out
    if console:
        console.print(
            f"[green]Power rankings:[/green] {len(out)} teams ranked"
            f" — top 5: "
            + ", ".join(f"#{r.rank} {r.school_name} ({r.wins}-{r.losses})" for r in out[:5])
        )
    return dataset


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _prev_rank_map(prev_rankings: dict) -> dict[str, int]:
    """Extract `{school_id: rank}` from the wrapped power_rankings_prev.json
    shape. Tolerates both the wrapped dict and bare list forms — same
    handling the dataset reader uses."""
    if isinstance(prev_rankings, list):
        items = prev_rankings
    else:
        items = prev_rankings.get("rankings", [])
    out: dict[str, int] = {}
    for entry in items:
        sid = entry.get("school_id") if isinstance(entry, dict) else None
        rank = entry.get("rank") if isinstance(entry, dict) else None
        if sid and isinstance(rank, int):
            out[sid] = rank
    return out
