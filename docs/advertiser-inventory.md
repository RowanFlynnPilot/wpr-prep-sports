# Advertiser inventory

The product purpose: turn this hub into sellable, defensible ad inventory for
WPR. Below is the full menu of sponsorship surfaces, what to charge them as
(rough mental model), and which features unlock them.

> **Status (updated 2026-07-01):** the sponsor system is live. Every surface
> below is config-driven via `data/sponsors.json` (slot keys noted per
> surface); unsold slots render nothing in production. Sponsor clicks fire
> Plausible events (`sponsor-click:<slot>`) once analytics is activated.
> The living, sellable version of this doc is the **media-kit page at
> `#/sponsor`** (`frontend/src/pages/MediaKitPage.jsx`) — it renders each
> surface with a placement preview and live Available/Sold status.

## Top of funnel — visible on every page

| Surface | Slot key | Sponsor type fit | Notes |
|---|---|---|---|
| **Title sponsor** ("Central Wisconsin Sports Hub presented by …") | `title` | Aspirus Sports Medicine, Marshfield Clinic, credit union, orthopedic clinic | Highest-value single placement. Annual deal. |
| **Scoreboard / score ticker presented by** | `ticker` | Pizza chain, sports bar, wings place | High visibility, repeat impressions during game weekends. |
| **Section tabs** (Scores / Schedule / Standings & Stats / Spotlight) | `tab:<section>` | Broad local fit | One placement under each dashboard section tab — 4 discrete surfaces. |
| **Standings presented by** (per conference) | `standings:<conference>` | Local bank, credit union | Sells 5× — Wisconsin Valley, Marawood, Great Northern, Cloverbelt, Big Rivers. |

## Per-school inventory — the underrated multiplier

Each school's mini-page becomes its own ad surface. Sell **per school** to a
business physically close to that school:

| School | Natural local advertisers |
|---|---|
| Wausau East | Wausau-east-side dental, orthodontics, gas stations |
| Wausau West | Wausau-west-side businesses, Rib Mountain area |
| D.C. Everest | Schofield / Weston businesses, Cedar Creek Mall area |
| Mosinee | Mosinee businesses, papermill-adjacent |
| Newman Catholic | Catholic-affiliated businesses, parish-adjacent |
| Marathon, Edgar, Athens, Stratford, Spencer | Village-local businesses (very few competitors) |

The per-school sell is high-margin because each school's audience is
hyper-targeted (parents/grandparents/alums of that exact school) and the
inventory is plentiful (**67 tracked schools** × 8 sports = many addressable
surfaces). Slot key: `school:<school_id>`, rendered as a card on each team
page.

## Feature-tied sponsorships

| Feature | Sponsorship | Slot key | Status | Sponsor type fit |
|---|---|---|---|---|
| **Player of the Week** (editor override supported) | "POTW presented by ___" | `potw` | **Shipped** | Orthodontist, sports medicine clinic, athletic store, photo studio |
| **Game of the Week** (marquee hero, per sport) | "GOTW presented by ___" | `marquee:<sport>` | **Shipped** (8 sport variants) | Auto dealer, supper club, pizza chain |
| **Pick'em game** (predict weekly winners) | "Pick'em presented by ___" | `pickem` | **Shipped** (browser-local; leaderboard endpoint on the backlog) | Bank, credit union, insurance agent |
| **Game recaps / box scores** | "Game recap presented by ___" | `game-detail` | **Shipped** | Pharmacy, urgent care, restaurant |
| **Power rankings** | "Power Rankings presented by ___" | `power-rankings` | **Shipped** | Auto dealer, athletic gear retailer |
| **Live scores** (Friday Night Live cron, 10-min updates) | "Tonight presented by ___" | — (use `ticker`) | **Shipped** (data side) | Sports bar showing the games |
| **Playoff bracket** | "Bracket Challenge presented by ___" | — | Bracket view shipped; pick-the-bracket game not built | Bank, credit union (March Madness analog) |
| **Senior Spotlight** | "Senior Spotlight presented by ___" | — | **Not built** (planned: mirror the PotW override pattern) | Photo studio, tux rental, college consultant |

## Annual / seasonal packages

Bundle for sponsors who want a season-long presence:

- **Football Season Title** — title sponsor for football only, Aug–Nov
- **Basketball Season Title** — same, Nov–Mar
- **Tournament Special** — sponsorship of state tournament coverage + bracket challenge
- **Senior Night Special** — late-season package targeting senior families
  (college planners, photographers, formalwear)

## Why this works for advertisers (the pitch)

1. **Highly targeted audience** — parents, grandparents, alums, current students
2. **Highly engaged** — repeat visits weekly during season, multiple visits per week during peak
3. **Brand-safe context** — high school sports = community pride, not politics
4. **Local exclusivity** — sponsor can lock out competitors in their category
5. **Measurable** — WPR can report impressions, click-throughs, time-on-page
6. **Brand association** — being "the orthodontist behind Player of the Week" creates positive equity that an awareness banner can't

## Roadmap of inventory unlock

Everything through "v3 live scores" has shipped (as of the 2025-26 season).
What remains, in priority order for 2026-27:

| Next feature | Inventory it unlocks |
|---|---|
| Pick'em submission endpoint (leaderboard + "78% picked X" social proof) | Makes the `pickem` slot a flagship interactive sell |
| Per-school embed mode (`?school=x&compact=1`) | Lets each `school:<id>` sponsor see their placement on "their" page anywhere WPR embeds it |
| Senior Spotlights (`data/spotlights.json`, PotW pattern) | `spotlight:senior` slot |
| Weekly digest export (Friday roundup for the WPR newsletter) | "Weekly Roundup presented by ___" |
| State Tournament Bracket Challenge (needs `wiaa_division` backfill) | Bracket Challenge package |
| Rivalry / historical archive (2025-26 archive already banked) | "Rivalry Week presented by ___" |
