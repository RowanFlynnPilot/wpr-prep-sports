# Pick'em API — deploy runbook (~10 minutes, one time)

A single Cloudflare Worker + KV namespace that turns the widget's
localStorage Pick'em into a community game: pick percentages on every
matchup ("64% picked Mosinee") and a season leaderboard. Free tier is
far more than enough (limits: 100k requests/day).

Until this is deployed the widget behaves exactly as before —
picks stay browser-local and no community UI renders.

## Deploy

1. Create a free Cloudflare account (or use WPR's if one exists).
2. From this directory:

   ```bash
   npx wrangler login
   npx wrangler kv namespace create PICKS
   ```

   Paste the printed namespace `id` into `wrangler.toml`.

3. ```bash
   npx wrangler deploy
   ```

   Note the printed URL — e.g. `https://wpr-pickem.<account>.workers.dev`.

4. In the GitHub repo: **Settings → Secrets and variables → Actions →
   Variables → New repository variable**
   - Name: `PICKEM_API`
   - Value: the worker URL from step 3 (no trailing slash)

5. Re-run the **Deploy** workflow. Done — community bars and the
   leaderboard appear on the Pick'em card automatically.

## What it stores (privacy)

One KV entry per browser per sport: a random client UUID, an optional
self-chosen display name, and pick selections. No emails, no IPs, no
cookies. Names render on the public leaderboard verbatim (24-char cap,
angle brackets stripped) — light-touch moderation is: delete the KV
key.

## How cheating is prevented

- Picks for a game are rejected server-side once its start time passes
  (the worker checks the game date against the widget's own published
  `games.json`, edge-cached 5 minutes).
- The leaderboard is scored server-side against final scores in
  `games.json` — clients never submit results.
- One entry per browser id; someone clearing localStorage starts a new
  anonymous entry at 0-0. Good enough for bragging rights; not built
  for cash prizes.

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/picks` | POST | Submit/update picks `{client_id, sport, picks, name?}` |
| `/api/aggregates?sport=&ids=` | GET | Community counts per game (60s cache) |
| `/api/leaderboard?sport=&client_id=` | GET | Top 10 + caller's rank (60s cache) |

## Local test

No account needed — `node worker.test.mjs` runs the endpoint suite
against mocked KV and games.json (kickoff lock, aggregates, scoring,
validation). `npx wrangler dev --local` also works for a live local
instance.

## White-label deployments

The worker defaults to WPR's data origin and CORS allow-list. A second
publisher's deployment overrides both without touching code — set
`[vars]` in `wrangler.toml` (`DATA_ORIGIN`, comma-separated
`ALLOWED_ORIGINS`; template in the file) and deploy under its own
worker name + KV namespace. See docs/white-label.md.
