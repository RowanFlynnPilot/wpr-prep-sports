"""Write the team calendar feeds (data/calendar/<school_id>/*.ics).

Run after any scrape that changes games.json (scrape.yml and
scrape-live.yml do, before the validation gate). Reads every sport's live
games.json, so a school's all.ics covers all of its sports. Files whose
content is unchanged are left alone, and feeds for teams that no longer
have games are removed, so the commit only carries real changes.

    python scripts/build_calendars.py           # write data/calendar/
    python scripts/build_calendars.py --check   # report only, write nothing
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRAPER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRAPER_ROOT))

from output.calendar import build_all, read_site  # noqa: E402

DATA = SCRAPER_ROOT.parent / "data"
OUT = DATA / "calendar"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="report changes without writing")
    args = ap.parse_args(argv)

    schools_doc = load(DATA / "schools.json") or []
    schools = schools_doc["schools"] if isinstance(schools_doc, dict) else schools_doc
    games_by_sport: dict[str, list[dict]] = {}
    for sport_dir in sorted(p for p in DATA.iterdir() if p.is_dir()):
        games = load(sport_dir / "games.json")
        if isinstance(games, list) and (sport_dir / "meta.json").exists():
            games_by_sport[sport_dir.name] = games

    feeds = build_all(games_by_sport, schools, read_site(), load(DATA / "sponsors.json"))

    written = unchanged = removed = 0
    for rel, text in feeds.items():
        path = OUT / rel
        data = text.encode("utf-8")
        if path.exists() and path.read_bytes() == data:
            unchanged += 1
            continue
        written += 1
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    if OUT.exists():
        keep = {OUT / rel for rel in feeds}
        for path in OUT.rglob("*.ics"):
            if path not in keep:
                removed += 1
                if not args.check:
                    path.unlink()
        if not args.check:
            for d in sorted((p for p in OUT.iterdir() if p.is_dir()), reverse=True):
                if not any(d.iterdir()):
                    d.rmdir()

    verb = "would write" if args.check else "wrote"
    print(
        f"calendars: {len(feeds)} feeds across {len(games_by_sport)} sports, "
        f"{verb} {written}, unchanged {unchanged}, removed {removed}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
