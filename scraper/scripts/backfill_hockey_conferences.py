"""
One-shot: add boys_hockey conference memberships to manifest schools
based on conferences inferred from 2025-26 game data.

Coverage (15 schools across 3 conferences):
  Big Rivers       (8): chippewa-falls, eau-claire-memorial, eau-claire-north,
                        hudson, menomonie, new-richmond, rice-lake, river-falls
  Wisconsin Valley (4): dc-everest, spash, wausau-west, wisconsin-rapids
  Great Northern   (3): lakeland, mosinee, tomahawk

Independent boys hockey programs (left without a conference): marshfield,
medford, merrill, antigo, rhinelander, pacelli, chequamegon, superior.
Their team pages still render schedules + records; they just don't
appear in any standings table.

Girls hockey conferences were not added — none of our 8 tracked girls
hockey programs played enough tracked-to-tracked conference games to
let us cluster reliably. Add later if/when data supports it.

Idempotent: rerunning is a no-op once the conferences are in place.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.loader import ConferenceMembership, load_manifest, save_manifest  # noqa: E402

BOYS_HOCKEY_CONFERENCES: dict[str, str] = {
    # Big Rivers
    "chippewa-falls": "Big Rivers",
    "eau-claire-memorial": "Big Rivers",
    "eau-claire-north": "Big Rivers",
    "hudson": "Big Rivers",
    "menomonie": "Big Rivers",
    "new-richmond": "Big Rivers",
    "rice-lake": "Big Rivers",
    "river-falls": "Big Rivers",
    # Wisconsin Valley
    "dc-everest": "Wisconsin Valley",
    "spash": "Wisconsin Valley",
    "wausau-west": "Wisconsin Valley",
    "wisconsin-rapids": "Wisconsin Valley",
    # Great Northern
    "lakeland": "Great Northern",
    "mosinee": "Great Northern",
    "tomahawk": "Great Northern",
}


def main() -> int:
    manifest = load_manifest()
    added = 0
    for school in manifest.schools:
        target = BOYS_HOCKEY_CONFERENCES.get(school.id)
        if target is None:
            continue
        if any(c.sport == "boys_hockey" for c in school.conferences):
            continue
        school.conferences.append(
            ConferenceMembership(sport="boys_hockey", conference=target)
        )
        added += 1
        print(f"  + {school.id} -> {target}")
    if added == 0:
        print("All boys_hockey conferences already present; nothing to do.")
        return 0
    save_manifest(manifest)
    print(f"Wrote manifest with {added} new boys_hockey conference memberships.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
