/**
 * Sharing a view out of the widget.
 *
 * Always builds against SITE.widgetOrigin rather than window.location.
 * Embedded, the widget's own location is right but a reader's mental model
 * ("the page I'm looking at") is the WPR article, and the article URL can't
 * carry which game they were on. The canonical widget URL can, and it's the
 * one with per-game Open Graph cards behind it, so it previews properly in
 * a text message or on Facebook — which is most of how this travels.
 */

import { SITE } from "../config/site.js";

const BASE = SITE.widgetOrigin.replace(/[?#].*$/, "").replace(/\/$/, "");

/** Absolute widget URL for a hash route ("/football/game/xyz"). */
export function shareUrlFor(route) {
  const path = String(route ?? "").replace(/^#/, "");
  return path ? `${BASE}/#${path.startsWith("/") ? path : `/${path}`}` : `${BASE}/`;
}

/**
 * Share a URL, preferring whatever the platform actually offers.
 *
 * Order matters and each step can fail for reasons we can't detect up
 * front, so this reports which one succeeded and lets the caller show the
 * right feedback:
 *
 *   "shared"  — native share sheet (phones; also the only path that can
 *               reach Messages/WhatsApp, where this audience actually sends
 *               things)
 *   "copied"  — clipboard
 *   "manual"  — neither was permitted; caller should show the URL to copy
 *               by hand
 *
 * Both APIs are gated by Permissions Policy in a cross-origin iframe, and
 * sports.<publisher> is cross-origin to www.<publisher> for that purpose
 * even though it is same-SITE for cookies. The embed snippet in the README
 * grants them via allow="clipboard-write; web-share" — but a publisher
 * pasting a hand-rolled iframe won't, so "manual" is a real path, not a
 * theoretical one.
 */
export async function shareLink({ url, title }) {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (err) {
      // AbortError = the reader dismissed the sheet. That's a completed
      // interaction, not a failure to fall through on — copying to their
      // clipboard after they backed out would be surprising.
      if (err && err.name === "AbortError") return "dismissed";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "manual";
  }
}
