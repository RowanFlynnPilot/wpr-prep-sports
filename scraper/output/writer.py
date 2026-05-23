"""
Write the canonical Dataset to JSON files in the data/ directory.

Produces one file per top-level resource for cleaner frontend fetching:
- schools.json
- games.json
- standings.json
- meta.json
"""

from __future__ import annotations

import json
from pathlib import Path

from models.schema import Dataset


def write_dataset(dataset: Dataset, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    _write_json(out_dir / "meta.json", dataset.meta.model_dump(mode="json"))
    _write_json(
        out_dir / "schools.json",
        [s.model_dump(mode="json") for s in dataset.schools],
    )
    _write_json(
        out_dir / "games.json",
        [g.model_dump(mode="json") for g in dataset.games],
    )
    _write_json(
        out_dir / "standings.json",
        [s.model_dump(mode="json") for s in dataset.standings],
    )
    _write_json(
        out_dir / "season_stats.json",
        [s.model_dump(mode="json") for s in dataset.season_stats],
    )


def _write_json(path: Path, data: object) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
        f.write("\n")
