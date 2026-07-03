# Senior Spotlights — editor workflow

Publish a senior profile by adding an entry to `data/spotlights.json`
and committing — no code changes, live on the next deploy. Mirrors the
PotW override pattern (`docs/potw-override.md`).

## Add a spotlight

Append to the `spotlights` array:

```json
{
  "school_id": "stratford",
  "name": "Jane Doe",
  "sport": "football",
  "position": "RB",
  "photo_url": "https://…/jane.jpg",
  "blurb": "Four-year varsity letterwinner and two-time all-conference pick.",
  "plans": "Nursing at UW-Eau Claire",
  "published_at": "2026-09-01",
  "expires_at": null
}
```

Field notes:

- `school_id` — slug from `data/schools.json`. Drives the card's color
  and the school link.
- `sport` — optional. Set it and the card shows only on that sport's
  dashboard; omit it to show on every sport.
- `photo_url` — optional; the school logo fills in when absent. Any
  hosted image works (WPR media library URL is fine).
- `plans` — optional "Next up:" line (college/trade/military plans).
- `published_at` — newest-first ordering; the top 3 active entries
  render.
- `expires_at` — optional ISO timestamp; the entry disappears after.
  Omit to keep it until you remove it.

## Where it renders

Dashboard → **Spotlight tab**, above Notable performances. Hidden
entirely when no active entries match the sport — quiet weeks show
nothing rather than an empty card.

## Sponsorship

The section header carries the `spotlight:senior` slot
(`data/sponsors.json`) — "Senior Spotlight presented by ___". Sold
status shows on the `#/sponsor` media kit automatically.
