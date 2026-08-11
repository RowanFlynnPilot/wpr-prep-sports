# wpr-prep-sports

Central Wisconsin High School Sports Hub — schedules, scores, standings, and
player stats for **67 schools across 8 sports** (football, boys/girls
basketball, volleyball, boys/girls hockey, boys/girls soccer) in the
Wisconsin Valley, Marawood, Great Northern, Cloverbelt, Big Rivers,
CWC, and Northwoods conferences.

Wisconsin schools play in *different* conferences for *different* sports, so
conference membership is modeled per-sport rather than globally.

Built for [Wausau Pilot & Review](https://wausaupilotandreview.com/) and
embedded into the site via iframe. The frontend is white-label ready —
publisher name, URLs, and branding live in `frontend/src/config/site.js`
(see [docs/white-label.md](docs/white-label.md)).

## Architecture

```
Python scraper → GitHub Actions cron → GitHub Pages static JSON → React/Vite frontend → WordPress iframe embed
```

## Repo layout

```
.
├── .github/workflows/   GitHub Actions: scrape, live scores, deploy, digest,
│                        sentinel, tests
├── scraper/             Python scraper (WIAA schedules/scores; Bound +
│                        MaxPreps + Wisconsin Prep Hockey for player stats)
├── frontend/            React + Vite, deployed to GitHub Pages
├── pickem-api/          Cloudflare Worker for community pick'em (see README)
├── data/                Static JSON output from the scraper
├── docs/                Source notes, data schema, advertiser inventory,
│                        operations runbook, white-label onboarding
└── CLAUDE.md            Persistent project context for Claude Code
```

## Embedding the widget on the WPR site

The widget is served from `https://sports.wausaupilotandreview.com` — a
subdomain of the publisher's own site, deliberately. That makes the iframe
*same-site* with the host page, so browsers don't partition the widget's
`localStorage` and Safari/ITP doesn't expire it after 7 days, which is what
keeps reader state (Pick'em picks, favorites) from silently vanishing.
Serving from `*.github.io` would make it third-party and reintroduce all of
that. See [docs/favorites-spec.md](docs/favorites-spec.md).

Use `https://` in the `src`: the host page is HTTPS, so an `http://` iframe
is blocked as mixed content.

Add this anywhere in a WordPress post or template:

The `allow` attribute matters: the widget is a *cross-origin* frame for
Permissions Policy purposes (`sports.` vs `www.`) even though it is
same-site for cookies, so without it the Share button's copy-to-clipboard
and native share sheet are both blocked and it falls back to showing the
URL for the reader to copy by hand.

```html
<iframe
  id="wpr-prep-sports"
  src="https://sports.wausaupilotandreview.com/"
  width="100%"
  height="900"
  frameborder="0"
  loading="lazy"
  allow="clipboard-write; web-share"
  style="border:0;display:block;"
></iframe>

<script>
  // Auto-resize the iframe to match the widget's actual content height,
  // and restore a sane scroll position when the reader navigates inside
  // it. The widget posts { type: 'wpr-prep-sports:resize', height: N }
  // on load, on layout change, and on hash navigation — and
  // { type: 'wpr-prep-sports:navigated' } after each in-widget page
  // change. Without the navigated handler, clicking a game from deep in
  // the scores list shrinks the iframe under the reader and strands
  // them below the widget.
  (function () {
    var WIDGET_ORIGIN = 'https://sports.wausaupilotandreview.com';
    // Breathing room above the widget after a scroll correction. Raise
    // this if the site ever ships a sticky header that would cover it.
    var HEADER_OFFSET = 12;
    var iframe = document.getElementById('wpr-prep-sports');
    if (!iframe) return;
    window.addEventListener('message', function (evt) {
      // Only accept messages from the widget itself: any framed ad or
      // third-party script on the page can post to window, and without
      // these two checks any of them could resize this iframe or scroll
      // the page.
      if (evt.origin !== WIDGET_ORIGIN) return;
      if (evt.source !== iframe.contentWindow) return;
      if (!evt.data) return;
      if (evt.data.type === 'wpr-prep-sports:resize') {
        var h = Number(evt.data.height);
        if (h > 0 && h < 100000) iframe.style.height = h + 'px';
      } else if (evt.data.type === 'wpr-prep-sports:navigated') {
        // In-widget navigation: if the widget's top edge is now above
        // the viewport (the new page is shorter, or the reader was deep
        // in the old one), bring it back — the same "start at the top"
        // a normal page navigation gives. Never fires on plain resizes,
        // so live-score updates can't yank the reader's scroll.
        var top = iframe.getBoundingClientRect().top;
        if (top < 0) window.scrollBy(0, top - HEADER_OFFSET);
      }
    });
  })();
</script>
```

The widget runs as a self-contained React app inside the iframe — no
script dependencies leak into the host page, no cookies are set, and
internal navigation uses hash routes so it never reloads the host page.

**Theming:** embedded, the widget always renders its light palette (the
WPR page around it is light). Append `?theme=dark` to the iframe `src`
(before the `#`) to force the dark palette if the host page ever ships
a dark skin. Standalone visits to the GitHub Pages URL follow the
visitor's OS `prefers-color-scheme` automatically.

### Per-school embed (article / sidebar module)

Any tracked team has a compact, chrome-free module for placing inside
game stories and sidebars — record, conference rank, last/next game,
recent form, and that school's sponsor slot:

```html
<iframe
  src="https://sports.wausaupilotandreview.com/#/football/embed/wausau-east"
  width="100%" height="330" frameborder="0" loading="lazy"
  style="border:0;display:block;max-width:640px;"
></iframe>
```

Swap the sport and school-id path segments per placement (ids are the
slugs in `data/schools.json`). The module posts the same
`wpr-prep-sports:resize` height messages as the main widget; give each
iframe on a page its own id and match `event.source` against
`iframe.contentWindow` when wiring auto-resize for multiple embeds.
The `#/sponsor` media kit generates these snippets per school.

## Local development

**Scraper:**

```bash
cd scraper
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py --sport football --season 2025-26
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

## Managing sponsors

Sponsorship slots are data-driven from [`data/sponsors.json`](data/sponsors.json).
Slots that don't have a `name` field render nothing — there's no "Your ad
here" filler that breaks the visual rhythm when a slot is unsold.

Active slot keys:

| Key | Where it appears |
|---|---|
| `title` | Masthead, next to the WPR attribution |
| `ticker` | Section header above "Recent Scores" |
| `standings:VFA West` (etc.) | Band under each conference's standings header |
| `school:wausau-east` (etc.) | Card at the bottom of each team page |

Per-school keys are dynamic: add `school:<slug>` for any school slug in
[`scraper/config/schools.json`](scraper/config/schools.json) and the widget
picks it up on the next deploy.

To enable a slot, edit `data/sponsors.json` and set `name` (and optionally
`label`, `logo_url`, `link_url`):

```jsonc
"title": {
  "label": "Presented by",                     // optional override
  "name": "Aspirus Sports Medicine",
  "logo_url": "https://wpr.cdn/sponsor.png",   // optional; falls back to text
  "link_url": "https://aspirus.org/sports"     // optional; opens new tab
}
```

Commit the change to main; the deploy workflow ships the update within
a couple of minutes.

## License

See `LICENSE`.
