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
import { selectedSeason } from "./season.js";

const BASE = SITE.widgetOrigin.replace(/[?#].*$/, "").replace(/\/$/, "");

/**
 * Absolute widget URL for a hash route ("/football/game/xyz").
 *
 * Carries the archive season when the sharer is viewing one. Without it the
 * link silently reproduces a different page than the one they were looking
 * at: a team page would show this season's record instead of the one on
 * their screen, and a game from an archived season isn't in the live
 * dataset at all — the recipient would land on the not-found panel and have
 * to click through to the archive themselves. The `?season=` boot param
 * already exists as a shareable pointer; this just stops dropping it.
 */
export function shareUrlFor(route) {
  const path = String(route ?? "").replace(/^#/, "");
  const season = selectedSeason();
  const query = season && season !== "live" ? `?season=${encodeURIComponent(season)}` : "";
  const hash = path ? `#${path.startsWith("/") ? path : `/${path}`}` : "";
  return `${BASE}/${query}${hash}`;
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
