"""
One-shot manifest expansion: ensure every conference we render standings
for has its full roster in config/schools.json.

What this does:

1. For each existing manifest school, add per-sport conference memberships
   that were inferred from (C) games but not yet declared.

2. Append new school stubs for opponents we play in (C) games who aren't
   in our manifest yet. `wiaa_org_id` is left None — the regular scraper's
   `ensure_org_ids` pass will discover and persist it on next run.

Re-run after each conference realignment; idempotent.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "config" / "schools.json"

# Additional sport conference memberships to declare on already-tracked
# schools. (school_id, sport, conference) tuples. Idempotent: skipped if
# the school already has that membership.
NEW_MEMBERSHIPS: list[tuple[str, str, str]] = [
    # Marawood basketball/volleyball — small Northwoods schools also tracked
    # for football in NW-East 8 that play hoops/volleyball in Marawood.
    ("phillips", "boys_basketball", "Marawood"),
    ("phillips", "girls_basketball", "Marawood"),
    ("phillips", "volleyball", "Marawood"),
    ("prentice", "boys_basketball", "Marawood"),
    ("prentice", "girls_basketball", "Marawood"),
    ("prentice", "volleyball", "Marawood"),
    ("rib-lake", "boys_basketball", "Marawood"),
    ("rib-lake", "girls_basketball", "Marawood"),
    ("rib-lake", "volleyball", "Marawood"),
    ("chequamegon", "boys_basketball", "Marawood"),
    ("chequamegon", "girls_basketball", "Marawood"),
    ("chequamegon", "volleyball", "Marawood"),
    # CWC schools also playing Marawood basketball/volleyball.
    ("auburndale", "boys_basketball", "Marawood"),
    ("auburndale", "girls_basketball", "Marawood"),
    ("auburndale", "volleyball", "Marawood"),
    ("assumption", "boys_basketball", "Marawood"),
    ("assumption", "girls_basketball", "Marawood"),
    ("assumption", "volleyball", "Marawood"),
    # Hockey lead schools — co-op aliases route through these; just add
    # the boys_hockey conference membership so they appear in standings.
    ("marshfield", "boys_hockey", "Wisconsin Valley"),
    ("merrill", "boys_hockey", "Wisconsin Valley"),
    ("antigo", "boys_hockey", "Great Northern"),
    ("medford", "boys_hockey", "Great Northern"),
    ("rhinelander", "boys_hockey", "Great Northern"),
    # Loyal is the lead of the "Loyal/Greenwood" football co-op (CWC-Large).
    ("loyal", "football", "CWC-Large"),
]

# New school stubs. `wiaa_org_id` is None; main.py's ensure_org_ids will
# discover it on the next scrape. Mascot/city/colors are best-known
# defaults; refine later via team-page visits.
NEW_SCHOOLS: list[dict] = [
    {
        "id": "northland-pines",
        "name": "Northland Pines",
        "full_name": "Northland Pines High School",
        "mascot": "Eagles",
        "city": "Eagle River",
        "colors": ["#1e3a8a", "#fbbf24"],
        "conferences": [
            {"sport": "football", "conference": "Great Northern"},
            {"sport": "boys_basketball", "conference": "Great Northern"},
            {"sport": "girls_basketball", "conference": "Great Northern"},
            {"sport": "volleyball", "conference": "Great Northern"},
            {"sport": "boys_hockey", "conference": "Great Northern"},
        ],
    },
    {
        "id": "waupaca",
        "name": "Waupaca",
        "full_name": "Waupaca High School",
        "mascot": "Comets",
        "city": "Waupaca",
        "colors": ["#1e40af", "#fde047"],
        "conferences": [
            {"sport": "boys_hockey", "conference": "Great Northern"},
        ],
    },
    # Cloverbelt basketball/volleyball schools.
    {
        "id": "loyal",
        "name": "Loyal",
        "full_name": "Loyal High School",
        "mascot": "Greyhounds",
        "city": "Loyal",
        "colors": ["#000000", "#facc15"],
        "conferences": [
            {"sport": "boys_basketball", "conference": "Cloverbelt"},
            {"sport": "girls_basketball", "conference": "Cloverbelt"},
            {"sport": "volleyball", "conference": "Cloverbelt"},
        ],
    },
    {
        "id": "neillsville",
        "name": "Neillsville",
        "full_name": "Neillsville High School",
        "mascot": "Warriors",
        "city": "Neillsville",
        "colors": ["#dc2626", "#000000"],
        "conferences": [
            {"sport": "boys_basketball", "conference": "Cloverbelt"},
            {"sport": "girls_basketball", "conference": "Cloverbelt"},
            {"sport": "volleyball", "conference": "Cloverbelt"},
        ],
    },
    {
        "id": "owen-withee",
        "name": "Owen-Withee",
        "full_name": "Owen-Withee High School",
        "mascot": "Blackhawks",
        "city": "Owen",
        "colors": ["#000000", "#fbbf24"],
        "conferences": [
            {"sport": "boys_basketball", "conference": "Cloverbelt"},
            {"sport": "girls_basketball", "conference": "Cloverbelt"},
            {"sport": "volleyball", "conference": "Cloverbelt"},
        ],
    },
    {
        "id": "gilman",
        "name": "Gilman",
        "full_name": "Gilman High School",
        "mascot": "Pirates",
        "city": "Gilman",
        "colors": ["#000000", "#facc15"],
        "conferences": [
            {"sport": "boys_basketball", "conference": "Cloverbelt"},
            {"sport": "girls_basketball", "conference": "Cloverbelt"},
            {"sport": "volleyball", "conference": "Cloverbelt"},
        ],
    },
    {
        "id": "greenwood",
        "name": "Greenwood",
        "full_name": "Greenwood High School",
        "mascot": "Indians",
        "city": "Greenwood",
        "colors": ["#15803d", "#fbbf24"],
        "conferences": [
            {"sport": "boys_basketball", "conference": "Cloverbelt"},
            {"sport": "girls_basketball", "conference": "Cloverbelt"},
            {"sport": "volleyball", "conference": "Cloverbelt"},
        ],
    },
    {
        "id": "columbus-catholic",
        "name": "Columbus Catholic",
        "full_name": "Columbus Catholic High School",
        "mascot": "Dons",
        "city": "Marshfield",
        "colors": ["#1d4ed8", "#fbbf24"],
        "conferences": [
            {"sport": "boys_basketball", "conference": "Cloverbelt"},
            {"sport": "girls_basketball", "conference": "Cloverbelt"},
            {"sport": "volleyball", "conference": "Cloverbelt"},
        ],
    },
    # Northwoods-East 8 football additions.
    {
        "id": "mellen",
        "name": "Mellen",
        "full_name": "Mellen High School",
        "mascot": "Granite Diggers",
        "city": "Mellen",
        "colors": ["#1e3a8a", "#fbbf24"],
        "conferences": [
            {"sport": "football", "conference": "Northwoods-East 8"},
        ],
    },
    {
        "id": "washburn",
        "name": "Washburn",
        "full_name": "Washburn High School",
        "mascot": "Castle Guards",
        "city": "Washburn",
        "colors": ["#000000", "#fbbf24"],
        "conferences": [
            {"sport": "football", "conference": "Northwoods-East 8"},
        ],
    },
    {
        "id": "shell-lake",
        "name": "Shell Lake",
        "full_name": "Shell Lake High School",
        "mascot": "Lakers",
        "city": "Shell Lake",
        "colors": ["#1d4ed8", "#fbbf24"],
        "conferences": [
            {"sport": "football", "conference": "Northwoods-East 8"},
        ],
    },
    {
        "id": "south-shore",
        "name": "South Shore",
        "full_name": "South Shore High School",
        "mascot": "Cardinals",
        "city": "Port Wing",
        "colors": ["#dc2626", "#000000"],
        "conferences": [
            {"sport": "football", "conference": "Northwoods-East 8"},
        ],
    },
]


def _has_membership(school: dict, sport: str, conference: str) -> bool:
    return any(
        c["sport"] == sport and c["conference"] == conference
        for c in school.get("conferences", [])
    )


def main() -> int:
    data = json.loads(MANIFEST_PATH.read_text())
    by_id = {s["id"]: s for s in data["schools"]}

    added_memberships = 0
    for sid, sport, conf in NEW_MEMBERSHIPS:
        school = by_id.get(sid)
        if school is None:
            print(f"  ! unknown school id: {sid}")
            continue
        if _has_membership(school, sport, conf):
            continue
        school.setdefault("conferences", []).append(
            {"sport": sport, "conference": conf}
        )
        added_memberships += 1
        print(f"  + {sid} -> {sport} / {conf}")

    added_schools = 0
    existing_ids = {s["id"] for s in data["schools"]}
    for new in NEW_SCHOOLS:
        if new["id"] in existing_ids:
            print(f"  · {new['id']} already in manifest — skipping")
            continue
        # Stub fields that the regular scraper expects.
        new.setdefault("wiaa_org_id", None)
        new.setdefault("bound_slug", None)
        new.setdefault("athletics_url", None)
        data["schools"].append(new)
        added_schools += 1
        print(f"  + new school: {new['id']} ({new['name']})")

    MANIFEST_PATH.write_text(json.dumps(data, indent=2) + "\n")
    print(
        f"\nDone. {added_memberships} new memberships, {added_schools} new schools. "
        f"Manifest now has {len(data['schools'])} schools."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
