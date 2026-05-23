"""
One-shot: replace the shared "#475569" slate-gray placeholder color on
17 manifest schools with deterministic per-school colors so each school
reads visually distinct in standings and team pages.

NOT a substitute for hand-curated real school colors — but better than
17 schools all wearing the same gray. Replace these via real manifest
edits as WPR collects actual color references.

Picks the primary color from a small palette of WI-themed sports
hues (navy, forest, burgundy, etc.) using a deterministic hash so the
same school always gets the same color across runs. Pairs each with
a complementary secondary.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.loader import load_manifest, save_manifest  # noqa: E402

PLACEHOLDER_COLOR = "#475569"

# Curated palette — each entry is (primary, secondary). Picked to feel
# varsity-appropriate: muted-but-saturated team-jersey hues, no neons.
PALETTE: list[tuple[str, str]] = [
    ("#1E3A8A", "#FBBF24"),  # navy + gold
    ("#7F1D1D", "#FBBF24"),  # maroon + gold
    ("#14532D", "#FBBF24"),  # forest + gold
    ("#5B21B6", "#FFFFFF"),  # royal purple + white
    ("#9A3412", "#FBBF24"),  # burnt orange + gold
    ("#0F766E", "#FFFFFF"),  # teal + white
    ("#374151", "#DC2626"),  # charcoal + red
    ("#1F2937", "#FBBF24"),  # near-black + gold
    ("#312E81", "#FFFFFF"),  # indigo + white
    ("#365314", "#FFFFFF"),  # olive + white
    ("#831843", "#FBBF24"),  # wine + gold
    ("#155E75", "#FBBF24"),  # ocean blue + gold
    ("#7C2D12", "#FFFFFF"),  # rust + white
    ("#581C87", "#FBBF24"),  # deep purple + gold
    ("#064E3B", "#FFFFFF"),  # dark emerald + white
    ("#9F1239", "#FFFFFF"),  # crimson + white
]


def color_for(school_id: str) -> tuple[str, str]:
    """Deterministic palette pick from the school id."""
    h = hashlib.sha1(school_id.encode("utf-8")).digest()
    idx = h[0] % len(PALETTE)
    return PALETTE[idx]


def main() -> int:
    manifest = load_manifest()
    changed = 0
    for s in manifest.schools:
        if not s.colors or s.colors[0] != PLACEHOLDER_COLOR:
            continue
        primary, secondary = color_for(s.id)
        s.colors = [primary, secondary]
        changed += 1
        print(f"  {s.id:24} -> primary={primary} secondary={secondary}")
    if changed == 0:
        print("No placeholder slate-gray schools left; nothing to do.")
        return 0
    save_manifest(manifest)
    print(f"Wrote manifest with diversified colors on {changed} school(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
