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

## License

See `LICENSE`.
