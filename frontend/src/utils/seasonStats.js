/**
 * Helpers over the season_stats.json dataset.
 *
 * All sport-specific behavior (which categories to surface, what to sort
 * by, how to format a stat line, what position label to badge) lives in
 * `sportConfig.stats.categories` — see frontend/src/config/sports.js.
 * This module is the runtime that consumes that config.
 *
 * Bound's season stats include a synthetic "Team" row in each category
 * that aggregates the whole team — useful for some analytics but noise
 * for player leaderboards. We filter those out by name match.
 *
 * Numbers come back as strings ("YDS": "1247") because Bound mixes types
 * across categories (e.g. PCT is "59.7%"); parse on read.
 */

const TEAM_ROW_NAME = "Team";

function isPlayer(row) {
  return row && row.player_name && row.player_name !== TEAM_ROW_NAME;
}

function toNum(value) {
  if (value == null) return NaN;
  const n = parseFloat(String(value).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function sortBy(rows, key) {
  // Coerce missing/non-numeric values to -Infinity so they sort last.
  // Plain NaN subtraction returns NaN and yields non-transitive
  // comparisons, which made volleyball Assists leaders show players
  // whose row had no AST key at all (their NaN ties beat real leaders).
  const val = (r) => {
    const n = toNum(r.stats?.[key]);
    return Number.isFinite(n) ? n : -Infinity;
  };
  return [...rows].sort((a, b) => val(b) - val(a));
}

/** Group raw rows by school_id, returning a Map. */
export function indexBySchool(rows) {
  const map = new Map();
  for (const r of rows ?? []) {
    if (!isPlayer(r)) continue;
    if (!map.has(r.school_id)) map.set(r.school_id, []);
    map.get(r.school_id).push(r);
  }
  return map;
}

/**
 * One leader per configured display-category for a single team.
 * Returns [{ category, row }] in the sport's display order. Empty
 * categories (no players) are silently skipped.
 */
export function teamSeasonLeaders(rows, sportConfig) {
  const cats = sportConfig?.stats?.categories ?? [];
  const out = [];
  for (const cat of cats) {
    const inCat = (rows ?? []).filter(
      (r) => isPlayer(r) && r.category === cat.rawCategory,
    );
    if (inCat.length === 0) continue;
    const leader = sortBy(inCat, cat.sortKey)[0];
    if (leader) out.push({ category: cat, row: leader });
  }
  return out;
}

/**
 * Top N players across the entire dataset for a single display category.
 * Used by the dashboard "Top Performers" section.
 */
export function topPerformers(rows, category, n = 5) {
  const inCat = (rows ?? []).filter(
    (r) => isPlayer(r) && r.category === category.rawCategory,
  );
  return sortBy(inCat, category.sortKey).slice(0, n);
}

/** Render a stat-row's stats dict into a compact one-line summary. */
export function formatStatsLine(category, stats) {
  if (!category?.formatLine) return "";
  try {
    return category.formatLine(stats ?? {}) ?? "";
  } catch {
    return "";
  }
}

export function positionFor(category) {
  return category?.position ?? "";
}
