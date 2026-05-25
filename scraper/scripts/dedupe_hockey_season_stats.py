"""
Post-process: dedupe duplicate per-player rows in hockey season_stats
files. WPH renders Overall + Conference sections on the same player-
stats page; old runs accumulated both rows per player. Keeps the row
with the highest GP per (school, player_name, jersey).

Usage:
  cd scraper
  .venv/Scripts/python.exe scripts/dedupe_hockey_season_stats.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"


def main() -> int:
    for sport in ("boys_hockey", "girls_hockey"):
        path = DATA_DIR / sport / "season_stats.json"
        if not path.exists():
            print(f"[{sport}] no season_stats.json — skipping")
            continue
        rows = json.loads(path.read_text(encoding="utf-8"))
        best: dict[tuple, dict] = {}
        order: list[tuple] = []
        for r in rows:
            key = (r.get("school_id"), r.get("player_name"), r.get("jersey") or "", r.get("category"))
            try:
                gp = int((r.get("stats") or {}).get("GP", "0") or "0")
            except (ValueError, TypeError):
                gp = 0
            existing = best.get(key)
            if existing is None:
                order.append(key)
                best[key] = (gp, r)
            elif gp > existing[0]:
                best[key] = (gp, r)
        deduped = [best[k][1] for k in order]
        dropped = len(rows) - len(deduped)
        path.write_text(
            json.dumps(deduped, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"[{sport}] {len(rows)} → {len(deduped)} rows ({dropped} duplicates dropped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
