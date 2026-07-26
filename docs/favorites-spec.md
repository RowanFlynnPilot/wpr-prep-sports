# Favorite schools — feature spec

Status: **shipped** (2026-07-26). Built and merged to main the same day the
spec was written, ahead of the recommended window, because the author had a
narrow stretch of time. Kept as the design record — the reasoning below is
why the feature is shaped the way it is.

The storage foundation this spec argued for **also shipped**: the widget now
serves from `https://sports.wausaupilotandreview.com`, so its iframe is
same-site with the host page and the partitioning / ITP problems described
below no longer apply. The `?favorites=` URL seed stayed anyway — it is
shareable and bookmarkable, which turned out to be worth having on its own.

## Why

The audience is overwhelmingly single-school: a Wausau East parent, an Edgar
grandparent, a Marathon alum. Today every visit starts on a 67-school,
8-sport dashboard and they have to hunt for their team. Favoriting turns the
widget from *a regional scoreboard* into *my kid's team's page*.

Against the tie-breakers in CLAUDE.md:

- **Repeat visits / dwell time** — the strongest lever left. A pinned team
  gives a reason to come back on a Saturday morning rather than only when a
  WPR article links in.
- **Sponsorable surface** — `school:<id>` slots already exist but only fire
  when someone happens to open that team page. A favorites strip shows the
  Wausau East sponsor to people who *self-identified* as Wausau East fans,
  on every visit. That is the highest-intent inventory in the widget and a
  much easier sell than a generic impression.
- **Central-WI specificity** — favorites are per *school*, and Wisconsin
  schools play in different conferences per sport. A single favorite yields
  a personalized cross-sport view (football in October, basketball in
  January) that no national site does for this region.

## Storage: what the testing found

> **Resolved.** This section describes the situation *before* the widget
> moved to `sports.wausaupilotandreview.com` on 2026-07-26. On a subdomain
> of the host site the iframe is same-site, so none of the partitioning or
> expiry below applies. Kept because it is the reasoning that justified the
> move — and because it applies again immediately if anyone serves the
> widget from a third-party origin.

At the time, the widget ran in a **third-party iframe** —
`rowanflynnpilot.github.io` inside `wausaupilotandreview.com`. Existing
browser-local state (`utils/pickem.js`, `utils/season.js`) uses
`localStorage` in a try/catch, which fails *silently*.

Measured in Chromium on 2026-07-26 with a cross-site iframe (host on
`localhost`, frame on `127.0.0.1`, so genuinely different sites):

| Check | Result |
|---|---|
| Write in third-party iframe | succeeds |
| Survives host-page reload | **yes** — value persisted |
| `document.hasStorageAccess()` | `true` |
| Visible to a first-party visit to the same origin | **no** — separate bucket |

So storage is **partitioned but durable**: keyed to (top site, frame origin).
Two consequences:

1. Inside the WPR page, favorites persist. Good.
2. The same reader opening the widget directly at the github.io URL sees
   *nothing* — a different bucket. Same if WPR ever embeds on a second
   domain or moves domains.

**Not tested, and the real risk: Safari/iOS.** No Safari available on this
machine. Per documented WebKit policy, ITP caps script-writable storage
(localStorage, IndexedDB) for third-party origins at **7 days** without
first-party interaction. Nobody in this audience will ever visit
`github.io` first-party, so favorites set in August could be silently gone
by September — the worst failure mode, because it looks like the feature
just forgot them.

This likely already affects **Pick'em**: iPhone users may be losing picks
today. Two-minute check: make a pick on an iPhone in the WPR embed, close
the tab, reopen the next day.

### Foundation: serve from a WPR subdomain — DONE 2026-07-26

Because storage partitioning and ITP key on *site* (eTLD+1), an iframe on a
subdomain of the embedding site is **same-site**. Partitioning, the 7-day
cap, and the split-bucket problem disappear at once — for favorites *and*
Pick'em. It also reads better in a share sheet and keeps readers on WPR's
brand.

What was done, for the record (and for a tenant repeating it):

- Cloudflare DNS: `CNAME sports → rowanflynnpilot.github.io`, proxy
  **disabled** (grey cloud). Proxying breaks GitHub's certificate
  provisioning; if it is ever turned on, Cloudflare SSL/TLS must be
  *Full (strict)* or Pages redirects loop.
- GitHub repo → Settings → Pages → custom domain, then Enforce HTTPS once
  the certificate is approved.
- `BASE_PATH=/` repo variable (`deploy.yml` already threads it through as
  `VITE_BASE`); `frontend/public/CNAME` so the domain rides in the artifact.
- `SITE.widgetOrigin` → the new host. It is the single source for the embed
  builder, digest links, and OG card URLs.
- `scrape.yml` derives the OG-card server prefix from `BASE_PATH` instead of
  hardcoding `/wpr-prep-sports`.

Gotcha worth remembering: setting the custom domain makes Pages 301 the old
URL immediately, so the deployed build must be rebuilt with the new base in
the same sitting — otherwise `index.html` resolves but its `/wpr-prep-sports/
assets/*` 404 and the widget serves a blank page.

**Do this first.** Building favorites on partitioned third-party storage
means building it twice.

### If the subdomain isn't available

Ship favorites with a URL fallback regardless — it is cheap and useful on
its own:

- `?favorites=wausau-east,edgar` on the iframe src, read at boot, merged
  with whatever storage holds. Survives every storage restriction, is
  bookmarkable and shareable, and lets WPR link "follow your team" straight
  from an article or newsletter.
- Optionally, postMessage the list up to the host page and let the WordPress
  snippet persist it in first-party storage. WPR controls that snippet, and
  it already validates `origin`/`source` after this session's hardening.
- Do **not** reach for the `pickem-api/` Worker for this — it is still
  human-blocked on a Cloudflare account, and favorites should not need a
  backend or an account.

## Data model

Favorite **schools**, not per-sport teams. One list, cross-sport.

```jsonc
// localStorage key: `${SITE.storagePrefix}-favorites-v1`
{ "schools": ["wausau-east", "edgar"], "updated": "2026-08-05T13:00:00Z" }
```

- Values are `schools.json` ids — already the join key everywhere
  (`school:<id>` sponsor slots, `#/<sport>/team/<id>`, `#/<sport>/embed/<id>`).
- Cap at 5. Enough for a family with kids at two schools plus an alma mater;
  small enough that the pinned strip never becomes a second dashboard.
- Unknown ids are ignored on read, so a school leaving the manifest degrades
  quietly.
- No accounts, no PII, no cookie banner — worth keeping for a nonprofit
  newsroom, and no login friction for a 70-year-old grandparent.

## Surfaces

**1. Pinned strip — "Your Teams", above the hero, below the marquee.**
Reuse the `EmbedPage` card, which already renders record, conference rank,
last/next game, recent form, and that school's sponsor slot. This is
assembly, not invention. Hidden entirely when no favorites are set, so the
default experience is unchanged.

**2. Add/remove control.** A star toggle in the `TeamPage` header, plus a
compact school picker in the strip's empty state. Reachable in one tap from
where someone already is.

**3. Subtle ordering elsewhere** (second pass, only if it earns it):
favorited schools sort first within This Week / standings, with a marker.
Resist reordering standings tables — a conference table out of rank order is
worse than not personalized.

**4. Off-season value.** The strip is the answer to "why open this in July":
next opener, countdown, last season's result. Worth building because the
launch window is precisely an off-season stretch.

## Scope

**In:** pick up to 5 schools; a pinned cross-sport strip; add/remove; URL
param; graceful empty and unknown-id states.

**Out:** accounts, notifications, email digests scoped to favorites,
per-sport favorites, following individual players, cross-device sync.
Notifications in particular need a backend and a permission prompt, and
would sink the timeline.

## Rollout

Do **not** ship in launch week. The punch list just cleared; adding stateful
UI days before go-live trades a known-good launch for a nice-to-have.

Best window is **after go-live, before the first whistle** — roughly Aug 2
to Aug 19. Traffic is low, a bug costs little, and it is proven before the
Friday-night crush. It also gives the countdown stretch something to do.

Suggested order:

1. Custom subdomain + `BASE_PATH=/` (unblocks storage properly; benefits
   Pick'em immediately).
2. Verify on a real iPhone that a Pick'em selection survives overnight.
   This is the gate — if it fails, favorites needs the URL fallback as its
   primary mechanism, not a nicety.
3. Data layer + `utils/favorites.js` with tests, mirroring `pickem.js`.
4. Pinned strip reusing the embed card.
5. Star toggle on team pages.
6. Tell ad ops: `school:<id>` inventory is now materially more valuable, and
   priced accordingly (`docs/advertiser-inventory.md`, `data/pricing.json`).

## Open questions

- Does WPR want the subdomain? It is their DNS and their call; it also
  changes the canonical URL in the digest and embed builder.
- Should the strip appear inside per-school embeds, or only the main widget?
  Leaning only the main widget — article embeds are already scoped.
- Analytics: favoriting is the clearest engagement signal the widget could
  emit, but Plausible is still blocked on Toto's account.
