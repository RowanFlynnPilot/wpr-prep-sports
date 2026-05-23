# Data sources

Documenting every source we pull from and how it behaves. Update as you
discover new URL patterns, rate limits, or quirks.

## 1. Bound — `gobound.com` (primary)

Wisconsin-specific HS sports aggregator. Wide coverage of all WIAA conferences
and sports.

**Observed URL patterns:**
- All-state scores by sport and season:
  `https://www.gobound.com/wi/wiaa/{sport_abbr}/{season}/scores`
  Example: `https://www.gobound.com/wi/wiaa/fb/2025-26/scores`
- Conference index: `https://www.gobound.com/wi/conferences`
- Per-conference home pages: under `/wi/conferences/{slug}`

**Sport abbreviations seen / to verify:**
| Sport | Abbr (confirmed?) |
|---|---|
| Football | `fb` ✅ |
| Volleyball | `vb` (verify) |
| Boys basketball | `bb` (verify) |
| Girls basketball | `gb` (verify) |
| Baseball | ? |
| Softball | ? |
| Boys soccer | ? |
| Girls soccer | ? |
| Wrestling | ? |
| Hockey | ? |

**Notes:**
- Server-rendered HTML; `requests` + `beautifulsoup4` should be sufficient.
- Be polite — single requests per page, descriptive User-Agent.
- Pages group games by date; each row has date, time, away, home, score, conference.
- No known public API; HTML scrape only.

## 2. WIAA ScoreCenter — `schools.wiaawi.org/ScoreCenter` (verification / fallback)

The official authoritative source. Used to verify Bound's numbers and as a
fallback when Bound is unavailable.

**Known URLs:**
- Football scoreboard: `https://schools.wiaawi.org/ScoreCenter/Results/FBScoreboard`
- Football database: `https://www.wiaawi.org/Scorecenter/Football-Database`
- WIAA Scores landing: `https://www.wiaawi.org/Scores`
- Live in-game reporting tool used by schools: `http://halftime.wiaawi.org`

**Notes:**
- Classic ASP.NET-style server-rendered pages.
- Has "(C)" markers on conference games — useful signal for conference vs. non-conference.
- Discover scoreboard URLs for other sports by navigating from the WIAA
  ScoreCenter landing.

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

## 5. WisSports.net (`wissports.net`)

Independent WI HS sports site. Strong on rankings and rosters for football and
basketball especially. Manual reference for now; evaluate scraping if rankings
become a feature.

## 6. MaxPreps (`maxpreps.com`)

National HS sports aggregator with Wisconsin coverage. May have stricter rate
limits or terms restrictions — evaluate carefully before scraping.

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
