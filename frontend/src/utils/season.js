/**
 * Season view selection — lets a reader (or the sales rep mid-demo)
 * flip the whole widget between the live season and an archived one.
 *
 * The choice lives in sessionStorage and applies via full page reload:
 * every dataset fetch in the session then resolves against
 * data/archive/<season>/ instead of data/. Crude on purpose — a reload
 * resets all in-memory state so no component needs to know seasons can
 * change mid-session.
 *
 * Boot override: `?season=2025-26` in the query (before the hash) sets
 * the view — a shareable demo link, same pattern as ?theme=.
 * `?season=live` (or `current`) resets.
 */

import { SITE } from "../config/site.js";

const KEY = `${SITE.storagePrefix}-season-view`;

/** Archived seasons available on Pages (data/archive/<season>/). */
export const ARCHIVE_SEASONS = ["2025-26"];

function readBootParam() {
  try {
    const v = new URLSearchParams(window.location.search).get("season");
    if (!v) return;
    if (ARCHIVE_SEASONS.includes(v)) sessionStorage.setItem(KEY, v);
    else if (v === "live" || v === "current") sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
readBootParam();

/** "live" or an entry of ARCHIVE_SEASONS. */
export function selectedSeason() {
  try {
    const v = sessionStorage.getItem(KEY);
    return ARCHIVE_SEASONS.includes(v) ? v : "live";
  } catch {
    return "live";
  }
}

export function isArchiveView() {
  return selectedSeason() !== "live";
}

/** Switch view and reload so every fetch re-resolves. */
export function setSelectedSeason(season) {
  try {
    if (ARCHIVE_SEASONS.includes(season)) sessionStorage.setItem(KEY, season);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/**
 * The WIAA school year containing a date — "2025-26" for anything from
 * August 2025 through July 2026. August is the boundary because that is
 * when football, the first sport, opens.
 */
export function seasonForDate(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = month >= 8 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Where to find a game that isn't in the current dataset.
 *
 * Game ids carry their own date — "football-2025-10-17-wausau-west-at-
 * marshfield" — so a link shared during last season can be resolved to the
 * archive that actually holds it rather than dumped on today's dashboard.
 * Returns null when the date is unreadable or that season was never
 * archived, so callers can fall back to a plain apology.
 *
 * Uses the `?season=` boot param (a full reload) because that is how the
 * whole archive view works: every fetch in the session re-resolves against
 * data/archive/<season>/. See the note at the top of this file.
 */
export function archiveLocationForGame(gameId, sportPrefix) {
  const m = /^[a-z_]+-(\d{4}-\d{2}-\d{2})-/.exec(String(gameId ?? ""));
  if (!m) return null;
  const season = seasonForDate(m[1]);
  if (!season || !ARCHIVE_SEASONS.includes(season)) return null;
  const base = window.location.pathname;
  return { season, href: `${base}?season=${season}#${sportPrefix}/game/${gameId}` };
}
