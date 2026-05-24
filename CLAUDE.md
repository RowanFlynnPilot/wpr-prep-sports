# wpr-prep-sports — Central Wisconsin High School Sports Hub

Persistent project context for Claude Code. Read this first.

## What this is

An embeddable widget for **Wausau Pilot & Review** (WPR) covering central Wisconsin
high school sports: schedules, scores, standings, and (eventually) stats for ~14
schools across three conferences. Embedded into the WPR WordPress site via iframe
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

- **Scraper** (`scraper/`): Python. Pulls from Bound (primary) and WIAA
  ScoreCenter (fallback/verification). Writes normalized JSON to `data/`.
- **GitHub Actions** (`.github/workflows/`): Two workflows — `scrape.yml` runs
  the scraper on cron and commits updated JSON; `deploy.yml` builds the
  frontend and deploys to GitHub Pages.
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

## Coverage scope (v1)

~14 schools across three conferences. Wisconsin schools often belong to
*different* conferences for *different* sports (e.g. football vs. everything
else), so model conference membership per-sport, not globally.

**Wisconsin Valley Conference** (Marathon County + regional rivals):
- Wausau East (Lumberjacks)
- Wausau West (Warriors)
- D.C. Everest (Evergreens)
- Marshfield (Tigers)
- Stevens Point Area (Panthers / SPASH)
- Wisconsin Rapids Lincoln (Red Raiders)

**Marawood Conference** (small schools in/near Marathon County):
- Athens (Bluejays)
- Edgar (Wildcats)
- Marathon (Raiders)
- Newman Catholic (Cardinals)
- Stratford (Tigers)
- Spencer (Rockets)

**Great Northern / Cloverbelt overlap:**
- Mosinee (Indians)
- Colby (Hornets)
- Abbotsford (Falcons)

Note: WVC football schools actually play in the **Valley Football
Association (VFA)**, not WVC, for football only. Handle this in the data
model.

See `docs/coverage.md` for the full list with conference-by-sport mappings.

## Sport phasing

Build in this order — highest engagement and ad value first:

1. **Football** (fall) — single biggest weekly event; start here for v1
2. **Boys & girls basketball** (winter) — long season, sustained traffic
3. **Volleyball** (fall) — fast-growing audience
4. **Wrestling, hockey** (winter) — central WI strongholds
5. **Baseball, softball, track** (spring)
6. Niche sports (XC, soccer, swimming, golf, tennis) as bandwidth allows

## v1 feature set

Keep tight, ship it:

- **Live/recent scores ticker** — last 7 days + tonight
- **This week's schedule grid** — by sport
- **Full season schedule per school** — clickable into school page
- **Conference standings** — per conference, per sport
- **Per-team page** — roster (if available), schedule, results

## v2+ features (build sponsorship hooks)

- **Pick'em game** — weekly winner predictions; obvious sponsor inventory
- **Power rankings** — algorithmic ranking across conferences; original content
- **Player of the Week** — community-voted, photo + writeup
- **Rivalry / historical archive** — all-time records, state tournament history
- **Senior Spotlights** — weekly senior profile
- **Live game threads** — Friday Night Lights live score updates

## Data schema (target)

Canonical JSON written to `data/`:

- `data/schools.json` — list of schools with metadata (name, mascot, colors, city, conferences-per-sport)
- `data/games.json` — all games for current season(s), with home/away/score/status/sport/date
- `data/standings.json` — current conference standings per sport
- `data/meta.json` — last scrape timestamp, source freshness, season info

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
pip install -r requirements.txt
python main.py --sport football --season 2025-26

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
