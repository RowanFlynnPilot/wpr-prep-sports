"""
Refresh the saved-HTML fixtures the parser tests run against.

Fetches a handful of live WIAA pages (3 requests, politely spaced) and
saves the raw responses under tests/fixtures/. Run on demand — never in
CI — when WIAA changes markup or at the start of a season:

  cd scraper
  python tests/capture_fixtures.py          # directory/schedule (3 requests)
  python tests/capture_fixtures.py --state  # state-tournament pages (6 requests)

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


# (fixture name, page path) for `--state`, trimmed with
# wiaa_state.trim_page_for_fixture so each file holds only what the parsers read.
STATE_FIXTURES = [
    ("wiaa_state_football_archive.html", "/sports/football/football-state-archive"),
    (
        "wiaa_state_football_8p_archive.html",
        "/sports/8-player-football/8-player-football-state-archive",
    ),
    (
        "wiaa_state_volleyball_archive.html",
        "/sports/girls-volleyball/girls-volleyball-state-archive",
    ),
    ("wiaa_state_boys_soccer_archive.html", "/sports/boys-soccer/boys-soccer-state-archive"),
    (
        "wiaa_state_volleyball_tournament.html",
        "/sports/girls-volleyball/girls-volleyball-tournament",
    ),
    ("wiaa_state_football_tournament.html", "/sports/football/football-tournament"),
]


def capture_state() -> int:
    """Refresh the state-tournament page fixtures. The archive tests assert
    real 2025 results, so once newer years stack on top, bump `keep_years`
    (or move the expected scores forward) to keep 2025 in the trimmed file."""
    from sources import wiaa_state

    FIXTURE_DIR.mkdir(exist_ok=True)
    with httpx.Client(
        timeout=25.0, follow_redirects=True, headers={"User-Agent": wiaa_state.USER_AGENT}
    ) as client:
        for i, (name, path) in enumerate(STATE_FIXTURES, 1):
            print(f"{i}/{len(STATE_FIXTURES)} {path}")
            r = client.get(wiaa_state.BASE_URL + path)
            r.raise_for_status()
            (FIXTURE_DIR / name).write_text(
                wiaa_state.trim_page_for_fixture(r.text), encoding="utf-8"
            )
            time.sleep(DELAY)
    print(f"state fixtures written to {FIXTURE_DIR}")
    return 0


def main() -> int:
    if "--state" in sys.argv[1:]:
        return capture_state()
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
