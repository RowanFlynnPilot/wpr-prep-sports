# wpr-prep-sports

Central Wisconsin High School Sports Hub — schedules, scores, and standings
for ~14 schools across the Wisconsin Valley, Marawood, Great Northern, and
Cloverbelt conferences.

Built for [Wausau Pilot & Review](https://wausaupilotandreview.com/) and
embedded into the site via iframe.

## Architecture

```
Python scraper → GitHub Actions cron → GitHub Pages static JSON → React/Vite frontend → WordPress iframe embed
```

## Repo layout

```
.
├── .github/workflows/   GitHub Actions: scrape on cron, deploy on push
├── scraper/             Python scraper (WIAA primary; Bound deferred)
├── frontend/            React + Vite, deployed to GitHub Pages
├── data/                Static JSON output from the scraper
├── docs/                Source notes, data schema, advertiser inventory
└── CLAUDE.md            Persistent project context for Claude Code
```

## Embedding the widget on the WPR site

Add this anywhere in a WordPress post or template:

```html
<iframe
  id="wpr-prep-sports"
  src="https://rowanflynnpilot.github.io/wpr-prep-sports/"
  width="100%"
  height="900"
  frameborder="0"
  loading="lazy"
  style="border:0;display:block;"
></iframe>

<script>
  // Auto-resize the iframe to match the widget's actual content height.
  // The widget posts { type: 'wpr-prep-sports:resize', height: N } on
  // load, on layout change, and on hash navigation.
  (function () {
    const iframe = document.getElementById('wpr-prep-sports');
    if (!iframe) return;
    window.addEventListener('message', function (evt) {
      if (!evt.data || evt.data.type !== 'wpr-prep-sports:resize') return;
      var h = Number(evt.data.height);
      if (h > 0 && h < 100000) iframe.style.height = h + 'px';
    });
  })();
</script>
```

The widget runs as a self-contained React app inside the iframe — no
script dependencies leak into the host page, no cookies are set, and
internal navigation uses hash routes so it never reloads the host page.

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
