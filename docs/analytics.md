# Analytics

The widget ships with optional, privacy-friendly analytics via
[GoatCounter](https://www.goatcounter.com/) — no cookies, no PII, no
consent banner needed, free for non-commercial/low-traffic use, and it
works inside the WordPress iframe embed.

**It is off by default.** Nothing loads until the repo variable below is
set, so local dev, forks, and preview builds never phone home.

## Why this matters

WPR sells sponsorship inventory against this widget (scoreboard sponsor,
team sponsors, Player of the Week presented-by). Sponsors ask for
numbers: pageviews, repeat visits, which pages readers spend time on.
Without analytics there is nothing to put in the media kit.

## One-time setup (~10 minutes)

1. Create a free account at https://www.goatcounter.com/signup with a
   site code, e.g. `wpr-sports` → dashboard at
   `https://wpr-sports.goatcounter.com`.
2. In the GitHub repo: **Settings → Secrets and variables → Actions →
   Variables → New repository variable**:
   - Name: `GOATCOUNTER_URL`
   - Value: `https://wpr-sports.goatcounter.com/count`
3. Re-run the **Deploy** workflow (or push anything). The build injects
   the script only when the variable is present.

## What gets tracked

- **Pageviews by logical route** — `/volleyball`, `/football/game/<id>`,
  `/volleyball/player/<school>/<slug>`, etc. The widget is a hash-router
  SPA, so auto-collection would log every view as one flat URL; instead
  `src/utils/analytics.js` counts each in-widget route change manually.
- **Custom events** — call `trackEvent("sponsor-click-<slot>")` (from
  `src/utils/analytics.js`) anywhere a sponsor-relevant interaction
  happens. Events show up under their own names in the GoatCounter
  dashboard. Nothing is wired to events yet; add them as sponsorable
  surfaces firm up.

## What does NOT get tracked

No cookies, no localStorage identifiers, no IP storage beyond
GoatCounter's standard anonymized handling, no cross-site anything.
Safe to run without a consent banner under GDPR/CCPA per GoatCounter's
own privacy documentation — but WPR should still mention it in the site
privacy policy.
