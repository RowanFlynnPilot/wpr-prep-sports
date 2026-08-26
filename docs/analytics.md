# Analytics

The widget ships with optional, privacy-friendly analytics via
[Plausible](https://plausible.io/) — no cookies, no PII, no consent
banner needed, and it works inside the WordPress iframe embed. Plausible
is the suite-wide choice (the Brewers tool reports to the same
account), so all WPR widget traffic lives in one dashboard.

**It is off by default.** Nothing loads until the repo variable below is
set, so local dev, forks, and preview builds never phone home. Plausible
also ignores `localhost` traffic on its own.

## Why this matters

WPR sells sponsorship inventory against this widget (scoreboard sponsor,
team sponsors, Player of the Week presented-by). Sponsors ask for
numbers: pageviews, repeat visits, which pages readers spend time on.
Without analytics there is nothing to put in the media kit.

> **Status: LIVE since 2026-08-25** — site `sports.wausaupilotandreview.com`,
> new-style per-site script (repo vars `PLAUSIBLE_DOMAIN` +
> `PLAUSIBLE_SCRIPT_ID`). Notes from activation night, for the next tenant:
> sites created under Plausible's newer install flow issue a per-site
> script (`pa-<id>.js`) and silently DISCARD events from the legacy
> data-domain script — `/api/event` returns 202 either way; check the
> `x-plausible-dropped: 1` response header. Set `PLAUSIBLE_SCRIPT_ID`
> (the id from the site's install snippet) and the loader uses the new
> script with hash routing. Verification must be a REAL human browser:
> Plausible's bot filter drops automated/headless visits server-side, and
> ad blockers hide your own — test from a phone on cellular and watch the
> realtime view.

## One-time setup (~5 minutes, existing Plausible account)

1. In the Plausible account: **Add a website**. The domain string is
   just the site's identifier — it does not need to resolve in DNS.
   Use something distinct from the other widgets, e.g.
   `prep-sports.wausaupilotandreview.com`.
2. In the GitHub repo: **Settings → Secrets and variables → Actions →
   Variables → New repository variable**:
   - Name: `PLAUSIBLE_DOMAIN`
   - Value: `prep-sports.wausaupilotandreview.com` (whatever was
     registered in step 1)
3. Re-run the **Deploy** workflow (or push anything). The build injects
   the script only when the variable is present.
4. Open the live widget once, then use Plausible's "verify
   installation" — the pageview from step 4 is what it looks for.
   Note: verification must be run against the widget, not the WPR
   homepage; easiest is to just load
   `https://sports.wausaupilotandreview.com/` in a normal browser tab and
   watch the realtime dashboard.

## What gets tracked

- **Pageviews per widget route, automatically.** The build loads
  Plausible's `script.hash.js` variant, which counts the initial load
  and every hash-route change — `/#/volleyball`,
  `/#/football/game/<id>`, `/#/volleyball/player/<school>/<slug>`,
  etc. No manual plumbing.
- **Custom events** — `trackEvent(name, props)` (from
  `src/utils/analytics.js`). Currently wired:
  - `sponsor-click:<slot>` — every sponsor lockup click (per-sponsor
    click-through reporting)
  - `pickem-pick` (prop: `sport`) — a pick'em selection
  - `tab-switch` (props: `tab`, `sport`) — dashboard section engagement
  - `mediakit-contact` (prop: `placement`) — "Become a sponsor" CTA
    clicks on `#/sponsor`
  - `mediakit-embed-copy` (props: `school`, `sport`) — per-school embed
    snippet copied from the media-kit builder
  - `season-view` (prop: `season`) — archive season selector use
  - `division-filter` (props: `sport`, `division`) — power-rankings
    division chip engagement

  To surface an event in the dashboard, add its name as a custom-event
  Goal in Plausible (sponsor-click goals can be added per-slot as slots
  sell). Sport switching needs no event — every sport is a hash route,
  so it's already a pageview.

## Self-hosting note

If WPR ever moves to a self-hosted Plausible instance, set a second
repo variable and pass it through the Deploy build as
`VITE_PLAUSIBLE_SRC` (the script URL); the code already reads it and
defaults to Plausible cloud.

## What does NOT get tracked

No cookies, no localStorage identifiers, no cross-site anything; IPs
are not stored (Plausible hashes and discards them daily). Safe to run
without a consent banner under GDPR/CCPA per Plausible's own data
policy — but WPR should still mention it in the site privacy policy.
