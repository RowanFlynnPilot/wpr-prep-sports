# Season Wrapped cards

One school's season on a single shareable card: record, conference finish,
playoff result, top three stat leaders, biggest win, closest game, and a
WPR footer with the hub URL. Built for the week a team's season ends,
when parents and alums are looking for something to post.

Two sizes from one page:

| Format | Size | URL |
| --- | --- | --- |
| Story (default) | 1080 × 1920 (9:16, phone / Messages / Instagram story) | `#/<sport>/card/wrapped/<schoolId>` |
| Link preview | 1200 × 630 (same shape as the per-game OG cards) | `#/<sport>/card/wrapped/<schoolId>?format=og` |

Example: `https://sports.wausaupilotandreview.com/#/football/card/wrapped/edgar`

## Where it lives

- Page: `frontend/src/pages/WrappedCardPage.jsx` (+ `frontend/src/styles/WrappedCard.css`).
  Chrome-free like `OgCardPage`; in the hub it carries a toolbar (back to
  the team page, Share, size switch, Save image) and scales the card to fit
  the viewport. `?capture=1` drops the toolbar and the scaling so a headless
  browser can screenshot `.wrapped-card` at native size.
- Generator: `scraper/scripts/generate_wrapped_cards.py` — Playwright
  render of the route to PNG, modelled on `generate_og_cards.py`.
- Output: `data/og/wrapped/<sport>/<schoolId>.png` (story) and
  `<schoolId>-og.png` (link preview). Served by Pages at
  `https://sports.wausaupilotandreview.com/data/og/wrapped/<sport>/<schoolId>.png`
  once committed, like the per-game cards in `data/og/`.

The route is mounted in `App.jsx` at the top level
(`/card/wrapped/:sport/:schoolId`, the URL the generator opens) and the
team page links to it via the sport prefix. The component reads `:sport`
and `:schoolId` from the route and fetches its own dataset when mounted
outside `SportShell`, so both URL shapes render the same card.

## What is on the card, and where it comes from

Every block is computed from the live dataset the way the team page
computes it, and is omitted (not placeholdered) when the data behind it is
missing.

| Block | Source |
| --- | --- |
| Eyebrow "2026 season · Football" | calendar years of the team's games (`games.json`); `meta.season` when they span two years; sport label from `config/sports.js` |
| School name, mascot, logo, colour band | `schools.json` (+ `TeamLogo`'s mirrored WIAA logo); `colors[0]` is the band and logo ring |
| Overall record, regular/playoff split, PF–PA | `games.json` finals, same W/L/T rules as `TeamPage.computeRecord` (draws count, forfeits count as results) |
| Conference record + place ("1st of 7", "T-2nd of 9") | the `standings.json` table containing the school; shared-rank rule from `StandingsTable` |
| Playoff line | the school's `playoff: true` games via `utils/bracket.js` `buildTeamJourneys`: "Lost Level 2 to Wrightstown 9-0", "Level 3, Nov 6 vs Lomira", "State champions — beat X 21-14" |
| Season leaders (top three) | `season_stats.json` rows for the school through `teamSeasonLeaders` — one leader per display category in the sport's configured order; headline is the category's sort stat ("941 YDS"), the rest of the stat line follows the category label |
| Biggest win / closest game | `games.json` finals with both scores, forfeits excluded (`isForfeitScore`); largest winning margin and smallest absolute margin (ties excluded; closest is dropped when it is the same game as the biggest win) |
| Footer | `SITE.orgName`, `SITE_TITLE`, `SITE.hubUrl` |

Soccer has no stats source, so soccer cards carry no leaders block. A
school whose conference the hub does not model gets no conference block.

## Sharing from the hub

- **Share** uses the Web Share sheet with title, text (the record line) and
  the page URL, falling back to the clipboard and then to a visible URL
  field — the same chain as `utils/share.js`. The URL is built with
  `shareUrlFor`, so it carries the archive `?season=` when one is selected.
- **Save image** appears only when the PNG for this card exists under the
  data base (`data/og/wrapped/<sport>/<schoolId>.png`); until then the
  hint under the card says to screenshot it — and, while the team's
  season is still going, that a PNG is made once it is over, so the page
  never promises a button CI will not deliver yet. The page probes the
  PNG with an `Image` load, so no code change is needed when a card lands.

## Rendering the PNGs

**In CI since 2026-11-05.** `.github/workflows/scrape.yml` runs the
generator inside the "Generate OG share cards" step, right after
`generate_og_cards.py`, against the same locally served `dist/` + `data/`
tree and the same Playwright chromium — once for the story size and once
with `--format og`. Defaults only: every in-season sport, teams whose
season is over, existing PNGs skipped, so a card is rendered once and
never churns while a team is still playing. Both calls are warn-only
(`::warning::`, never a failed run) and the step keeps its
`continue-on-error` and a 15-minute ceiling; a timeout defers the rest to
the next scrape. The PNGs land in `data/og/wrapped/` and go out with the
`data:` commit (`git add data/`), so Pages serves them on the next deploy
and the hub's Save image button lights up — usually within a day of a
team's last game.

To re-render by hand (a late stat upload, a logo fix, or a preview of a
team still playing), run it locally with the widget served somewhere
Playwright can reach — the dev server is simplest:

```bash
cd frontend && npm run dev            # serves http://localhost:5173/wpr-prep-sports

cd scraper && .venv/Scripts/activate  # playwright is in requirements.txt
python scripts/generate_wrapped_cards.py --base-url http://localhost:5173/wpr-prep-sports --dry-run
python scripts/generate_wrapped_cards.py --base-url http://localhost:5173/wpr-prep-sports
python scripts/generate_wrapped_cards.py --base-url http://localhost:5173/wpr-prep-sports --format og
```

What it does:

1. For every sport with a game within 45 days of today (or the sports named
   with `--sport`), loads the current season's `games.json`.
2. Picks each tracked school whose season is over: lost its last playoff
   game; won it with the bracket complete; or played no playoff game and
   the sport's playoffs have begun (or its last game is more than seven
   days old) — and nothing unplayed is left on its schedule. A team with a
   scheduled or score-pending playoff game is skipped.
3. Renders each one through `?theme=light&capture=1#/card/wrapped/<sport>/<school>`,
   waiting for `[data-wrapped-ready]`, fonts and the card's images, and
   screenshots `.wrapped-card`.
4. Writes `data/og/wrapped/<sport>/<schoolId>.png`. Existing files are
   skipped; `--refresh` re-renders them (a late stat upload, a logo fix).

Flags: `--sport` / `--school` (repeatable), `--format story|og`,
`--include-active` (render teams still playing, for previews),
`--limit N`, `--dry-run`, `--route` (hash route template if the mount
point moves). Eight consecutive failures abort the run — that means the
page itself is broken (route not mounted, wrong base path), not a bad
school.

Commit the PNGs with the data (`data:` commit) so Pages serves them and
the hub's Save image button lights up. In CI this is the scrape
workflow's commit step; locally, commit `data/og/wrapped/` yourself.

Use `--refresh` sparingly from CI's point of view: the workflow skips
existing files, so a hand-rendered card stays as rendered until someone
refreshes it again.

## Gotchas

- The card is a fixed-pixel raster (literal sizes and colours, like
  `OgCard.css`); it does not use the `--fs-*` scale and never flips to
  dark. The hub toolbar around it does use the theme tokens.
- In the hub the card is scaled with `transform`, so an element screenshot
  of the hub view would be downscaled — always render with `?capture=1`.
- The story layout clips the body (leaders + games) rather than drawing
  over the footer if a sport ever produces taller content than budgeted;
  the OG layout does the same on its right column. If a block goes
  missing on a card, that is why — tighten the sizes in `WrappedCard.css`.
- WIAA posts forfeits as 1-0 / 2-0 finals; they count in the record but
  never as biggest win or closest game.
