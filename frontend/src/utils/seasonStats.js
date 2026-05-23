/**
 * Helpers over the season_stats.json dataset.
 *
 * Bound's season stats include a synthetic "Team" row in each category that
 * aggregates the whole team — useful for some analytics but noise for
 * player leaderboards. We filter those out by name match.
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

/**
 * Format a raw stat string with thousands separators when it parses as
 * a number. Leaves non-numeric values (like "59.7%" or "141/211") as-is.
 * Strips any commas already present so we don't double-encode.
 */
function withCommas(value) {
  if (value == null || value === "") return value;
  const str = String(value);
  // Already-fractional or already-percent values pass through untouched.
  if (str.includes("/") || str.includes("%")) return str;
  const cleaned = str.replace(/,/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return str;
  // Preserve "1.5" decimals (tackles, sacks) — only format the integer part.
  if (cleaned.includes(".")) {
    const [whole, frac] = cleaned.split(".");
    return `${parseInt(whole, 10).toLocaleString("en-US")}.${frac}`;
  }
  return parseInt(cleaned, 10).toLocaleString("en-US");
}

const CATEGORY_SORT_KEY = {
  Passing: "YDS",
  Rushing: "YDS",
  Receiving: "YDS",
  Defense: "TOT",
};

/** Sort a stat-row list by the canonical leader metric for its category. */
function sortLeaders(rows, category) {
  const key = CATEGORY_SORT_KEY[category] ?? "YDS";
  return [...rows].sort((a, b) => toNum(b.stats?.[key]) - toNum(a.stats?.[key]));
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
 * Top leader per category for one school. Returns at most one row per
 * category (Passing, Rushing, Receiving, Defense), in display order.
 */
export function teamSeasonLeaders(rows) {
  const out = [];
  for (const cat of ["Passing", "Rushing", "Receiving", "Defense"]) {
    const inCat = (rows ?? []).filter((r) => isPlayer(r) && r.category === cat);
    if (inCat.length === 0) continue;
    const leader = sortLeaders(inCat, cat)[0];
    if (leader) out.push({ category: cat, row: leader });
  }
  return out;
}

/**
 * Top N players across the entire dataset for a single category. Used by
 * the dashboard "Top Performers" section.
 */
export function topPerformers(rows, category, n = 5) {
  const inCat = (rows ?? []).filter(
    (r) => isPlayer(r) && r.category === category,
  );
  return sortLeaders(inCat, category).slice(0, n);
}

const STAT_LINE_FORMAT = {
  Passing: (s) => {
    const yds = s.YDS;
    const tds = s.TDS;
    const ca = s["C/ATT"];
    return [
      yds && `${withCommas(yds)} YDS`,
      tds && `${withCommas(tds)} TD`,
      ca && `${ca}`,
    ].filter(Boolean).join(" · ");
  },
  Rushing: (s) =>
    [
      s.YDS && `${withCommas(s.YDS)} YDS`,
      s.TDS && `${withCommas(s.TDS)} TD`,
      s.CAR && `${withCommas(s.CAR)} CAR`,
    ].filter(Boolean).join(" · "),
  Receiving: (s) =>
    [
      s.YDS && `${withCommas(s.YDS)} YDS`,
      s.TDS && `${withCommas(s.TDS)} TD`,
      s.REC && `${withCommas(s.REC)} REC`,
    ].filter(Boolean).join(" · "),
  Defense: (s) =>
    [
      s.TOT && `${withCommas(s.TOT)} TKL`,
      s.SACKS && parseFloat(s.SACKS) > 0 && `${withCommas(s.SACKS)} SK`,
      s.TFL && parseFloat(s.TFL) > 0 && `${withCommas(s.TFL)} TFL`,
    ].filter(Boolean).join(" · "),
};

/** Render a stat row's stats dict into a compact one-line summary. */
export function formatStatsLine(category, stats) {
  const fn = STAT_LINE_FORMAT[category];
  return fn ? fn(stats ?? {}) : "";
}

const CATEGORY_POSITION = {
  Passing: "QB",
  Rushing: "RB",
  Receiving: "WR",
  Defense: "DEF",
};

export function positionFor(category) {
  return CATEGORY_POSITION[category] ?? "";
}
