"""
Normalize raw scraper records into the canonical Dataset.

This is where multi-source reconciliation happens: when the same game appears
in both Bound and WIAA, we merge them, preferring whichever source has more
complete data and noting both in `sources`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from models.schema import Dataset, Meta, Sport


def build_dataset(raw_records: list[dict[str, Any]], season: str) -> Dataset:
    """
    Take all raw records from all sources and produce a canonical Dataset.

    Pipeline:
      1. Match team name strings → canonical school IDs (via schools.json seed)
      2. Generate stable game IDs
      3. Deduplicate/merge games appearing in multiple sources
      4. Compute standings if not directly scraped
      5. Validate via Pydantic
    """
    # TODO: implement school name resolution.
    #       Load docs/schools-seed.json (TBD) as the canonical school list.
    #       Build a name → school_id map including common aliases
    #       (e.g. "DC Everest" / "D.C. Everest" / "DCE").
    _ = raw_records

    sports_in_data: set[Sport] = set()
    sources_used: set[str] = set()

    meta = Meta(
        last_updated=datetime.now(timezone.utc),
        season=season,
        sports_included=sorted(sports_in_data, key=lambda s: s.value),
        sources_used=sorted(sources_used),
    )

    return Dataset(meta=meta, schools=[], games=[], standings=[])
