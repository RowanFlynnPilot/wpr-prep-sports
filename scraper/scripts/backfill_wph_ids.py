"""
One-shot: add wph_team_id to manifest schools for boys-hockey programs.

IDs harvested from the conference-page discovery (scripts/discover_wph_teams.py).
Each id is a WisconsinPrepHockey.net /page/show/<id> page that lives at the
team's root and exposes a team_instance_id sub-link per season.

Girls hockey deferred: those programs are co-op'd into entities like
"wisc-valley", "icebergs", etc. that don't map 1:1 to our manifest
schools. Revisit once we have a clearer co-op model.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

MANIFEST_PATH = Path(__file__).resolve().parent.parent / "config" / "schools.json"
DATA_SCHOOLS_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "schools.json"

# our-manifest-slug → wisconsinprephockey.net page ID
BOYS_HOCKEY_PAGE_IDS: dict[str, int] = {
    # Big Rivers
    "chippewa-falls": 9183987,
    "eau-claire-memorial": 9183990,
    "eau-claire-north": 9183991,
    "hudson": 9183992,
    "menomonie": 9183993,
    "new-richmond": 9183994,
    "rice-lake": 9183995,
    "river-falls": 9183996,
    # Wisconsin Valley
    "dc-everest": 9184048,
    "marshfield": 9184049,
    "merrill": 9184050,
    "spash": 9184051,
    "wausau-west": 9184052,
    "wisconsin-rapids": 9184053,
    # Great Northern
    "antigo": 9184022,
    "lakeland": 9184024,
    "medford": 9184025,
    "mosinee": 9184026,
    "rhinelander": 9184028,
    "tomahawk": 9184029,
    # Independent / co-op
    "superior": 9184056,
    "pacelli": 9184058,  # stevens-point-pacelli co-op
    "chequamegon": 9184055,  # chequamegon-phillips-butternut co-op
}


def update_json(path: Path, key: str, by_id: dict[str, int]) -> int:
    raw = json.loads(path.read_text(encoding="utf-8"))
    is_listish = isinstance(raw, list)
    schools = raw if is_listish else raw["schools"]
    n = 0
    for s in schools:
        target = by_id.get(s["id"])
        if target is None:
            continue
        if s.get(key) == target:
            continue
        s[key] = target
        n += 1
    payload = raw
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return n


def main() -> int:
    n1 = update_json(MANIFEST_PATH, "wph_team_id", BOYS_HOCKEY_PAGE_IDS)
    print(f"manifest: stamped wph_team_id on {n1} schools")
    n2 = update_json(DATA_SCHOOLS_PATH, "wph_team_id", BOYS_HOCKEY_PAGE_IDS)
    print(f"data/schools.json: stamped wph_team_id on {n2} schools")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
