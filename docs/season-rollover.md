# Season rollover runbook

> **2026-27 status (updated 2026-07-02):** football rolled over and live;
> the 2025-26 archive is complete (all 8 sports); the scrape cron is ON
> with a season-aware cadence; volleyball + boys soccer are in the cron
> and will roll automatically when WIAA posts their schedules. The July/
> August manual steps below are DONE for 2026-27 — what remains is the
> per-season checklist at the bottom and adding winter/spring sports to
> the cron sport list as their seasons approach.

## What's automatic (verified July 2026)

- **WIAA TeamIDs** are re-discovered on every scrape from cached
  OrganizationIDs (`main.py` → `discover_team_id_for_sport`). TeamIDs
  are minted per-season; OrganizationIDs are stable.
- **WIAA SSIDs also rotate per season** (discovered 2026-07: Boys
  Football 1499 → 1533). The current map is discovered at runtime from
  the SchoolSSID dropdown on any directory page (covers live scores
  too), with the sport's display label — stable across seasons — as a
  final fallback. No per-season map update needed; the hardcoded
  `SSID_BY_SPORT` fallback can be refreshed opportunistically.
- **Wipe guard** (`main.py`): a scrape that finds 0 games never
  replaces a dataset that has games. The cron can therefore carry a
  sport with `--season <new>` BEFORE WIAA posts its schedule; it no-ops
  until publish day, then rolls the sport over on its own.
- **Season-aware cron** (`scrape.yml`): hourly + Friday 15-min windows
  Jan-May/Aug-Dec, daily during June-July. No more pause/unpause.
- **MaxPreps slugs** are school-level and stable across seasons; the
  schedule parser filters `all-time` pages by season year. Only newly
  added schools need `scripts/discover_maxpreps_slugs.py`.
- **Off-season widget mode** — countdown hero >14 days after the last
  game; preseason (schedule posted, nothing played) anchors the
  dashboard to the opening week automatically.

## Each summer (manual, ~30 min)

1. **Archive the finished season** (box scores can't be re-scraped
   later — archive before anything overwrites):
   ```bash
   cd scraper
   .venv/Scripts/python.exe scripts/rollover_season.py --season <old>
   .venv/Scripts/python.exe scripts/build_history.py   # refresh head-to-head files
   ```
   (`--sport a b c` limits the run — useful for late-added sports.)
2. **Check school conference changes** in `scraper/config/schools.json`
   BEFORE the first new-season scrape so standings group correctly.
3. **Bump `scrape.yml` season default** to the new season id.
4. **Refresh `nextSeasonStart` dates** in
   `frontend/src/config/sports.js` once WIAA publishes calendars.
5. **Re-run `scripts/backfill_divisions.py`** once fall brackets post
   (October) — divisions are enrollment-based and re-cut yearly.

## Per-season sport-list maintenance

The cron's sport list (`scrape.yml` SPORTS default) should hold the
in-season + about-to-start sports: fall = football, volleyball,
boys_soccer; add boys/girls basketball + hockey in November; swap to
girls_soccer/baseball/softball in March. (Sports left in the list
off-season just burn scrape minutes; sports missing from it go stale.)

- **WPH subseason IDs** (hockey stats) are hardcoded per season in
  `sources/wph.py` (`SUBSEASONS` / `SUBSEASONS_EXTRA`) — update before
  the first hockey scrape of a new season.

## Before each season's first game

- Eyeball the dashboard: schedules render, standings show 0-0 rows,
  the hero framing looks right.
- Check `data/<sport>/meta.json` season field.
- Confirm the WPR iframe still sizes correctly.

## Notes

- `season_stats.json`, `power_rankings.json` start empty/sparse in a
  new season — the frontend renders fine without them (all optional).
- Schools changing conferences for 2026-27: update
  `scraper/config/schools.json` (the manifest source of truth) BEFORE
  the first scrape so standings group correctly.
- Next summer, set `nextSeasonStart` (2027-28) dates in
  `frontend/src/config/sports.js` when WIAA publishes them.
