"""
Bound source — DEFERRED.

CLAUDE.md originally named Bound the primary source, but inspection on
2026-05-22 showed gobound.com's scores pages are jQuery shells that
AJAX-load game data after page render — the raw HTML contains no usable
game markup. Unsuitable for `requests + bs4`.

To revive this source we'd need:
- Playwright (or similar headless browser), adding a heavy CI dep, or
- Reverse-engineering Bound's internal JSON API (fragile)

For v1 we ship without Bound. See docs/data-sources.md for the WIAA-based
replacement strategy. This stub remains importable so older callers don't
break during the rollout — `fetch(...)` returns an empty list.
"""

from __future__ import annotations

from typing import Any


def fetch(sport: str, season: str) -> list[dict[str, Any]]:
    _ = (sport, season)
    return []
