# Operations: workflows, alerting, and what to do when it breaks

The whole pipeline is GitHub Actions + GitHub Pages; there are no servers.
This page is the map, the secrets inventory, and the incident runbook the
ops-alert issues link to.

## The six workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `scrape.yml` | Season-aware cron (hourly in-season, Fri 15-min windows, daily Jun–Jul) + dispatch | Full per-sport scrape → validation gate → OG cards → commit `data/` → dispatch Deploy → seed live chain in game windows |
| `scrape-live.yml` | Every 10 min during CT game windows + self-chaining dispatch | Live-score merge only (~60s); no-op off-season. GitHub load-sheds cron at peak times (Fri 8/28/26: 2 of ~42 ticks fired), so in-window runs re-dispatch themselves — one tick sustains the whole evening |
| `deploy.yml` | Push to `main` touching `frontend/**` or `data/**`, + dispatched by the others | Build frontend, stage `data/` into `dist/`, publish to Pages |
| `digest.yml` | Sat 13:00 UTC | Weekly newsletter export → `data/digest/latest.html` |
| `sentinel.yml` | Daily 14:00 UTC | Watchdog (`scraper/scripts/check_freshness.py`): freshness, coverage, stats-blackout — plus a run-count check that alerts when last night's game-window crons didn't fire |
| `tests.yml` | Push/PR touching `scraper/**` | pytest (pure-logic + saved-fixture parser tests) |

Chain: **scrape → validate → commit → dispatch deploy**. Bot pushes don't
trigger workflows (GitHub loop protection), which is why scrape/digest
explicitly dispatch Deploy — and why their `permissions` include
`actions: write`.

## Alerting — how failures reach a human

Any failing workflow (and per-sport scrape failures the run tolerates)
opens a **GitHub issue labeled `ops-alert`** via
`.github/actions/alert-issue`. Dedupe rule: while one `ops-alert` issue is
open, further failures do NOT open more issues or spam comments — the open
issue is the "go look" signal, and the Actions list has the details.
**Close the issue once resolved**; the next failure opens a fresh one.

Watch the label (Watch → Custom → Issues, or a label-filtered bookmark):
`https://github.com/RowanFlynnPilot/wpr-prep-sports/issues?q=label%3Aops-alert`

Failure layers, outermost first:

1. **Red run + alert issue** — a step failed (validation gate, commit,
   deploy dispatch) or a sport's scrape hard-failed.
2. **Partial scrape** (`main.py` exit 3) — some schools failed but the
   rest were written and shipped; alert issue lists the sport, run log
   lists the schools. More than ~30% of schools failing aborts the sport
   without writing instead.
3. **Coverage-regression gate** (`validate_data.py`) — a structurally
   valid dataset whose counts collapsed vs git HEAD (games −50%, stat
   lines → 0, standings/season-stats emptied) fails the run *before*
   commit. Bypass for deliberate repairs: `--no-regression`.
4. **Freshness sentinel** (`sentinel.yml`, daily) — catches what green
   runs can't: in-season data whose `meta.last_updated` stopped moving
   (default threshold 7 days). This is the tripwire for "WIAA changed
   markup, every scrape now parses 0 games, and the wipe guard is
   (correctly) refusing to overwrite."

In-scraper guards (silent by design, they *prevent* damage):

- **Wipe guard** — a 0-game scrape never overwrites a dataset that has
  games (preseason no-op + outage protection). Manual override: delete
  `data/<sport>/games.json` first.
- **Season-stats guard** — an empty season-stats merge never replaces a
  populated same-season file once finals exist (a Bound/MaxPreps outage
  freezes stats instead of wiping them; seen for real 2026-07-08).
- **Live no-downgrade** — live merges can't move a `final` game backwards.

## Local Bound refresh (Windows scheduled task)

Bound (gobound.com) answers GitHub's runners with a bot challenge, so
every cron scrape logs `0 Bound games indexed` and carries the previous
stat lines forward. Bound is the main football and basketball stat
source (MaxPreps covered 18 of 152 football box scores in Sep 2026), so
without a local run the box scores and Player of the Week freeze. That
happened for twelve days in Sep 2026: week 5 had 2 of 39 finals with
stats and the card held the prior week.

`scraper/scripts/local_bound_refresh.ps1` closes the gap from Rowan's
machine. It pulls `main`, re-runs the stat merges via
`scripts/refresh_bound.py` (Bound, then MaxPreps layered on top) for the
sports in season (football Aug–Nov, boys/girls basketball Nov–Mar), runs
`validate_data.py`, and commits + pushes `data/` with the cron's
rebase-retry. It skips itself if the checkout is not on `main` or
`data/` has local edits, and a rebase conflict discards the refresh
rather than the working tree. Log:
`%LOCALAPPDATA%\wpr-prep-sports\bound-refresh.log`. A run takes about
12 minutes for football (MaxPreps discovery dominates). The OG-card step (15-minute ceiling) also renders Season Wrapped PNGs for finished teams into `data/og/wrapped/`.

Registered 2026-09-24 as **"WPR Prep Sports Bound refresh"**, daily at
6:15 AM, run-when-available, allowed on battery, 1-hour limit:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Users\rpfly\Projects\wpr-prep-sports\scraper\scripts\local_bound_refresh.ps1"' `
  -WorkingDirectory 'C:\Users\rpfly\Projects\wpr-prep-sports'
$trigger = @((New-ScheduledTaskTrigger -Daily -At 6:15am), (New-ScheduledTaskTrigger -Daily -At 12:15pm))
# Two triggers: StartWhenAvailable only catches runs missed while the
# machine was OFF. A laptop asleep at 6:15 skips the day (seen 2026-10-14,
# NumberOfMissedRuns 1), so a 12:15 run covers it; the script exits without
# a commit when nothing changed, so the second run is free on normal days.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "WPR Prep Sports Bound refresh" `
  -Action $action -Trigger $trigger -Settings $settings -Force
```

Checks:

```powershell
Get-ScheduledTaskInfo -TaskName "WPR Prep Sports Bound refresh"   # last/next run, result
Start-ScheduledTask   -TaskName "WPR Prep Sports Bound refresh"   # run it now
Unregister-ScheduledTask -TaskName "WPR Prep Sports Bound refresh"  # remove it
```

If Player of the Week is stuck on an old week again: check the log's
last line, then `git log --author=Rowan -- data/football/boxscores` to
see when a local refresh last landed. The sentinel does not watch stat
coverage, only `meta.last_updated`.

## Before state week

Since 2026-11-05 the 10-minute live cron also refreshes the state pages while a
sport has playoff games in its dataset (`refresh_state_games` in
`transform/normalize.py`), so state scores land within minutes of WIAA posting
them instead of waiting for the hourly scrape. The hourly scrape remains the
source for new pairings and anything the live path did not catch.

State semifinals and finals reach the site only through WIAA's
state-tournament pages (school schedules stop at Level 4 / Sectional
Final; see docs/data-sources.md, "State-tournament games"). The hourly
scrape fetches them automatically once a sport's series has started.
Before each state week (2026: volleyball and boys soccer Nov 5-7,
football Nov 19-20, 8-player football one week after its Level 4):

1. **Keep the sport in the cron list** (`scrape.yml` `SPORTS`) until its
   state final is over: football through Nov 20, volleyball and boys
   soccer through Nov 7. Dropping a sport early freezes it before the
   title game.
2. **When the field is set** (the night of the sectional final / Level 4),
   check the sport's tournament page (e.g.
   `https://www.wiaawi.org/sports/girls-volleyball/girls-volleyball-tournament`)
   for pairings. Then run
   `python main.py --sport volleyball --season 2026-27 --dry-run --no-stats`
   and look for the `WIAA state pages: N ... state game(s)` line. N > 0
   once WIAA has typed the pairings; a tracked school's game then
   appears in the dataset as "State Semifinal" etc.
3. **During the games**, live scores do not cover state games (ScoreCenter
   has no state round). Finals appear after WIAA types them onto the
   tournament page; check the next hourly scrape.
4. **If a tracked team's state game is missing or wrong** (the prose
   changed shape, or WIAA is slow), add it to `data/state_games.json`
   (schema in docs/data-sources.md), commit, and let the next scrape
   merge it. Then capture fresh fixtures
   (`python tests/capture_fixtures.py --state`) and fix the parser in
   `sources/wiaa_state.py` so the override isn't needed next time.
5. **After the season**, the block moves to the sport's `-state-archive`
   page. The code reads both pages, so later scrapes of that season keep
   the games.

## Secrets & repo variables (complete inventory)

| Name | Kind | Where set | Used by | Unset means |
|---|---|---|---|---|
| `GITHUB_TOKEN` | automatic | — | all workflows (commit, dispatch, issues) | n/a |
| `BASE_PATH` | repo **variable** | Settings → Variables — **SET to `/`** | `deploy.yml` AND `scrape.yml` → `VITE_BASE` (both frontend builds must match) | builds fall back to `/wpr-prep-sports/` → on the custom domain every asset 404s; OG cards render blank and silently stop refreshing (the opening-night 2026 incident). Do NOT delete. |
| `PLAUSIBLE_DOMAIN` | repo **variable** | Settings → Variables — set (`sports.wausaupilotandreview.com`) | `deploy.yml` → `VITE_PLAUSIBLE_DOMAIN` | analytics disabled (all trackEvent calls no-op) |
| `PLAUSIBLE_SCRIPT_ID` | repo **variable** | Settings → Variables — set (`pa-…`, live since 2026-08-25) | `deploy.yml` → `VITE_PLAUSIBLE_SCRIPT_ID` (new-style per-site script; the legacy data-domain script gets `x-plausible-dropped` on new-flow sites — see docs/analytics.md) | falls back to the legacy script path, which this site's Plausible config silently drops |
| `PICKEM_API` | repo **variable** | intentionally unset | `deploy.yml` → `VITE_PICKEM_API` | Pick'em community features hidden (localStorage-only mode) |
| Cloudflare account + KV namespace id | external | `pickem-api/wrangler.toml` | Pick'em worker | worker undeployed; see `pickem-api/README.md` |

Not passed anywhere (build-time defaults apply): `VITE_SPONSOR_EMAIL`
(defaults to `SITE.contactEmail` in `frontend/src/config/site.js` — set
the repo variable only to point sponsorship mail somewhere else without
a code change), `VITE_DATA_BASE` (defaults to same-origin `data/`).

## Incident runbook

**An `ops-alert` issue appeared.** Open the linked run. Which workflow?

- **Scrape, hard-failed sport(s)** — open the sport's log group. WIAA
  down = transient, next cron self-heals (close the issue). Parse errors
  on every school = markup change: refresh fixtures
  (`python tests/capture_fixtures.py`), run `pytest tests`, fix
  `sources/wiaa.py` selectors until fixture tests pass.
- **Scrape, partial** — usually one school's page misbehaving; log group
  names it. One-off = ignore (data self-heals next run). Persistent for
  a specific school = check its WIAA page by hand; the OrgID may have
  changed (re-run discovery) or the page may be gone.
- **Validation gate / regression gate failed** — the log prints exactly
  which check. Coverage collapse = a stats source broke: check the named
  source module. If the drop is *intentional* (manual repair, backfill),
  re-run the scrape dispatch after pushing, or run validation locally
  with `--no-regression` to confirm it's the only failure.
- **Deploy failed** — readers are seeing the last good deploy, nothing is
  lost. Re-run the Deploy workflow (workflow_dispatch) after the cause
  (usually a transient Pages outage) clears.
- **Sentinel: stale data** — the per-sport ages are in the run log.
  Green scrape runs + stale meta = wipe guard blocking every write →
  almost certainly a WIAA markup change (see fixtures flow above). No
  recent scrape runs at all = check the cron didn't get disabled
  (Actions can pause schedules after 60 days without repo activity).
- **Sentinel: thin coverage** — an in-season sport references under a
  third of its tracked roster. Two causes look identical from the data;
  probe WIAA directly to tell them apart:

  ```bash
  # 1. Does the school profile list a current-season team for the sport?
  curl -s -X POST -H "Content-Length: 0" \
    "https://schools.wiaawi.org/Directory/School/GetDirectorySchool?OrgID=454&showPub=False" \
    | grep -oE 'Soccer[^<]*|TeamID=[0-9]+'
  # 2. Does that team's schedule page have any game rows?
  curl -s "https://schools.wiaawi.org/Directory/Schedule/Index?TeamID=<id>" \
    | grep -c 'gridTableRow'
  ```

  Team listed but zero rows (for several schools) = **WIAA hasn't
  published yet** — the data is correctly thin. Record that verification
  in `scraper/config/sentinel_ack.json` with an expiry date (`until`,
  inclusive) and close the ops-alert issue; the sentinel keeps printing
  the gap as ACKNOWLEDGED and goes red again automatically if the ack
  expires before coverage recovers. No team listed at all, or rows
  present that we're not capturing = **scraper-side** (TeamID discovery
  or parsing) — treat as a real failure, don't ack it. August 2026
  precedent: boys soccer sat at 1/21 schools with WIAA verified empty;
  acked until Sept 1.
- **Digest failed** — newsletter team needs `data/digest/latest.html`;
  re-run via dispatch (optionally `week_ending=YYYY-MM-DD`).

**Rate limits / politeness.** The WIAA loop paces at 0.4s per school
(matching the stats merges). If WIAA ever starts returning 429s, raise
`POLITE_DELAY_SECONDS` in `scraper/main.py`.

**Seasonal ops** (see also `docs/season-rollover.md`):

- November: add winter sports to the cron sport list (`scrape.yml`
  default + dispatch default), refresh WPH `SUBSEASONS` ids.
- October: re-run `scripts/backfill_divisions.py` once fall brackets post.
- After any rollover: `sentinel.yml`'s month map in
  `scraper/scripts/check_freshness.py` should list any newly-added sport.

## Local dev quickies

```bash
cd scraper
python -m pytest tests -q            # unit + fixture tests (no network)
python scripts/validate_data.py      # full data gate incl. regression vs HEAD
python scripts/check_freshness.py --month 9   # simulate September's sentinel
python tests/capture_fixtures.py     # refresh saved WIAA fixtures (3 requests)
```

## Site down: Cloudflare 526

**Symptom:** the WPR page shows "sports.wausaupilotandreview.com refused to
connect" in the iframe; `curl -I https://sports.wausaupilotandreview.com/`
returns `526`. Data commits and deploys keep succeeding, so nothing else alerts
(the sentinel's site check does, since 2026-10-28).

**Cause (2026-10-24 outage, 4 days):** GitHub Pages issues the custom domain's
Let's Encrypt certificate itself and renews it every ~90 days, but only while
DNS points at GitHub. The `sports` record is Cloudflare-proxied (orange cloud),
so renewal failed (`gh api repos/RowanFlynnPilot/wpr-prep-sports/pages --jq
.https_certificate` showed `state: bad_authz`) and the certificate expired. With
Cloudflare's SSL mode at Full (strict), Cloudflare refuses an expired origin
certificate and answers 526.

**Fix (Cloudflare dashboard, wausaupilotandreview.com zone), either:**

1. *Keep the proxy (recommended, durable):* Rules → Configuration Rules → Create
   rule "Prep sports origin SSL": hostname equals `sports.wausaupilotandreview.com`
   → SSL: **Full** (not strict). Traffic stays encrypted to GitHub; Cloudflare just
   stops validating GitHub's certificate. Takes effect in seconds and survives
   future expiries.
2. *Let GitHub renew:* DNS → the `sports` CNAME → switch to **DNS only** (grey
   cloud). Then re-trigger the certificate from the repo (remove and re-add the
   custom domain in Settings → Pages, or `gh api -X PUT
   repos/RowanFlynnPilot/wpr-prep-sports/pages -f cname=sports.wausaupilotandreview.com`)
   and wait for `state: approved`. Until it issues, browsers see the expired
   certificate directly, so do option 1 first if readers are affected. Note the
   proxy is what made the iframe same-site for favorites; grey cloud keeps the same
   hostname, so that still holds.

Verify: `curl -s -o /dev/null -w '%{http_code}' https://sports.wausaupilotandreview.com/` → 200.

**Resolved 2026-10-28** with option 1: Configuration Rule "Prep sports hub – origin
SSL Full" is live on the wausaupilotandreview.com zone. GitHub's certificate stays
expired behind it (renewal can't run while proxied), which Full mode accepts, so the
sentinel reports the certificate as a warning only and alerts on HTTP failures. If
that rule is ever deleted or the zone's mode is tightened, the site goes down again
the same way.
