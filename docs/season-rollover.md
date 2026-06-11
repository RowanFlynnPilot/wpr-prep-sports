# Season rollover runbook (2025-26 → 2026-27)

What has to happen between the spring wrap-up and the Fall 2026
football opener, in order. Most of the machinery is already automatic —
this is the short list of manual switches.

## What's already automatic (verified June 2026)

- **WIAA TeamIDs** are re-discovered on every scrape from cached
  OrganizationIDs (`main.py` → `discover_team_id_for_sport`). TeamIDs
  are minted per-season; OrganizationIDs are stable. Scraping with
  `--season 2026-27` picks up the new season's teams with no manual
  step.
- **MaxPreps slugs** are school-level and stable across seasons; the
  schedule parser filters `all-time` pages by season year. Only newly
  added schools need `scripts/discover_maxpreps_slugs.py`.
- **Off-season widget mode** — the dashboard detects >14 days since the
  last game and swaps to the countdown hero. Per-sport
  `nextSeasonStart` dates live in `frontend/src/config/sports.js`
  (already filled for 2026-27; refresh them each summer once WIAA
  publishes calendars).

## July 2026 (when WIAA posts 2026-27 football schedules)

1. **Archive last season** (one command, then commit):
   ```bash
   cd scraper
   .venv/Scripts/python.exe scripts/rollover_season.py --season 2025-26
   ```
   Copies every sport's games/boxscores/players/standings/season-stats/
   rankings into `data/archive/2025-26/`. Box scores can't be
   re-scraped later — archive before anything overwrites.

2. **First 2026-27 scrape** (football only at first):
   ```bash
   .venv/Scripts/python.exe main.py --sport football --season 2026-27
   ```
   Sanity-check schedules against a couple of school sites, run
   `scripts/validate_data.py`, commit.

## August 2026 (preseason)

3. **Re-enable the Scrape cron** — uncomment the `schedule:` block in
   `.github/workflows/scrape.yml` (left commented for the off-season)
   and update the default `season` input to `2026-27`.
4. **Update workflow season defaults** — `scrape.yml` workflow_dispatch
   `season` default, and any sport list defaults if coverage changed.
5. **Scrape Live** needs no change — it runs year-round and no-ops with
   no live games.

## Before first kickoff (Aug 21, 2026)

6. Run all fall sports once (`football`, `volleyball`) and eyeball the
   dashboard: schedules render, off-season hero is gone for football,
   standings show 0-0 rows.
7. Check `data/<sport>/meta.json` season fields all read `2026-27`.
8. Confirm the WPR iframe still sizes correctly with in-season content.

## Notes

- `season_stats.json`, `power_rankings.json` start empty/sparse in a
  new season — the frontend renders fine without them (all optional).
- Schools changing conferences for 2026-27: update
  `scraper/config/schools.json` (the manifest source of truth) BEFORE
  the first scrape so standings group correctly.
- Next summer, set `nextSeasonStart` (2027-28) dates in
  `frontend/src/config/sports.js` when WIAA publishes them.
