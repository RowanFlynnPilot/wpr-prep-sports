# White-labeling: run this widget for another publisher

The widget is ~fully config-driven for a second **Wisconsin** publisher:
same data sources (WIAA, Bound, MaxPreps, Wisconsin Prep Hockey), a new
school manifest, and a rebrand. This page is the onboarding runbook.
A different **state** additionally needs a schedule-source adapter for
that state's association — see "What stays Wisconsin-specific" below.

## The short version

1. Create the new repo from this one (GitHub "Use this template" or
   fork). One repo per publisher — isolated Actions, Pages, data, and
   failure domain.
2. Author the school manifest.
3. Edit one branding file + swap one logo.
4. Set repo variables, enable Pages, deploy.
5. (Optional) Deploy a Pick'em worker for their domain.

Everything defaults to the WPR production values, so an unedited fork
builds and runs — you replace values, never hunt for hardcodes.

## 1. School manifest — `scraper/config/schools.json`

The only real editorial work. Per school:

- `id` (kebab-case slug), `name`, `full_name`, `mascot`, `city`,
  `colors` (verify against the WIAA directory — readers notice).
- `conferences`: one `{sport, conference}` entry per sport — Wisconsin
  schools routinely sit in different conferences per sport.
- `aliases`: alternate display names sources render — co-op strings
  ("Loyal/Greenwood"), WIAA long forms ("Stevens Point Area"). Start
  empty; add when a scrape logs an unmatched name. Co-ops modeled as
  their own team (like WPR's Central Wisconsin Storm) get the WIAA
  co-op string as an alias on the tracked entity.
- Source IDs: leave `wiaa_org_id` null (auto-discovered on first
  scrape and written back). `bound_slug` / `maxpreps_slug` /
  `wph_team_id` can be backfilled with the discovery scripts in
  `scraper/scripts/` as each stats source is turned on.
- `wiaa_division`: run `scraper/scripts/backfill_divisions.py` each
  fall once brackets post.

Then set the scrape targets: the sport/season defaults at the top of
`.github/workflows/scrape.yml` (`SPORTS`, `SEASON`), and the sentinel's
in-season month map (`scraper/scripts/check_freshness.py`) if the sport
mix differs.

## 2. Branding — `frontend/src/config/site.js`

Every org-specific string renders from this one file: publisher name,
homepage/sports URLs, masthead lockup (`titleLead` / `titleEm`), region
wording, contact email, governing-body label, time zone, widget origin,
and the digest email palette. Also:

- Swap `frontend/public/wpr-logo.png` (or change `logoFile`).
- Set the static fallback `<title>` in `frontend/index.html` (the app
  overwrites it at boot from the config).
- Theme: `frontend/src/styles/global.css` `:root` tokens — `--brand`,
  `--brand-2`, `--link`, `--accent` and the neutral ramp, in both the
  light and dark blocks. Values-only edit.
- **Namespaces** (`messageNamespace`, `storagePrefix` in site.js): set
  once BEFORE launch. Changing them later orphans readers' saved picks
  and breaks host-page iframe-resize listeners.
- Sales copy: the media-kit inventory (`INVENTORY` in
  `frontend/src/pages/MediaKitPage.jsx`) and `data/pricing.json` are
  per-publisher sales content — rewrite for the new market.
- Reset the editorial/sponsor data files: `data/sponsors.json`,
  `data/potw.json`, `data/spirit.json`, `data/spotlights.json`.
- Courtesy: point the scraper's identifying User-Agent at the new
  publisher (`scraper/sources/wiaa.py` `USER_AGENT`).

## 3. Repo variables + Pages

Settings → Secrets and variables → Actions → **Variables** (all
optional; unset = WPR defaults):

| Variable | Purpose |
|---|---|
| `BASE_PATH` | Pages base path, e.g. `/their-repo-name/` (custom domain: `/`) |
| `SPONSOR_EMAIL` | Media-kit contact override |
| `PLAUSIBLE_DOMAIN` | Analytics site (docs/analytics.md) — unset = analytics off |
| `PICKEM_API` | Their Pick'em worker URL — unset = localStorage-only pick'em |

Settings → Pages → Source: **GitHub Actions**. Then run the Scrape
workflow once (dispatch) and the site is live at
`https://<user>.github.io/<repo>/`.

Ops note: the fork inherits the full alerting stack (ops-alert issues,
freshness sentinel, coverage-regression gate, tests) with zero setup —
see docs/operations.md. Whoever operates the fork should watch its
`ops-alert` label.

## 4. Pick'em worker (optional)

Follow `pickem-api/README.md` under the publisher's Cloudflare account,
with `wrangler.toml` `[vars]` pointing at their origins:

```toml
[vars]
DATA_ORIGIN = "https://<user>.github.io/<repo>"
ALLOWED_ORIGINS = "https://<user>.github.io,https://<news-site>.com"
```

## 5. WordPress embed

Same snippet as the README, with their Pages URL — and if
`messageNamespace` was changed, the `e.data.type` check in the host
snippet must match (`<namespace>:resize`). The media-kit page's embed
builder generates correct snippets automatically.

## What stays Wisconsin-specific (Tier 2 work)

- `scraper/sources/wiaa.py` + the WIAA-shaped parts of
  `transform/normalize.py` — another state means writing that state's
  association adapter (the schema, writer, rankings, validation, and
  the entire frontend are state-agnostic).
- `frontend/src/config/sports.js` — sport labels, season windows,
  `nextSeasonStart` dates, and stat-category metadata follow the WIAA
  calendar; a new state edits these per its association's calendar.
- Stats sources: Bound (WI/IA), Wisconsin Prep Hockey (WI-only).
  MaxPreps is national and travels.

## Before charging a customer

Two business items from the 2026-07 productization review: get a legal
read on MaxPreps/Bound terms for a *paid* product built on scraping
them (a WIAA-only tier — scores/schedules/standings — is the clean
fallback), and remember the code is public under MIT: what's sold is
the running service (onboarding, source maintenance, ops, sponsor
playbook), not the code.
