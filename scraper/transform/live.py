"""
Merge live in-progress scores from halftime/ScoreCenter into the
existing dataset. Designed to run on a fast cadence (every 10 min
during game windows) without touching the per-team WIAA scrape.

Safety guarantee: never DOWNGRADE a game. If our dataset has the
game as final with both scores, the live scrape can't move it back
to in_progress or scheduled. Live data only fills in or upgrades.
"""

from __future__ import annotations

import re
import sys
from typing import Optional

from rich.console import Console

from models.schema import Dataset, Game, GameStatus
from sources import halftime
from transform.normalize import build_name_index_for_manifest
from config.loader import Manifest


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().casefold())


_STATUS_RANK = {
    GameStatus.SCHEDULED: 0,
    GameStatus.IN_PROGRESS: 1,
    GameStatus.FINAL: 2,
    GameStatus.POSTPONED: 0,
    GameStatus.CANCELLED: 0,
}


def merge_live_football(
    dataset: Dataset,
    *,
    manifest: Manifest,
    console: Console | None = None,
) -> Dataset:
    """
    Pull live football scores and merge into dataset.games. Returns
    the (mutated) dataset; prints a summary to console.
    """
    try:
        rows = halftime.fetch_football_live()
    except Exception as e:  # noqa: BLE001
        if console:
            console.print(f"[yellow]live scrape failed: {e}[/yellow]")
        return dataset

    if not rows:
        if console:
            console.print("[dim]no live rows returned[/dim]")
        return dataset

    # Build lookup: (date_iso, frozenset({home_norm, away_norm})) → LiveGame
    pair_index: dict[tuple[str, frozenset[str]], halftime.LiveGame] = {}
    for r in rows:
        iso = r.date.strftime("%Y-%m-%d")
        pair_index[(iso, frozenset({_norm(r.home_name), _norm(r.away_name)}))] = r

    name_to_id = build_name_index_for_manifest(manifest)
    updated_in_progress = 0
    updated_final = 0

    for game in dataset.games:
        iso = game.date.strftime("%Y-%m-%d")
        key = (iso, frozenset({_norm(game.home.name), _norm(game.away.name)}))
        live = pair_index.get(key)
        if live is None:
            continue

        live_status = {
            "scheduled": GameStatus.SCHEDULED,
            "in_progress": GameStatus.IN_PROGRESS,
            "final": GameStatus.FINAL,
        }.get(live.status, GameStatus.SCHEDULED)

        # Don't downgrade — if we already have FINAL, ignore in-progress
        # / scheduled status from the live page.
        if _STATUS_RANK[game.status] > _STATUS_RANK[live_status]:
            continue

        # Resolve which live cell corresponds to home vs away on our side.
        # halftime returns home/away keyed to WIAA's column order, which
        # uses the same home_name/away_name as our schedule scrape — but
        # spellings can differ. Verify via name_to_id alias resolution.
        live_home_id = name_to_id.get(_norm(live.home_name), "")
        live_away_id = name_to_id.get(_norm(live.away_name), "")
        sides_match = (
            live_home_id == game.home.school_id and live_away_id == game.away.school_id
        ) or (
            _norm(live.home_name) == _norm(game.home.name)
            and _norm(live.away_name) == _norm(game.away.name)
        )
        # Sides may also be reversed due to WIAA inconsistencies. Detect
        # and swap scores.
        sides_reversed = (
            _norm(live.home_name) == _norm(game.away.name)
            and _norm(live.away_name) == _norm(game.home.name)
        )

        if live_status == GameStatus.IN_PROGRESS:
            game.status = GameStatus.IN_PROGRESS
            if sides_reversed:
                game.home.score = live.away_score
                game.away.score = live.home_score
            else:
                game.home.score = live.home_score
                game.away.score = live.away_score
            if "halftime" not in game.sources:
                game.sources.append("halftime")
            updated_in_progress += 1
        elif live_status == GameStatus.FINAL and game.status != GameStatus.FINAL:
            game.status = GameStatus.FINAL
            if sides_reversed:
                game.home.score = live.away_score
                game.away.score = live.home_score
            else:
                game.home.score = live.home_score
                game.away.score = live.away_score
            if "halftime" not in game.sources:
                game.sources.append("halftime")
            updated_final += 1
        # else: scheduled live ≤ existing scheduled; nothing to do.

    if console:
        console.print(
            f"[green]live merge:[/green] {updated_in_progress} in-progress, "
            f"{updated_final} newly final ({len(rows)} live rows seen)"
        )
    if updated_in_progress > 0 or updated_final > 0:
        if "halftime" not in dataset.meta.sources_used:
            dataset.meta.sources_used.append("halftime")
    return dataset
