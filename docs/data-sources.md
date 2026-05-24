# Data sources

Documenting every source we pull from and how it behaves. Update as you
discover new URL patterns, rate limits, or quirks.

## 1. WIAA — `schools.wiaawi.org` (primary)

The official WIAA member-school directory and scoreboard. Server-rendered
ASP.NET data grids — clean to parse. This is our primary source for v1.

**Endpoints we use:**

| Endpoint | Purpose |
|---|---|
| `GET  /Directory/School/SearchOrg?query=<name>&levelT=0&classT=0&memberT=20` | Search schools by name → JSON `[{OrganizationID, OrgName}, ...]`. `memberT=20` is mandatory (omitting it returns an empty stub). |
| `POST /Directory/School/GetDirectorySchool?OrgID=<n>&showPub=False` | School profile page. Lists every team (sport × gender) the school has *for the currently selected school year*. Each team row has `<tr id="<SSID>">` (sport ID) and a link `/Directory/Schedule/Index?TeamID=<n>`. Requires `Content-Length: 0` even though it's a POST with no body. |
| `GET  /Directory/Schedule/Index?TeamID=<n>` | Full-season schedule + results for a single team. Each game row is `<tr class="gridTableRow">` with hidden sort key `<span style="display:none">YYYYMMDD</span>`, date/time labels, home/away anchors (with logo and TeamID), venue label, and result span (`winningTeamText` / `losingTeamText` for finals; absent for scheduled). |
| `GET  /ScoreCenter/Results/FBScoreboard` | Statewide football scoreboard, useful for week-at-a-glance cross-checking. Has `FBWeekSel` filter. |

**Sport SSIDs (from team list rows):**

| SSID | Sport |
|---|---|
| 1499 | Boys Football |
| 1500 | Boys Football 8-Player |
| 1502 | Boys Basketball |
| 1512 | Girls Basketball |
| 1523 | Girls Volleyball |
| 1510 | Boys Volleyball |
| 1506 | Boys Soccer |
| 1518 | Girls Soccer |
| 1511 | Boys Wrestling |
| 1524 | Girls Wrestling |

Discover others by inspecting any school's directory page.

**TeamIDs are per-season.** A new TeamID is minted each year. The scraper
re-discovers them from the OrgID at the start of every scrape cycle, so the
only stable IDs we cache are `OrganizationID`s.

**Notes:**
- Authoritative — when Bound and WIAA disagree, WIAA wins.
- `(C)` marker on a row's date column indicates a conference game (less reliable here than on the all-state scoreboard, but worth checking).
- Logos hosted on the same CDN: `schools.wiaawi.org/Upload/School/Logo/Logo_<uuid>.jpg`. Linkable directly.
- Live in-game reporting tool used by schools: `http://halftime.wiaawi.org` — evaluate for Friday-night live updates in v2.

## 2. Bound — `gobound.com` (deferred — needs JS rendering)

CLAUDE.md originally listed Bound as primary. Inspection on 2026-05-22 showed
the scores page is a jQuery shell that AJAX-loads game data after page render
— the raw HTML has no usable game markup. Unsuitable for `requests + bs4`.

**To revisit Bound we'd need:**
- Playwright (or similar headless browser) — heavy CI dep, slower scrapes
- OR reverse-engineering Bound's internal JSON API (fragile against schema changes)

**What Bound would give us that WIAA doesn't:**
- Conference-membership-per-sport metadata in a structured form (especially
  useful for the VFA West vs. WVC split — see [coverage.md](coverage.md))
- Pre-computed standings

For v1 we derive conference + standings from WIAA results + our hardcoded
conference manifest. Revisit Bound post-launch if the conference metadata
becomes onerous to maintain.

## 3. Wisconsin Valley Conference site — `wisconsinvalleyconference.com`

Conference-specific schedules and meet results.

**Useful for:**
- WVC-specific event results (especially XC invites, swim meets, etc. where
  Bound is sparse)
- Cross-checking conference standings

## 4. Per-school athletics sites (last-resort fallback)

Use only when the above sources don't have what we need (e.g. detailed rosters,
individual stats).

**Platforms in use by central WI schools:**
- rSchoolToday — used by most large public districts
- Schedule Star — used by some smaller schools
- Custom WordPress/static pages — used by some Marawood schools

## 5. WisSports.net (`wissports.net`) — winding down

Historical reference. **As of the 2026-27 school year WSN is migrating its
content to MaxPreps Wisconsin** (see
https://www.wissports.net/news_article/show/1344219 — "Changes coming to
WSN; Getting started with MaxPreps"). Don't invest in a WSN scraper —
prefer MaxPreps below for any new stats integration.

## 6. MaxPreps (`maxpreps.com`) — volleyball stats (active)

National HS sports aggregator now inheriting Wisconsin coverage as WSN
sunsets. Wired in for **volleyball per-game player stats** as of this
session — Bound's central-WI volleyball coverage is effectively zero
(2 games out of 1,491 in the 2025-26 dataset), MaxPreps has full box
scores (Hitting / Serving / Blocking / Digging / Ball Handling / Serve
Receiving) for every team that inputs stats.

Endpoints in use:
- `/wi/<city>/<school-mascot>/volleyball/` — team home (used by slug
  discovery to validate the constructed URL via head `<title>`)
- `/wi/<city>/<school-mascot>/volleyball/schedule/all-time/` —
  server-rendered legacy HTML containing every box-score URL the team
  has on file. Box-score URLs match
  `/games/<M-D-YYYY>/volleyball-<YY>/<away-slug>-vs-<home-slug>.htm?c=<token>`
- `/games/<...>.htm?c=<token>` — per-game box score, server-rendered with
  one `<h3>Team Name (YY-YY)</h3>` followed by six `<h4>` section labels
  and tables. Only teams that input stats appear (single-team coverage
  is the common case).

Discovery: `scraper/scripts/discover_maxpreps_slugs.py` walks every
manifest school playing the sport, tries auto-constructed slug
candidates (city/name-mascot, full-name variants, color-prefix mascot
variants like "red-raiders", city-as-name for SPASH-style cases),
validates by fetching the team home and checking the head `<title>` for
an identity-token substring match. One-shot, idempotent; re-run after
expanding the manifest.

Parser: `scraper/sources/maxpreps.py`. Merge layer:
`scraper/transform/stats.py:merge_maxpreps_stats`.

The current-season `/schedule/` page is JS-rendered (`__NEXT_DATA__`
contests array is empty off-season) — that's why discovery uses the
all-time history page instead.

**Note on `<title>` parsing:** MaxPreps has an SVG `<title>MaxPreps
Logo</title>` earlier in the document than the head `<title>`. Use
BeautifulSoup's `soup.head.title` to pick the right one — a naive regex
grabs the SVG title.

## Scrape etiquette

- Set a descriptive User-Agent (e.g. `wpr-prep-sports/0.1 (+https://wausaupilotandreview.com)`)
- Throttle to ≤ 1 request/second per domain
- Cache raw HTML locally in `scraper/.cache/` during development to avoid
  hammering sources
- Respect any `robots.txt` directives
- Prefer pulling once per cron cycle, then deriving multiple views from the
  same fetch rather than fetching repeatedly

## Schema mapping notes

Team name normalization is the trickiest part. Examples of variants seen for
the same school:
- `D.C. Everest` / `DC Everest` / `D. C. Everest` / `DCE`
- `Wausau East` / `Wausau East HS` / `Wausau East Lumberjacks`
- `SPASH` / `Stevens Point` / `Stevens Point Area`

Maintain an alias map in `docs/schools-seed.json` (to be created) and resolve
all source records against it in `transform/normalize.py`.
