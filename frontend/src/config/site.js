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
  widgetOrigin: "https://rowanflynnpilot.github.io/wpr-prep-sports/", // canonical hosted URL (embed builder, digest links)

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
