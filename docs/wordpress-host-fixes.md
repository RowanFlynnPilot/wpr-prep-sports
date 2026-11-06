# WordPress and Cloudflare: four fixes on the host side

Found by the 2026-10-09 technical audit of the live page at
`wausaupilotandreview.com/high-school-sports/`, plus a cache rule from the
2026-11-05 Lighthouse re-audit. None of these are in this repo; each is a
10–15 minute change in WordPress or the Cloudflare dashboard, and together
they are the biggest reader-facing wins left. Do them in this order.

## 1. Install `embed.js` once, site-wide (fixes the 1,400 px scroll trap)

**What's wrong.** The hub iframe on `/high-school-sports/` is a fixed
`height="1400"`. The widget's own page is 4,900–7,500 px tall depending
on the sport, so readers scroll inside a 1,400 px window inside the
page. The widget posts its real height every time it changes
(`wpr-prep-sports:resize`) and asks the host to restore scroll position
after in-widget navigation (`wpr-prep-sports:navigated`), but nothing on
the host listens: the page HTML has no reference to `embed.js` and a
synthetic resize message left the frame at 1,400.

**Why it isn't in the post.** The WAF in front of the site rejects any
post body containing `<script` ("Updating failed. The response is not a
valid JSON response."), so the listener cannot live in post content. It
has to be installed once, outside the editor.

**Steps (site admin).**

1. In WordPress, install or open a code-snippets plugin (WPCode is the
   usual one; "Insert Headers and Footers" also works), or edit the
   theme's footer template if the site has a child theme.
2. Add this one line, scoped to the whole site, in the **footer**:

   ```html
   <script async src="https://sports.wausaupilotandreview.com/embed.js"></script>
   ```

3. Save and activate. No change to the hub page or any article is needed.

**Verify.** Open `/high-school-sports/` on a phone, switch to Volleyball:
the frame should grow to fit with no inner scrollbar. On desktop, open a
game from the Scores tab, then tap "Back": the page should scroll so the
widget's top is visible again. In the browser console,
`document.querySelector('iframe[src*="sports.wausau"]').height` should
read a number far above 1400 after the widget loads.

**Notes.** The script is idempotent and finds every widget iframe on a
page by matching each message to the frame that sent it, so it also
covers the per-school and per-conference modules in articles and the
mini scoreboard. The fixed `height` attributes in existing snippets
become the pre-load placeholder. The file's header comment explains the
WAF history.

## 2. Point the sidebar widget at the mini scoreboard (not the full hub)

**What's wrong.** A sidebar widget on the host page loads
`https://sports.wausaupilotandreview.com/` — the entire dashboard — in a
283 px-wide, 1,400 px-tall frame. The dashboard is 5,894 px tall at that
width, so about a quarter of it is reachable, it scrolls sideways by
3 px, and every page view loads the full dataset twice and fires every
analytics hit twice.

**Steps (editor).**

1. Appearance → Widgets (or Customize → Widgets), find the sidebar
   block holding the sports iframe.
2. Replace its contents with the mini scoreboard snippet from the README
   ("Mini scoreboard" section). For football only:

   ```html
   <iframe
     src="https://sports.wausaupilotandreview.com/mini.html?sport=football"
     title="Prep sports scoreboard — Wausau Pilot &amp; Review"
     width="100%" height="540" frameborder="0" loading="lazy"
     style="border:0;display:block;max-width:420px;"
   ></iframe>
   ```

   For the in-season switcher use `mini.html?sports=in-season` and
   `height="580"`. Both heights are measured maxima; the mini never
   needs the resize script.
3. Save. The widget shows the latest local scores and the next games
   and taps through to the hub page.

**Verify.** The sidebar frame shows four scores and three upcoming
games with no inner scrollbar at any width down to 300 px.

## 3. Turn off the Cloudflare Google tag gateway for the widget host

**What's wrong.** Cloudflare's Google tag gateway injects a GA4 loader
(`/glmk/…`, tag `G-CXWNY53DN1`) into every page served from
`sports.wausaupilotandreview.com`, including every iframe load. That is
210 KB compressed, 62% of the mini scoreboard's entire payload and
about a quarter of the dashboard's, and it fires `page_view` and
`scroll` events from inside the iframe on top of the host page's own
GA, double-counting. The widget already reports to Plausible (live
since Aug 25), which is what the sponsor reports use.

**Steps (Cloudflare account owner).**

1. Cloudflare dashboard → the `wausaupilotandreview.com` zone → **Tag
   Management → Google tag gateway** (sometimes under Zaraz or Speed →
   Optimization, depending on dashboard version).
2. Either disable the gateway for the hostname
   `sports.wausaupilotandreview.com`, or add a rule so it runs only on
   `wausaupilotandreview.com` (the host pages).
3. While there, do item 4 below — it is the same dashboard section.

**Verify.** Load `https://sports.wausaupilotandreview.com/mini.html?sport=football`
with the browser's Network panel open: no request to `/glmk/` or
`googletagmanager.com`, and total transfer under 150 KB. In Plausible
the realtime view should still show the visit.

## 4. Cache rule: a year for `/assets/*` and `/fonts/*`

**What's wrong.** Every hashed bundle under `/assets/*` and every font
under `/fonts/*` ships `cache-control: max-age=600` — GitHub Pages' default
for everything, which Cloudflare passes straight through. Those files are
content-addressed (the bundle names change when the code does; the fonts
have not changed since they were self-hosted) and could be cached
forever, but a reader coming back eleven minutes later re-downloads all
of them: about 428 KB a visit, and 1.3–1.9 s of Largest Contentful Paint
on a slow connection, measured in the 2026-11-05 Lighthouse re-audit.
Nothing in this repo can change the header — Pages sets it.

**Steps (Cloudflare account owner).**

1. Cloudflare dashboard → the `wausaupilotandreview.com` zone →
   **Caching → Cache Rules → Create rule**.
2. Match: hostname equals `sports.wausaupilotandreview.com` AND URI path
   starts with `/assets/` OR `/fonts/` (two expressions, or one rule per
   prefix if the editor prefers).
3. Cache eligibility: eligible for cache. **Edge TTL:** override to
   1 year. **Browser TTL:** override to 1 year.
4. Leave the rest of the host alone: `index.html`, `mini.html` and
   everything under `/data/` must keep the short default so a new deploy
   and a fresh scrape show up within minutes. Only the two hashed
   prefixes get the long life.

**Verify.** `curl -sI https://sports.wausaupilotandreview.com/fonts/oswald-latin-wght.woff2`
should show `cache-control: max-age=31536000` (and `cf-cache-status: HIT`
on the second request); `curl -sI https://sports.wausaupilotandreview.com/`
should still show `max-age=600`. On a repeat visit the Network panel
should list every `/assets/` and `/fonts/` file as served from cache.

**Related, on the repo side (not a host fix).** The school logos the
scraper mirrors from WIAA are served at their original size — 260 KB for
the 24 logos on one dashboard view, most displayed at 24–48 px. A
follow-up for `scraper/scripts/mirror_logos.py` (its `--recompress`
pass): resize to the largest size the widget renders and re-encode.

## After all four

Re-run the Playwright guard and reload `/high-school-sports/` on a phone.
The page should scroll as one document, the sidebar should show the
mini, and the widget's first load should be roughly 650 KB lighter on
the dashboard and 210 KB lighter on the mini; a second visit should be
another ~430 KB lighter again.
