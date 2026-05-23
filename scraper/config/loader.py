"""
Load and persist the school manifest at `scraper/config/schools.json`.

The manifest is the only stable input the scraper needs: a hand-curated list
of the schools we cover, with per-school metadata (slug, name, mascot, city,
colors, conferences-by-sport). WIAA OrganizationIDs are cached here once
discovered; per-season TeamIDs are *not* cached (they change yearly).

Usage:

    from config.loader import load_manifest, save_manifest, ensure_org_ids

    manifest = load_manifest()
    ensure_org_ids(manifest)          # backfills any nulls
    save_manifest(manifest)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sources import wiaa

MANIFEST_PATH = Path(__file__).parent / "schools.json"


@dataclass
class ConferenceMembership:
    sport: str
    conference: str

    def to_dict(self) -> dict[str, Any]:
        return {"sport": self.sport, "conference": self.conference}


@dataclass
class SchoolManifestEntry:
    id: str
    name: str
    full_name: str
    mascot: str
    city: str
    colors: list[str] = field(default_factory=list)
    conferences: list[ConferenceMembership] = field(default_factory=list)
    wiaa_org_id: int | None = None
    bound_slug: str | None = None
    athletics_url: str | None = None

    def conference_for(self, sport: str) -> str | None:
        for m in self.conferences:
            if m.sport == sport:
                return m.conference
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "full_name": self.full_name,
            "mascot": self.mascot,
            "city": self.city,
            "colors": list(self.colors),
            "conferences": [c.to_dict() for c in self.conferences],
            "wiaa_org_id": self.wiaa_org_id,
            "bound_slug": self.bound_slug,
            "athletics_url": self.athletics_url,
        }


@dataclass
class Manifest:
    schools: list[SchoolManifestEntry]

    def by_id(self) -> dict[str, SchoolManifestEntry]:
        return {s.id: s for s in self.schools}


def load_manifest(path: Path = MANIFEST_PATH) -> Manifest:
    with path.open(encoding="utf-8") as f:
        raw = json.load(f)
    schools = [
        SchoolManifestEntry(
            id=s["id"],
            name=s["name"],
            full_name=s["full_name"],
            mascot=s["mascot"],
            city=s["city"],
            colors=list(s.get("colors") or []),
            conferences=[
                ConferenceMembership(sport=c["sport"], conference=c["conference"])
                for c in s.get("conferences") or []
            ],
            wiaa_org_id=s.get("wiaa_org_id"),
            bound_slug=s.get("bound_slug"),
            athletics_url=s.get("athletics_url"),
        )
        for s in raw["schools"]
    ]
    return Manifest(schools=schools)


def save_manifest(manifest: Manifest, path: Path = MANIFEST_PATH) -> None:
    # Preserve the top-level _comment from the existing file if present.
    existing: dict[str, Any] = {}
    if path.exists():
        with path.open(encoding="utf-8") as f:
            existing = json.load(f)
    payload = {
        "_comment": existing.get(
            "_comment",
            "Hand-curated school manifest. Run `python -m scraper.discover` to backfill IDs.",
        ),
        "schools": [s.to_dict() for s in manifest.schools],
    }
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")


def ensure_org_ids(manifest: Manifest, *, console=None) -> list[str]:
    """
    Fill in any null `wiaa_org_id` slots via WIAA's search API.

    Returns the list of school IDs that were just discovered (so the caller
    can decide whether to persist). Schools whose names don't match anything
    in WIAA's directory are skipped with a warning, not an error.
    """
    discovered: list[str] = []
    for school in manifest.schools:
        if school.wiaa_org_id is not None:
            continue
        # Try the display name first; fall back to full_name (WIAA often uses
        # the long form, e.g. "Stevens Point Area Senior High" rather than "SPASH").
        org_id = wiaa.search_org_id(school.name)
        if org_id is None and school.full_name and school.full_name != school.name:
            org_id = wiaa.search_org_id(school.full_name)
        if org_id is None:
            msg = f"  ? {school.id}: no WIAA match for '{school.name}'"
            if console:
                console.print(f"[yellow]{msg}[/yellow]")
            else:
                print(msg)
            continue
        school.wiaa_org_id = org_id
        discovered.append(school.id)
        msg = f"  + {school.id}: OrgID={org_id}"
        if console:
            console.print(f"[green]{msg}[/green]")
        else:
            print(msg)
    return discovered
