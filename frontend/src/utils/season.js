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

const KEY = "wpr-season-view";

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
