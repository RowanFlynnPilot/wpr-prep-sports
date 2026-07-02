# Coverage scope

> Updated 2026-07-01. The original v1 scope was ~14 Marathon County schools;
> coverage grew through the 2025-26 season as full conferences were added so
> standings and schedules are complete. This doc reflects what's actually
> tracked — the manifest (`scraper/config/schools.json`) is the source of
> truth; the summaries below are derived from it.

## Current coverage at a glance

- **67 schools** tracked (21 in the core Wisconsin Valley / Marawood footprint,
  the rest added to complete conference standings and co-op coverage)
- **8 sports live**: football, boys/girls basketball, volleyball, boys/girls
  hockey, boys/girls soccer
- Conference membership is modeled **per-sport** (`conferences: [(sport,
  conference)]` in the manifest) — Wisconsin schools routinely play in
  different leagues for different sports

## Conferences tracked per sport

| Sport | Conferences |
|---|---|
| Football | Wisconsin Valley, Big Rivers, Great Northern, Marawood/CWC, CWC-Large, Central Wisconsin-8, Northwoods-East 8 |
| Boys basketball | Wisconsin Valley, Marawood, Great Northern, Cloverbelt |
| Girls basketball | Wisconsin Valley, Marawood, Great Northern, Cloverbelt |
| Volleyball | Wisconsin Valley, Marawood, Great Northern, Cloverbelt |
| Boys hockey | Wisconsin Valley, Big Rivers, Great Northern |
| Girls hockey | Central Wisconsin (Storm co-op conference) |
| Boys soccer | Wisconsin Valley, Big Rivers, Great Northern |
| Girls soccer | Wisconsin Valley, Big Rivers, Great Northern |

Known standing quirks (intentional, matches WIAA's official treatment):
WVC ↔ Big Rivers football crossovers count as conference games for both
sides; Marawood/CWC and CWC-Large share scheduling, so both can show two
unbeaten leaders. See the project memory / commit history before "fixing".

## Core schools (original v1 footprint)

### Wisconsin Valley Conference (large schools)

| School | Mascot | City |
|---|---|---|
| Wausau East | Lumberjacks | Wausau |
| Wausau West | Warriors | Wausau |
| D.C. Everest | Evergreens | Schofield/Weston |
| Marshfield | Tigers | Marshfield |
| Stevens Point Area (SPASH) | Panthers | Stevens Point |
| Wisconsin Rapids Lincoln | Red Raiders | Wisconsin Rapids |

### Marawood Conference (small schools, Marathon County core)

| School | Mascot | City |
|---|---|---|
| Athens | Bluejays | Athens |
| Edgar | Wildcats | Edgar |
| Marathon | Raiders | Marathon City |
| Newman Catholic | Cardinals | Wausau |
| Stratford | Tigers | Stratford |
| Spencer | Rockets | Spencer |

### Great Northern / Cloverbelt (overlap)

| School | Mascot | City | Primary conference |
|---|---|---|---|
| Mosinee | Indians | Mosinee | Great Northern |
| Colby | Hornets | Colby | Cloverbelt |
| Abbotsford | Falcons | Abbotsford | Cloverbelt |

### Notable co-ops

- **Central Wisconsin Storm** (girls hockey) — the D.C. Everest-anchored
  co-op, modeled as its own tracked team with maroon/silver branding and a
  self-hosted logo (`frontend/public/logos/central-wisconsin-storm.svg`).

The remaining ~45 schools were added for conference completeness (full
standings require every member school) and as opponents' schedule anchors.
Roughly a dozen of the late additions still carry placeholder mascots/colors —
refine as WPR supplies reference material.

## Sport status & priority

| Sport | Season | Status |
|---|---|---|
| Football | Fall (Aug–Nov) | **Live** — scores, schedules, standings, stats (Bound + MaxPreps), power rankings |
| Boys basketball | Winter (Nov–Mar) | **Live** — full stack incl. stats |
| Girls basketball | Winter (Nov–Mar) | **Live** — full stack incl. stats |
| Volleyball | Fall (Aug–Oct) | **Live** — full stack; stats via MaxPreps (Bound has ~no VB coverage) |
| Boys hockey | Winter (Nov–Feb) | **Live** — stats via Wisconsin Prep Hockey |
| Girls hockey | Winter (Nov–Feb) | **Live** — Storm co-op + Central Wisconsin conference |
| Boys soccer | Fall | **Live** — scores/schedules/standings only (no player stats yet) |
| Girls soccer | Spring | **Live** — scores/schedules/standings only (no player stats yet) |
| Wrestling | Winter (Nov–Mar) | **Planned for 2026-27** — individual-sport modeling needed (Bound/TrackWrestling) |
| Baseball / Softball / Track | Spring | Backlog |
| XC, swim, golf, tennis | Various | As bandwidth allows |

## Out of scope (for now)

- Middle school sports
- Club sports / lacrosse / rugby
- Athletes' individual recruiting/college commitment info
