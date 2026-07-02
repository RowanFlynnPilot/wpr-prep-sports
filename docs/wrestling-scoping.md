# Wrestling scoping — winter 2026-27

Researched 2026-07-02. Wrestling is the next sport up (winter 2026-27) and
breaks two assumptions at once: it's an **individual sport**, and the **WIAA
schedule backbone is empty for it** — coaches manage wrestling in
Trackwrestling (WIAA-mandated), not the WIAA directory.

## TL;DR / recommendation

Minimum lovable version = tournament-series coverage (sectionals → state:
brackets, qualifier lists, placements) + dual results + individual season
records, all sourced primarily from **Trackwrestling**. The gating unknown is
a ~1-day Trackwrestling scraping spike — do that before committing to the
winter timeline. Girls wrestling debuts its first-ever Team State Tournament
in 2027, which is a ready-made editorial + founding-sponsor story.

## WIAA structure (2025-26 rules, carrying into 2026-27)

- **Dual meets** (14 bouts, one per weight class; NFHS team scoring: fall 6,
  TF 5, MD 4, dec 3 — point values assumed NFHS, not independently verified)
  plus **invitationals** (most of the season's volume; individual placements
  + aggregate team scores) plus **conference tournaments** (Marawood, WVC —
  the WVC runs its tournament on Trackwrestling).
- **Tournament series restructured 2025-26**: individual regionals were
  ELIMINATED; sectionals (21 sites) are the only qualifier → 588 individual
  state qualifiers. Individual State at the Kohl Center; boys in 3 divisions
  × 14 weights, girls in ONE statewide division × 12 weights.
- **Team State** moved to the La Crosse Center (March 2026), 8 qualifying
  teams per division.
- **Weight classes**: boys 106-285 (14); girls 100-235 (12).
- **Girls wrestling milestone**: 2025-26 was the last season girls counted
  toward boys team competition; **2026-27 debuts the first Girls Team State
  Tournament (dual format, 2027)**.
- Regs: [boys](https://www.wiaawi.org/Portals/0/PDF/Publications/Winter_Sport_Regs/wrestlingregs.pdf) ·
  [girls](https://www.wiaawi.org/Portals/0/PDF/Publications/Winter_Sport_Regs/girlsWRtournprod.pdf)

## Source assessment (verified 2026-07-02)

| Source | Verdict | Notes |
|---|---|---|
| **WIAA directory** (schools.wiaawi.org) | ~Useless for regular season | Completed 2025-26 wrestling schedules show 0-1 rows at Stratford/Wausau West/Mosinee/Marshfield (vs 25-28 for basketball). Only WIAA-seeded tournament-series duals appear. SSIDs exist and mint TeamIDs (2026-27: boys 1546 / girls 1560). |
| **Trackwrestling** | **Authoritative — needs a spike** | WIAA mandates it (weigh-ins + results within 72h of every match). [WIAAIndSeries.jsp?year=2025](https://www.trackwrestling.com/predefinedtournaments/WIAAIndSeries.jsp?year=2025) lists every regional/sectional/state event with tournamentIds; public viewers pass the password gateway without a password. Legacy JSP frames app (WINDOWS-1252, stateful twSessionId, MethodCaller.jsp AJAX) — httpx+bs4 viable, no headless browser needed, but season/team extraction needs reverse-engineering. FloSports owns it; watch for migration to FloArena in fall 2026. |
| **Bound** | Sparse, not viable as primary | Full wrestling section exists but ~180 events statewide for 2025-26; a mid-January Thursday had 2 events statewide, neither central-WI. |
| **MaxPreps** | Near-empty | Stratford (a D3 power) has a team record and nothing else. WSN migration may improve it — don't bet on it. |
| **FloWrestling** | Editorial reference only | Brackets/results articles; data is Trackwrestling's; video paywalled. |
| **WIwrestle / Wisconsin Grappler** | Editorial reference | Rankings/previews — seeding context for power-rankings-style content, not structured data. |

## Modeling implications

Fits the existing model: dual meets → `Game` (home/away/team score/conference
flag); dual conference standings → `Standing`; the 14-bout card → the
`boxscores/<game_id>.json` split-file pattern.

Doesn't fit: invitationals (N teams, placements, no home/away), individual
W-L records by weight class, brackets, season-long individual narratives.

Proposed additions (`data/wrestling_boys/`, `data/wrestling_girls/`):

- `Game.type: "dual" | "invite" | "tournament_series"`; invitationals become
  an `Event` record `{id, name, date, venue, teams: [{school_id, place,
  points}]}` rendered as a "meet card" ticker variant.
- `boxscores/<dual_id>.json`: `bouts: [{weight, wrestlers, winner,
  result_type (fall|tf|md|dec|forfeit), score_or_time, team_points}]`.
- `players/<school_id>.json`: athlete season records — `{name, grade,
  weight_class(es), record, pins, tech_falls, major_decisions,
  tournament_placements, state_qualifier, state_placement}`.
- **Co-ops are common** (verified: Spencer/Columbus Catholic(/Granton)).
  The Central Wisconsin Storm precedent applies — model co-ops as their own
  tracked teams. Budget a manifest co-op audit.

### Minimum lovable version

1. Schedules + dual results (team scores) — Trackwrestling + WIAA
   tournament-series duals.
2. Individual season records per school (W-L, pins).
3. Tournament series: sectional brackets, **state-qualifier list, state
   placements** — the highest-emotion content; verified reachable on
   Trackwrestling predefined tournaments.
4. Conference dual standings.

Defer: full invitational placement history, per-bout dual cards,
head-to-head, deep girls co-op untangling.

## Sponsor angles

- **Weight-class sponsor** — 14 boys + 12 girls discrete slots ("The 285s,
  presented by ___"); the most granular inventory of any sport.
- **Pin of the Week** — direct PotW-pattern reuse.
- **State Qualifier tracker** — February burst traffic.
- **Girls wrestling founding sponsor** — first girls Team State (2027) is a
  one-time story that fits WPR's community positioning.
- Fit: chiropractors, sports medicine/PT, supper clubs.

## Open flags

- Trackwrestling season/team extraction unverified (the spike).
- Exact WIAA dual point values (assumed NFHS).
- Girls sectional team scoring for 2026-27 (none in 2025-26 per regs).
- 2026-27 sectional assignments (WIAA publishes in fall).
- FloSports keeping predefined-tournament pages public through 2027.
- **Cross-cutting discovery: WIAA SSIDs rotate per season** (football
  1499→1533 for 2026-27; wrestling 1511→1546 / 1524→1560). The scraper's
  hardcoded SSID map must be refreshed or made dynamic each season — this
  affects ALL sports, not just wrestling. `GetDirectorySchool` accepts
  `SchoolYear=2025` for past seasons (useful for archives).
