# wpr-prep-sports — Central Wisconsin High School Sports Hub

Persistent project context for Claude Code. Read this first.

## What this is

An embeddable widget for **Wausau Pilot & Review** (WPR) covering central Wisconsin
high school sports: schedules, scores, standings, and player stats. Launched May
2026; as of mid-2026 it tracks **67 schools** and **8 live sports** (football,
boys/girls basketball, volleyball, boys/girls hockey, boys/girls soccer) across
7+ conferences modeled per-sport. Embedded into the WPR WordPress site via iframe
from GitHub Pages.

This is part of WPR's broader widget suite alongside `wpr-woodchucks-widget`,
`wpr-gas-prices`, `wpr-election-results`, `wpr-river-conditions`,
`wpr-adopt-widget`, and `marathon-meetings`. Follow the same architectural
conventions used in those repos.

## Architecture

Standard WPR widget pattern:

```
Python scraper → GitHub Actions cron → GitHub Pages static JSON → React/Vite frontend → WordPress iframe embed
```

- **Scraper** (`scraper/`): Python. WIAA is the schedule/score backbone;
  Bound, MaxPreps, and Wisconsin Prep Hockey layer in player stats;
  Halftime supplies live scores. Writes normalized JSON to `data/`.
- **GitHub Actions** (`.github/workflows/`): Six workflows — `scrape.yml`
  (full scrape, season-aware cron), `scrape-live.yml` (10-min live-score
  merge during game windows, safe year-round), `deploy.yml` (builds the
  frontend and deploys to GitHub Pages), `digest.yml` (Saturday newsletter
  export), `sentinel.yml` (daily freshness watchdog), and `tests.yml`
  (scraper pytest on push/PR). A data-validation gate
  (`scraper/scripts/validate_data.py`) runs before every commit and
  includes a coverage-regression check vs git HEAD. **Failures open a
  GitHub issue labeled `ops-alert`** (create-only dedupe while one is
  open). Ops map + incident runbook: `docs/operations.md`.
- **Frontend** (`frontend/`): React + Vite. Fetches the static JSON at runtime.
  Builds to `frontend/dist/`, deployed to GitHub Pages.
- **Embed**: WordPress `<iframe>` pointing at the GitHub Pages URL.

## Data sources

**Primary: WIAA (schools.wiaawi.org)** — official source, server-rendered
ASP.NET data grids. Endpoints in use:
- `Directory/School/SearchOrg?query=...&levelT=0&classT=0&memberT=20` — search → OrganizationID
- `Directory/School/GetDirectorySchool?OrgID=X&showPub=False` (POST) — school profile, lists per-sport TeamIDs
- `Directory/Schedule/Index?TeamID=X` — full-season schedule + results for one team
- `ScoreCenter/Results/FBScoreboard` — statewide football scoreboard (cross-check)

TeamIDs are minted per-season — re-discover at the start of every scrape
from cached OrganizationIDs. See [docs/data-sources.md](docs/data-sources.md)
for full endpoint and SSID details.

**Active stats sources (post-launch evolution):**
- **Bound (`gobound.com`)** — per-game stat leaders + per-team season
  totals for football, boys/girls basketball. Solid central-WI coverage
  for those three sports. Effectively no coverage for volleyball
  (2/1491 games in 2025-26).
- **Wisconsin Prep Hockey (`wisconsinprephockey.net`)** — per-game stats
  + scoring summaries + rosters for boys hockey. Girls hockey deferred
  (co-op modeling problem — see `memory/hockey_stats_gap.md`).
- **MaxPreps (`maxpreps.com`)** — per-game stat leaders for volleyball
  where Bound has nothing. Inheriting WI coverage as WisSports.net
  sunsets (per WSN article 1344219). Discovery via
  `scraper/scripts/discover_maxpreps_slugs.py`. Season totals
  aggregated locally from per-game lines (MP's season-leader UI goes
  empty off-season).
- **Halftime Score Center (`halftime.wiaawi.org`)** — live scores during
  games. Wired in via the Friday Night Live cron.

**Per-school athletics sites** (last-resort fallback for stats and rosters):
- Wausau East, Wausau West, D.C. Everest: rSchoolToday
- Marawood/Cloverbelt smaller schools: varies (often Schedule Star / individual sites)

**WisSports.net** — winding down. PlayOn acquired MaxPreps; WSN content
is transferring to MaxPreps WI starting current school year. Don't
build new integrations against WSN.

See `docs/data-sources.md` for detailed URL patterns and notes as they're
discovered.

## Coverage scope

**67 schools, 8 live sports** (football, boys/girls basketball, volleyball,
boys/girls hockey, boys/girls soccer). The original v1 footprint was the
Wisconsin Valley + Marawood cores (Wausau East/West, D.C. Everest,
Marshfield, SPASH, Wisconsin Rapids; Athens, Edgar, Marathon, Newman
Catholic, Stratford, Spencer; plus Mosinee, Colby, Abbotsford) — coverage
grew to complete every tracked conference's standings.

Wisconsin schools often belong to *different* conferences for *different*
sports, so conference membership is modeled per-sport, not globally
(`conferences: [(sport, conference)]` in the school manifest). Notable co-op:
the **Central Wisconsin Storm** (girls hockey) is modeled as its own team.

See `docs/coverage.md` for the current conference-by-sport map and sport
status table.

## Sport status

Live: football, boys/girls basketball, volleyball (full stats); boys/girls
hockey (stats via Wisconsin Prep Hockey); boys/girls soccer
(scores/schedules/standings only). Next up: **wrestling** (winter 2026-27,
needs individual-sport modeling), then baseball/softball/track (spring).

## Feature set (shipped)

- Live/recent scores ticker + This Week grid + month calendar
- Conference standings per sport, team pages, game pages with box scores,
  player profile pages
- Player of the Week (editor override via `data/potw.json`), Game of the
  Week marquee, Power Rankings, Pick'em (browser-local), playoff bracket,
  School Spirit photo galleries, OG share cards, off-season countdown hero
- Sponsor system: `data/sponsors.json` slots + `#/sponsor` media-kit page
  (see `docs/advertiser-inventory.md`)

## Backlog (sponsor-driven, rough priority)

- **Pick'em submission endpoint** — leaderboard + social proof (currently
  localStorage-only)
- **Per-school embed mode** (`?school=x&compact=1`) — per-school sponsor sell
- **Senior Spotlights** — `data/spotlights.json` mirroring the PotW pattern
- **Weekly digest export** — Friday roundup for the WPR newsletter
- **Rivalry / historical archive** — 2025-26 season archived under
  `data/archive/`
- **Division filters + bracket challenge** — `wiaa_division` data landed
  2026-07 (90% of school-sport pairs, via `scripts/backfill_divisions.py`;
  re-run each season once brackets post); frontend features still to build

## Data schema

Canonical JSON written to `data/` (split per-sport layout since June 2026):

- `data/schools.json` — cross-sport school metadata (name, mascot, colors, city, conferences-per-sport)
- `data/<sport>/meta.json` — last scrape timestamp, sources used, season
- `data/<sport>/games.json` — slim games (headline stats only; full stat lines split out)
- `data/<sport>/boxscores/<game_id>.json` — per-game stat leaders, fetched on demand
- `data/<sport>/players/<school_id>.json` — per-school player lines, fetched on demand
- `data/<sport>/standings.json`, `season_stats.json`, `power_rankings.json`
- `data/{sponsors,potw,spirit}.json` — cross-sport editorial/sponsor config
- `data/archive/<season>/` — archived seasons (excluded from Pages deploy)

See `docs/schema.md` for full field definitions. Frontend reads these files
directly via `fetch()` against the GitHub Pages domain.

## Repo conventions

- Use `uv` or plain `pip` for Python deps; pin in `scraper/requirements.txt`
- Use `pnpm` if available, otherwise `npm` for frontend
- Format Python with `ruff format` (line length 100)
- Format JS/JSX with Prettier defaults
- Commit messages: conventional commits style (`feat:`, `fix:`, `chore:`, `data:`)
- Scraper writes to `data/` and that's committed by the GH Action — don't gitignore it
- Use `CLAUDE.md` updates whenever architecture or scope shifts

## Local dev commands

```bash
# Scraper
cd scraper
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt -r requirements-dev.txt
python main.py --sport football --season 2026-27
python -m pytest tests -q          # unit + saved-fixture parser tests (no network)
python scripts/validate_data.py    # data gate incl. coverage regression vs HEAD

# Frontend
cd frontend
npm install
npm run dev          # local dev server
npm run build        # production build → dist/
npm run preview      # preview production build locally
```

## GitHub Actions

- `scrape.yml` — cron-scheduled (every 15 min during games, hourly otherwise);
  runs `scraper/main.py`, commits updated JSON in `data/`
- `deploy.yml` — on push to `main` or after successful scrape, builds frontend
  and deploys `frontend/dist/` to GitHub Pages

Configure GH Pages source as **GitHub Actions** (not branch-based) so the
deploy workflow can publish directly.

## WordPress embed

Once deployed, embed in WPR with:

```html
<iframe src="https://rowanflynnpilot.github.io/wpr-prep-sports/"
        width="100%" height="800" frameborder="0" loading="lazy"></iframe>
```

Frontend must be responsive and resize-friendly inside an iframe — use
`postMessage` height reporting if needed (see `wpr-woodchucks-widget` for
prior art).

## Why this project exists (for context when making product calls)

WPR is a nonprofit local news org and depends on advertising revenue. This
widget exists to:

1. Drive sustained repeat engagement from parents, grandparents, and alums
2. Give WPR a defensible content moat — nothing else covers central WI HS
   sports comprehensively
3. Generate sellable sponsorship inventory (per-team sponsors, Player of the
   Week presented-by, scoreboard sponsor, etc.)

When design or scope decisions are ambiguous, prefer the option that:
- Increases repeat visits and dwell time
- Creates more discrete sponsorable surfaces
- Strengthens central-WI specificity vs. generic national content

See `docs/advertiser-inventory.md` for the full sponsor inventory plan.
