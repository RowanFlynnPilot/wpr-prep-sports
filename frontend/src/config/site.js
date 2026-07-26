/**
 * Central site/org configuration — the white-label surface.
 *
 * Every org-specific string the frontend renders (publisher name, URLs,
 * masthead lockup, storage namespaces) lives here; components import
 * SITE instead of hardcoding. A new publisher rebrands by editing this
 * file plus public/<logoFile> — see docs/white-label.md.
 *
 * PURE DATA — no import.meta.env in this module: the weekly digest
 * (scripts/build-digest.mjs) imports it from plain Node. Env overrides
 * (e.g. VITE_SPONSOR_EMAIL) are applied at the point of use.
 *
 * Defaults are the Wausau Pilot & Review production values.
 */
export const SITE = {
  // Publisher
  orgName: "Wausau Pilot & Review",
  orgShort: "WPR",
  orgHomeUrl: "https://wausaupilotandreview.com",
  orgSportsUrl: "https://wausaupilotandreview.com/category/sports/",
  orgDomain: "wausaupilotandreview.com", // shown on OG share cards
  photoSubmitUrl: "https://wausaupilotandreview.com/submit-prep-sports-photo/",
  contactEmail: "advertising@wausaupilotandreview.com", // VITE_SPONSOR_EMAIL overrides
  logoFile: "wpr-logo.png", // under frontend/public/

  // Widget identity — masthead renders `${titleLead} <em>${titleEm}</em>`
  titleLead: "Central Wisconsin",
  titleEm: "Prep Sports",
  regionLabel: "central Wisconsin", // prose mentions ("...where central Wisconsin checks the score")
  regionShort: "central-WI",
  // Canonical hosted URL (embed builder, digest links, OG card URLs).
  // Served from a subdomain of the publisher's own site on purpose: that
  // makes the widget's iframe SAME-SITE with the host page, so browsers
  // don't partition its localStorage and Safari/ITP doesn't expire it —
  // which is what keeps Pick'em picks (and favorites) from silently
  // vanishing. See docs/favorites-spec.md.
  widgetOrigin: "https://sports.wausaupilotandreview.com/",

  // One-line pitch. Used for <meta name="description"> and for the
  // Open Graph / Twitter card that Facebook, X, iMessage and Slack render
  // when a reader shares the widget — which, for local high-school sports,
  // is most of how it travels. Injected into index.html at build time by
  // the socialTags() plugin in vite.config.js, so this stays the only copy.
  shareDescription:
    "Live scores, full schedules, conference standings, and player stats for " +
    "central Wisconsin high school sports — football, basketball, volleyball, " +
    "hockey, and soccer across 67 schools.",
  // 1200x630 share image in frontend/public/. Regenerate after a rebrand
  // with `python scraper/scripts/generate_site_card.py`.
  shareImage: "og-card.png",

  // Coverage
  governingBody: "WIAA", // state association label in UI copy ("WIAA Tournament", "Data via WIAA")
  timeZone: "America/Chicago",

  // Namespaces. CAUTION: changing these on an existing deployment
  // orphans readers' saved picks (localStorage) and breaks host-page
  // resize listeners (postMessage type) — set once per tenant, before
  // launch.
  messageNamespace: "wpr-prep-sports", // postMessage type prefix + console tag
  storagePrefix: "wpr", // localStorage/sessionStorage key prefix

  // Weekly digest email palette (inline styles — email clients can't
  // read CSS custom properties). Matches the monochrome + press-red
  // site theme.
  digest: {
    ink: "#0e0f12",
    heading: "#111111",
    rule: "#cc1818",
    link: "#cc1818",
    mutedRule: "#dddddd",
  },
};

/** "Central Wisconsin Prep Sports" — the flat one-line widget name. */
export const SITE_TITLE = `${SITE.titleLead} ${SITE.titleEm}`;

/** Browser-tab title; index.html carries the static fallback. */
export const DOC_TITLE = `${SITE.titleLead} High School Sports — ${SITE.orgName}`;
