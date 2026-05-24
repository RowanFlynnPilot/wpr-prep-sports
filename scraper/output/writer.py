"""
Write the canonical Dataset to JSON files in the data/ directory.

Layout (since the sport-switcher refactor):
- schools.json            (top level, cross-sport)
- <sport>/meta.json
- <sport>/games.json
- <sport>/standings.json
- <sport>/season_stats.json

schools.json stays at the root because the same school appears across
sports — frontend loads it once regardless of which sport is selected.
"""

from __future__ import annotations

import json
from pathlib import Path

from models.schema import Dataset


def write_dataset(dataset: Dataset, out_dir: Path) -> None:
    """
    Write a sport-scoped dataset.

    `dataset.meta.sports_included` must contain exactly one sport — the
    scraper pipeline is per-sport, so the writer expects per-sport
    Datasets. Schools are written at the root; everything else lands in
    `data/<sport>/`.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    sports = dataset.meta.sports_included
    if len(sports) != 1:
        raise ValueError(
            f"write_dataset expects exactly one sport in meta.sports_included, got {sports}"
        )
    sport_dir = out_dir / sports[0].value
    sport_dir.mkdir(parents=True, exist_ok=True)

    # Cross-sport — written once at the root, overwritten by every sport
    # run with the same payload (the manifest is shared).
    _write_json(
        out_dir / "schools.json",
        [s.model_dump(mode="json") for s in dataset.schools],
    )

    # Per-sport — isolated under data/<sport>/ so multiple sports coexist.
    _write_json(sport_dir / "meta.json", dataset.meta.model_dump(mode="json"))
    _write_json(
        sport_dir / "games.json",
        [g.model_dump(mode="json") for g in dataset.games],
    )
    _write_json(
        sport_dir / "standings.json",
        [s.model_dump(mode="json") for s in dataset.standings],
    )
    _write_json(
        sport_dir / "season_stats.json",
        [s.model_dump(mode="json") for s in dataset.season_stats],
    )


def _write_json(path: Path, data: object) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
        f.write("\n")


def read_dataset(sport: str, out_dir: Path) -> Dataset | None:
    """
    Symmetric reader of write_dataset. Returns None when files don't
    exist (e.g. a sport that hasn't been scraped yet); used by the
    --live fast path which only updates existing data, never seeds it.
    """
    from models.schema import Game, Meta, School, SeasonStat, Standing  # local import to avoid cycles

    sport_dir = out_dir / sport
    if not sport_dir.exists():
        return None
    schools_path = out_dir / "schools.json"
    meta_path = sport_dir / "meta.json"
    games_path = sport_dir / "games.json"
    standings_path = sport_dir / "standings.json"
    season_path = sport_dir / "season_stats.json"
    if not (meta_path.exists() and games_path.exists()):
        return None

    def _load(p):
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

    return Dataset(
        meta=Meta(**_load(meta_path)),
        schools=[School(**s) for s in _load(schools_path)],
        games=[Game(**g) for g in _load(games_path)],
        standings=[Standing(**s) for s in _load(standings_path)],
        season_stats=[SeasonStat(**r) for r in _load(season_path)],
    )
