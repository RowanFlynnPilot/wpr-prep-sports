# Operations: workflows, alerting, and what to do when it breaks

The whole pipeline is GitHub Actions + GitHub Pages; there are no servers.
This page is the map, the secrets inventory, and the incident runbook the
ops-alert issues link to.

## The five workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `scrape.yml` | Season-aware cron (hourly in-season, Fri 15-min windows, daily Jun–Jul) + dispatch | Full per-sport scrape → validation gate → OG cards → commit `data/` → dispatch Deploy |
| `scrape-live.yml` | Every 10 min during CT game windows | Live-score merge only (~60s); no-op off-season |
| `deploy.yml` | Push to `main` touching `frontend/**` or `data/**`, + dispatched by the others | Build frontend, stage `data/` into `dist/`, publish to Pages |
| `digest.yml` | Sat 13:00 UTC | Weekly newsletter export → `data/digest/latest.html` |
| `sentinel.yml` | Daily 14:00 UTC | Freshness watchdog (`scraper/scripts/check_freshness.py`) |
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

## Secrets & repo variables (complete inventory)

| Name | Kind | Where set | Used by | Unset means |
|---|---|---|---|---|
| `GITHUB_TOKEN` | automatic | — | all workflows (commit, dispatch, issues) | n/a |
| `PLAUSIBLE_DOMAIN` | repo **variable** | Settings → Variables | `deploy.yml` → `VITE_PLAUSIBLE_DOMAIN` | analytics disabled (all trackEvent calls no-op) |
| `PICKEM_API` | repo **variable** | Settings → Variables | `deploy.yml` → `VITE_PICKEM_API` | Pick'em community features hidden (localStorage-only mode) |
| Cloudflare account + KV namespace id | external | `pickem-api/wrangler.toml` | Pick'em worker | worker undeployed; see `pickem-api/README.md` |

Not passed anywhere yet (build-time defaults apply): `VITE_BASE`
(defaults to `/wpr-prep-sports/`), `VITE_SPONSOR_EMAIL` (defaults to
`SITE.contactEmail` in `frontend/src/config/site.js` — set the repo
variable only to point sponsorship mail somewhere else without a code
change), `VITE_DATA_BASE` (defaults to same-origin `data/`).

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
