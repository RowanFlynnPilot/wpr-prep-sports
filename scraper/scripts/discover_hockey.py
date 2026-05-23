"""
One-shot discovery script: for each manifest school, ask WIAA which teams
the school fields this season, and print any whose sport name mentions
"hockey".

Used to populate:
  - SSID_BY_SPORT for boys_hockey / girls_hockey in sources/wiaa.py
  - hockey conference memberships in config/schools.json
  - co-op display-name aliases in transform/normalize.py

Run:
  cd scraper
  python scripts/discover_hockey.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make `config`, `sources`, etc. importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.loader import load_manifest  # noqa: E402
from sources import wiaa  # noqa: E402


def main() -> int:
    manifest = load_manifest()
    print(f"Scanning {len(manifest.schools)} manifest schools for hockey teams...")
    print()

    found: list[tuple[str, int, str, int]] = []  # (school_id, org_id, sport_name, team_id)
    ssids_seen: dict[int, str] = {}

    for school in manifest.schools:
        if school.wiaa_org_id is None:
            continue
        try:
            teams = wiaa.discover_team_ids(school.wiaa_org_id)
        except Exception as e:
            print(f"  !! {school.id}: discover failed ({e})")
            continue
        for t in teams:
            if "hockey" not in t.sport_name.lower():
                continue
            found.append((school.id, school.wiaa_org_id, t.sport_name, t.team_id))
            ssids_seen.setdefault(t.ssid, t.sport_name)
            print(f"  {school.id:24} ssid={t.ssid:5} sport='{t.sport_name}' team={t.team_id}")

    print()
    print("=== Distinct SSIDs encountered for hockey ===")
    for ssid, name in sorted(ssids_seen.items()):
        print(f"  ssid={ssid}  sport_name='{name}'")

    print()
    print(f"Total: {len(found)} hockey team entries across {len({f[0] for f in found})} schools")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
