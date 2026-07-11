"""
Refresh the saved-HTML fixtures the parser tests run against.

Fetches a handful of live WIAA pages (3 requests, politely spaced) and
saves the raw responses under tests/fixtures/. Run on demand — never in
CI — when WIAA changes markup or at the start of a season:

  cd scraper
  python tests/capture_fixtures.py

The tests assert structural invariants (rows parse, dates are ISO,
names are non-empty), not exact game lists, so refreshed fixtures don't
require updating expectations unless the markup itself changed.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from config.loader import load_manifest  # noqa: E402
from sources import wiaa  # noqa: E402

FIXTURE_DIR = Path(__file__).parent / "fixtures"
SCHOOL_ID = "wausau-east"
SPORT = "football"
DELAY = 1.0


def main() -> int:
    FIXTURE_DIR.mkdir(exist_ok=True)
    manifest = load_manifest()
    school = next((s for s in manifest.schools if s.id == SCHOOL_ID), None)
    if school is None or school.wiaa_org_id is None:
        print(f"{SCHOOL_ID} missing from manifest (or no wiaa_org_id) — aborting")
        return 1

    with httpx.Client(
        timeout=20.0, follow_redirects=True, headers={"User-Agent": wiaa.USER_AGENT}
    ) as client:
        print(f"1/3 SearchOrg for {school.name!r}")
        r = client.get(
            f"{wiaa.BASE_URL}/Directory/School/SearchOrg",
            params={"query": school.name, "levelT": 0, "classT": 0, "memberT": 20},
        )
        r.raise_for_status()
        (FIXTURE_DIR / "wiaa_search_org.json").write_text(
            json.dumps(r.json(), indent=2), encoding="utf-8"
        )
        time.sleep(DELAY)

        print(f"2/3 GetDirectorySchool for OrgID={school.wiaa_org_id}")
        r = client.post(
            f"{wiaa.BASE_URL}/Directory/School/GetDirectorySchool",
            params={"OrgID": school.wiaa_org_id, "showPub": "False"},
            headers={"Content-Length": "0"},
        )
        r.raise_for_status()
        (FIXTURE_DIR / "wiaa_directory_school.html").write_text(r.text, encoding="utf-8")

        entries = wiaa.parse_team_entries_html(r.text)
        team_id = None
        for e in entries:
            if wiaa._label_matches(SPORT, e.sport_name):
                team_id = e.team_id
                break
        if team_id is None:
            print(f"no {SPORT} team row found in directory page — aborting")
            return 1
        time.sleep(DELAY)

        print(f"3/3 Schedule/Index for TeamID={team_id}")
        r = client.get(f"{wiaa.BASE_URL}/Directory/Schedule/Index", params={"TeamID": team_id})
        r.raise_for_status()
        (FIXTURE_DIR / "wiaa_schedule.html").write_text(r.text, encoding="utf-8")
        (FIXTURE_DIR / "wiaa_schedule.meta.json").write_text(
            json.dumps(
                {
                    "school_id": SCHOOL_ID,
                    "sport": SPORT,
                    "team_id": team_id,
                    "captured_from": f"{wiaa.BASE_URL}/Directory/Schedule/Index?TeamID={team_id}",
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    print(f"fixtures written to {FIXTURE_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
