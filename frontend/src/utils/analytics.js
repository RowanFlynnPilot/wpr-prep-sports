/**
 * Privacy-friendly analytics via Plausible — cookie-less, no PII,
 * GDPR-safe without a consent banner, works inside the WPR iframe
 * embed, and matches the WPR widget suite's existing Plausible account
 * (the Brewers tool reports there too).
 *
 * Entirely config-driven: set VITE_PLAUSIBLE_DOMAIN at build time to
 * the site identifier registered in Plausible (e.g.
 * "prep-sports.wausaupilotandreview.com" — the string is an account-
 * side label and doesn't have to be a real DNS name). When unset
 * (local dev, forks), everything here is a no-op.
 *
 * The deploy workflow passes the repo variable PLAUSIBLE_DOMAIN
 * through, so turning analytics on is: add the site in Plausible, set
 * the repo variable, re-run Deploy. See docs/analytics.md.
 *
 * We load Plausible's `script.hash.js` variant: it counts the initial
 * load AND every hash-route change automatically, so the HashRouter
 * SPA needs no manual pageview plumbing. Pageviews appear in the
 * dashboard with their full hash path ("/wpr-prep-sports/#/volleyball/
 * game/<id>"). Plausible ignores localhost by default, so dev traffic
 * never pollutes the numbers.
 */

import { useEffect } from "react";

const DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN || null;
// Plausible's 2025+ per-site script id (e.g. "pa-AbC123"). Sites created
// under their newer install flow ingest through this script; the legacy
// data-domain script can post events that such sites silently discard
// (202 either way — found out the empirical way, launch week 2026).
// When set, this wins over the legacy path below.
const SCRIPT_ID = import.meta.env.VITE_PLAUSIBLE_SCRIPT_ID || null;
// Override for a self-hosted Plausible instance; cloud by default.
const SCRIPT_SRC =
  import.meta.env.VITE_PLAUSIBLE_SRC || "https://plausible.io/js/script.hash.js";

export const analyticsEnabled = Boolean(SCRIPT_ID || DOMAIN);

let scriptLoaded = false;

function ensureScript() {
  if (!analyticsEnabled || scriptLoaded || typeof document === "undefined") return;
  scriptLoaded = true;
  // Official queue shim — trackEvent calls made before the script
  // lands are buffered and flushed when it loads.
  window.plausible =
    window.plausible ||
    function () {
      (window.plausible.q = window.plausible.q || []).push(arguments);
    };
  const s = document.createElement("script");
  if (SCRIPT_ID) {
    // New-style per-site script: options go through init() (stashed on
    // plausible.o for the script to read on load — the official snippet
    // shape). hashBasedRouting replaces the legacy script.hash.js
    // variant so hash-route changes still count as pageviews.
    window.plausible.init =
      window.plausible.init ||
      function (opts) {
        window.plausible.o = opts || {};
      };
    s.async = true;
    s.src = `https://plausible.io/js/${SCRIPT_ID}.js`;
    document.head.appendChild(s);
    window.plausible.init({ hashBasedRouting: true });
    return;
  }
  s.defer = true;
  s.src = SCRIPT_SRC;
  s.dataset.domain = DOMAIN;
  document.head.appendChild(s);
}

/**
 * Count a named event (sponsor clicks, pick'em plays, …). Events are
 * additive inventory metrics — safe to call unconditionally; no-op
 * when analytics is off. Shows up under Goals in the Plausible
 * dashboard once the event name is added as a custom-event goal.
 */
export function trackEvent(name, props = undefined) {
  if (!DOMAIN) return;
  ensureScript();
  window.plausible(name, props ? { props } : undefined);
}

/**
 * Hook: inject the Plausible script once on mount. Pageview tracking
 * (initial load + hash-route changes) is automatic from there.
 */
export function useAnalytics() {
  useEffect(() => {
    ensureScript();
  }, []);
}
