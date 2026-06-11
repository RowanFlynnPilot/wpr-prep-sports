/**
 * Privacy-friendly analytics via GoatCounter — cookie-less, no PII,
 * GDPR-safe without a consent banner, and it works inside the WPR
 * iframe embed.
 *
 * Entirely config-driven: set VITE_GOATCOUNTER_URL at build time to
 * the site's count endpoint (e.g. https://wpr-sports.goatcounter.com/count).
 * When unset (local dev, forks), everything here is a no-op.
 *
 * The deploy workflow passes the repo variable GOATCOUNTER_URL through,
 * so turning analytics on is: create the GoatCounter site, set the repo
 * variable, re-run Deploy. See docs/analytics.md.
 *
 * HashRouter caveat: GoatCounter's auto-pageview fires once on load and
 * normally records location.pathname, which is always /wpr-prep-sports/
 * here. We disable auto-collection and count explicitly on every route
 * change, reporting the LOGICAL path ("/volleyball/game/<id>") so
 * reports group by widget page rather than one flat URL.
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const ENDPOINT = import.meta.env.VITE_GOATCOUNTER_URL || null;

export const analyticsEnabled = Boolean(ENDPOINT);

let scriptLoaded = false;

function ensureScript() {
  if (!ENDPOINT || scriptLoaded || typeof document === "undefined") return;
  scriptLoaded = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = ENDPOINT;
  // no_onload: we count route changes ourselves (hash-router SPA).
  s.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  document.head.appendChild(s);
}

/** Count one pageview for a logical in-widget path. */
function countPageview(path) {
  if (!ENDPOINT) return;
  ensureScript();
  // count.js exposes window.goatcounter once loaded; queue is not
  // needed — early pageviews before the script lands are rare (first
  // route fires again on data load) and not worth a shim.
  if (window.goatcounter?.count) {
    window.goatcounter.count({ path, event: false });
  }
}

/**
 * Count a named event (sponsor clicks, pick'em plays, …). Events are
 * additive inventory metrics — safe to call unconditionally; no-op
 * when analytics is off.
 */
export function trackEvent(name) {
  if (!ENDPOINT) return;
  ensureScript();
  if (window.goatcounter?.count) {
    window.goatcounter.count({ path: name, event: true });
  }
}

/**
 * Hook: one pageview per route change. Mount once, inside the Router.
 * The reported path is the hash route ("/volleyball", "/football/game/
 * <id>") — the thing WPR actually wants to know readers look at.
 */
export function useAnalyticsPageviews() {
  const location = useLocation();
  useEffect(() => {
    countPageview(location.pathname);
  }, [location.pathname]);
}
