"""
One-shot backfill: populate `wiaa_division` (sport -> "D1".."D7", "8P-D1")
for every school in scraper/config/schools.json from the official WIAA
tournament brackets.

Why this exists:
    The manifest (and the frontend schema, see docs/schema.md) reserve a
    per-school `wiaa_division` map so power rankings can filter by division
    and the bracket-challenge feature knows which bracket a school lives in.
    Nothing populated it. WIAA doesn't expose divisions on the school
    directory or ScoreCenter endpoints we already scrape — but the bracket
    site does, authoritatively: every bracket file is named and titled by
    division, and every team in it belongs to that division.

Source:
    tournaments.wiaawi.org hosts a machine-readable catalog
    (`brackets-data.js`) mapping school year -> sport -> gender -> a list of
    {division, path} bracket HTML files. Team entries inside each bracket are
    `<span class="bracketTeam">#4 Mosinee</span>`. (halftime.wiaawi.org's old
    /CustomApps/Tournaments/Brackets/HTML/ URLs now redirect here.)

Coverage semantics:
    - Basketball, volleyball, hockey, and soccer tournaments include every
      WIAA member team (no qualification), so brackets are a complete
      division roster: expect 100% of tracked (school, sport) pairs.
    - Football divisions are assigned by enrollment *to the 224-team playoff
      field* when it is set. Schools that miss the playoffs have no official
      division that season and are intentionally left unset. 8-player
      qualifiers get "8P-D1" style labels to keep them distinct from the
      11-player D1-D7 ladder.

Persistence:
    Writes scraper/config/schools.json directly (same formatting as
    config.loader.save_manifest: indent=2, ensure_ascii=False, trailing
    newline). It does NOT go through save_manifest because
    SchoolManifestEntry.to_dict() doesn't round-trip `wiaa_division` yet —
    routing through it would silently drop the field. NOTE: for the same
    reason, any future script that persists via save_manifest will drop this
    field until loader.py learns about it.

Run:
    python scraper/scripts/backfill_divisions.py               # 2025-26
    python scraper/scripts/backfill_divisions.py --season 2024-25
    python scraper/scripts/backfill_divisions.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from config.loader import MANIFEST_PATH, load_manifest  # noqa: E402
from transform.normalize import (  # noqa: E402
    _normalize_name,
    build_name_index_for_manifest,
)

BRACKETS_BASE = "https://tournaments.wiaawi.org"
CATALOG_URL = f"{BRACKETS_BASE}/brackets-data.js"
USER_AGENT = "wpr-prep-sports/0.1 (+https://wausaupilotandreview.com)"

# Our sport key -> [(catalog sport, catalog gender), ...]. Football checks
# both the 11-player and 8-player tournaments; a school only ever appears
# in one of them.
SPORT_TO_CATALOG: dict[str, list[tuple[str, str]]] = {
    "football": [("Football", "Boys"), ("Football (8-Player)", "Boys")],
    "boys_basketball": [("Basketball", "Boys")],
    "girls_basketball": [("Basketball", "Girls")],
    "volleyball": [("Volleyball", "Girls")],
    "boys_hockey": [("Hockey", "Boys")],
    "girls_hockey": [("Hockey", "Girls")],
    "boys_soccer": [("Soccer", "Boys")],
    "girls_soccer": [("Soccer", "Girls")],
}

_SEED_PREFIX_RE = re.compile(r"^#\d+\s+")


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _get(client: httpx.Client, url: str) -> httpx.Response:
    resp = client.get(url)
    resp.raise_for_status()
    return resp


def fetch_catalog(client: httpx.Client) -> dict[str, Any]:
    """Parse brackets-data.js into the bracketsData dict.

    The file is `const bracketsData = {...};` followed by more JS — decode
    just the first JSON object.
    """
    text = _get(client, CATALOG_URL).text
    m = re.search(r"const bracketsData\s*=\s*", text)
    if m is None:
        raise RuntimeError("brackets-data.js changed shape: no `const bracketsData =` found")
    data, _end = json.JSONDecoder().raw_decode(text, m.end())
    return data


def bracket_team_names(client: httpx.Client, path: str) -> set[str]:
    """Fetch one bracket HTML file and return the team names in it.

    Entries are `<span class="bracketTeam">` — either `#seed TeamName`
    (a team) or `@Venue` / empty (hosting site or unplayed slot); we keep
    only the teams.
    """
    url = f"{BRACKETS_BASE}/{path}".replace(" ", "%20")
    html = _get(client, url).text
    soup = BeautifulSoup(html, "lxml")
    names: set[str] = set()
    for span in soup.select("span.bracketTeam"):
        text = span.get_text(strip=True)
        if not text or text.startswith("@"):
            continue
        name = _SEED_PREFIX_RE.sub("", text).strip()
        if name:
            names.add(name)
    return names


def collect_divisions(season: str, *, delay: float = 0.4) -> dict[str, dict[str, str]]:
    """Return {sport: {school_id: division_label}} for every tracked pair
    the season's brackets can answer."""
    manifest = load_manifest()
    name_to_id = build_name_index_for_manifest(manifest)
    tracked: dict[str, set[str]] = {}
    for school in manifest.schools:
        for membership in school.conferences:
            tracked.setdefault(membership.sport, set()).add(school.id)

    with httpx.Client(
        timeout=25.0,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        catalog = fetch_catalog(client)
        season_brackets = catalog.get(season)
        if not season_brackets:
            raise RuntimeError(
                f"No '{season}' entry in brackets-data.js (have: {sorted(catalog)[-4:]})"
            )

        divisions: dict[str, dict[str, str]] = {}
        for sport, combos in SPORT_TO_CATALOG.items():
            found: dict[str, str] = {}
            for catalog_sport, gender in combos:
                entries = season_brackets.get(catalog_sport, {}).get(gender, [])
                eight_player = "8-Player" in catalog_sport
                for entry in entries:
                    label = f"D{entry['division']}"
                    if eight_player:
                        label = f"8P-{label}"
                    for name in bracket_team_names(client, entry["path"]):
                        school_id = name_to_id.get(_normalize_name(name), "")
                        if not school_id or school_id not in tracked.get(sport, set()):
                            continue
                        prev = found.get(school_id)
                        if prev is not None and prev != label:
                            print(
                                f"  ! {sport}/{school_id}: bracket disagreement "
                                f"{prev} vs {label} — keeping {prev}"
                            )
                            continue
                        found[school_id] = label
                    time.sleep(delay)  # be polite; these are static files
            divisions[sport] = found
            n_tracked = len(tracked.get(sport, set()))
            print(f"  {sport}: {len(found)}/{n_tracked} tracked schools placed")
    return divisions


def apply_to_manifest(divisions: dict[str, dict[str, str]]) -> tuple[int, int]:
    """Stamp `wiaa_division` onto every school in the raw manifest JSON.

    Operates on the raw file (not load_manifest/save_manifest) so the new
    field survives — see the module docstring. Returns
    (pairs_written, schools_touched).
    """
    raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    pairs = 0
    touched = 0
    for school in raw["schools"]:
        per_sport = {
            sport: by_school[school["id"]]
            for sport, by_school in sorted(divisions.items())
            if school["id"] in by_school
        }
        if school.get("wiaa_division") != per_sport:
            touched += 1
        school["wiaa_division"] = per_sport
        pairs += len(per_sport)
    MANIFEST_PATH.write_text(
        json.dumps(raw, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return pairs, touched


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--season", default="2025-26", help="school year, e.g. 2025-26")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="scrape and report, but don't write schools.json",
    )
    args = parser.parse_args()

    print(f"Collecting {args.season} divisions from WIAA tournament brackets...")
    divisions = collect_divisions(args.season)

    if args.dry_run:
        print(json.dumps(divisions, indent=2))
        return 0

    pairs, touched = apply_to_manifest(divisions)
    total_pairs = sum(len(v) for v in divisions.values())
    print(
        f"Wrote {pairs} (school, sport) division(s) across {touched} updated "
        f"school entr(ies) -> {MANIFEST_PATH.relative_to(REPO_ROOT.parent)}"
    )
    if pairs != total_pairs:
        print(f"  ! collected {total_pairs} pairs but wrote {pairs} — id mismatch?")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
