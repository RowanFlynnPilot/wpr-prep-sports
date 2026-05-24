"""
Populate `maxpreps_slug` for every manifest school that fields volleyball.

Idempotent — schools that already have a slug are skipped; the script only
fills in `None` values. Re-run after expanding the manifest. Handles
unknown slugs by leaving them None and printing what to fill in by hand.

Usage:
  cd scraper
  .venv/Scripts/python.exe scripts/discover_maxpreps_slugs.py
  .venv/Scripts/python.exe scripts/discover_maxpreps_slugs.py --sport volleyball
  .venv/Scripts/python.exe scripts/discover_maxpreps_slugs.py --force      # re-probe even if slug already set
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from sources import maxpreps  # noqa: E402

MANIFEST_PATH = REPO_ROOT / "config" / "schools.json"


@dataclass
class _StubSchool:
    """Minimal stand-in for sources/maxpreps.py's discover_slug interface —
    we don't want to depend on config.loader's dataclass machinery here."""
    id: str
    name: str
    full_name: str
    mascot: str
    city: str
    maxpreps_slug: str | None = None
    conferences: list = field(default_factory=list)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--sport",
        default="volleyball",
        help="Only consider schools who play this sport (default: volleyball).",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Re-probe even when maxpreps_slug is already set.",
    )
    args = p.parse_args()

    with MANIFEST_PATH.open(encoding="utf-8") as f:
        raw = json.load(f)
    schools_raw = raw["schools"]
    targets = [
        s for s in schools_raw
        if any(c.get("sport") == args.sport for c in (s.get("conferences") or []))
    ]
    print(f"Considering {len(targets)} schools playing {args.sport}")

    filled = unchanged = missed = 0
    for s in targets:
        if s.get("maxpreps_slug") and not args.force:
            unchanged += 1
            continue
        stub = _StubSchool(
            id=s["id"],
            name=s.get("name", ""),
            full_name=s.get("full_name", ""),
            mascot=s.get("mascot", ""),
            city=s.get("city", ""),
        )
        try:
            slug = maxpreps.discover_slug(stub, sport_path=args.sport)
        except Exception as exc:  # noqa: BLE001
            print(f"  [err] {s['id']:25} {type(exc).__name__}: {str(exc)[:80]}")
            missed += 1
            continue
        if slug is None:
            print(f"  [--]  {s['id']:25} (no match — set maxpreps_slug manually)")
            missed += 1
            continue
        prev = s.get("maxpreps_slug")
        s["maxpreps_slug"] = slug
        if prev == slug:
            unchanged += 1
            continue
        filled += 1
        print(f"  [ok]  {s['id']:25} -> {slug}")

    # Write back, preserving the rest of the manifest.
    with MANIFEST_PATH.open("w", encoding="utf-8") as f:
        json.dump(raw, f, indent=2)
        f.write("\n")
    print(
        f"\nFilled: {filled} | unchanged: {unchanged} | missing: {missed}"
    )
    if missed:
        print(
            "\nMissing schools need a manual `maxpreps_slug` value in "
            "config/schools.json. Find the school's MaxPreps team page "
            "(e.g., by searching https://www.maxpreps.com/) and copy the "
            "URL fragment between /wi/ and /<sport>/. Example: from "
            "https://www.maxpreps.com/wi/wausau/wausau-east-lumberjacks/volleyball/ "
            "the slug is `wausau/wausau-east-lumberjacks`."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
