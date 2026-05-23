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
├── scraper/             Python scraper (Bound primary, WIAA fallback)
├── frontend/            React + Vite, deployed to GitHub Pages
├── data/                Static JSON output from the scraper
├── docs/                Source notes, data schema, advertiser inventory
└── CLAUDE.md            Persistent project context for Claude Code
```

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
