import { playoffRoundsInOrder } from "./bracket.js";

/**
 * Week selection: pick the current school week if it has games, else fall
 * back to the most-recent week with games (so the "This Week" section is
 * never empty during the off-season).
 *
 * "Week" here is Monday-through-Sunday in US/Central. Football is Fri/Sat
 * concentrated; using Mon-Sun keeps a Friday game and a Saturday makeup
 * game in the same bucket.
 */

/** Monday 00:00 (local clone) of the school week containing `d` —
 * exported for Player of the Week's week bucketing. */
export function startOfSchoolWeek(d) {
  return startOfWeekISO(d);
}

function startOfWeekISO(d) {
  // Clone in Central time. We use UTC math here purely for stability —
  // the difference between "Monday in Central" and "Monday in UTC" is
  // <24h and we only use this to group games which already carry their
  // own Central-time stamp.
  const clone = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = clone.getDay(); // 0=Sun, 1=Mon, ...
  const diff = (day + 6) % 7; // days since Monday
  clone.setDate(clone.getDate() - diff);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function endOfWeek(start) {
  const e = new Date(start);
  e.setDate(e.getDate() + 7);
  return e;
}

/** Pick the week to feature. */
export function pickFeaturedWeek(games, now = new Date()) {
  if (!games || games.length === 0) return null;

  const currentStart = startOfWeekISO(now);
  const currentEnd = endOfWeek(currentStart);
  const currentGames = games.filter((g) => {
    const t = new Date(g.date).getTime();
    return t >= currentStart.getTime() && t < currentEnd.getTime();
  });
  if (currentGames.length > 0) {
    return { start: currentStart, end: currentEnd, games: currentGames, isCurrent: true };
  }

  // Off-season fallback: the most recent week BEFORE now that had games —
  // not simply the newest game, which with a published future schedule
  // would be the season's final week. Pure preseason (nothing before now)
  // falls forward to the soonest week ahead instead.
  const times = games
    .map((g) => new Date(g.date).getTime())
    .filter(Number.isFinite);
  if (times.length === 0) return null;
  const past = times.filter((t) => t < currentStart.getTime());
  const anchorT = past.length > 0 ? Math.max(...past) : Math.min(...times);
  const weekStart = startOfWeekISO(new Date(anchorT));
  const weekEnd = endOfWeek(weekStart);
  const weekGames = games.filter((g) => {
    const t = new Date(g.date).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  });
  return { start: weekStart, end: weekEnd, games: weekGames, isCurrent: false };
}

/**
 * The school week before the one containing `now`, reduced to its finals:
 * the midweek "Last Week" block on the dashboard. Monday through Thursday
 * the current week has no results yet, so the most-asked question ("did we
 * win Friday?") is answered here instead of four screens down the page
 * (critique run 18). Null when that week had no finals.
 */
export function previousWeekResults(games, now = new Date()) {
  const currentStart = startOfWeekISO(now);
  const start = new Date(currentStart);
  start.setDate(start.getDate() - 7);
  const finals = (games ?? []).filter((g) => {
    if (g.status !== "final") return false;
    const t = new Date(g.date).getTime();
    return t >= start.getTime() && t < currentStart.getTime();
  });
  if (finals.length === 0) return null;
  return { start, end: currentStart, games: finals, isCurrent: false };
}

/** Group games by ISO date string (yyyy-mm-dd). */
export function groupByDay(games) {
  const map = new Map();
  for (const g of games) {
    const day = g.date.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(g);
  }
  const sorted = [...map.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return sorted;
}

/**
 * Split one day's games for the week grid: playoff games grouped by round
 * in bracket order (utils/bracket.js), regular-season games left as they
 * were for the conference buckets. In October a playoff Friday used to
 * file "Marshfield at Monona Grove" under "Wisconsin Valley" with no
 * round anywhere on the row.
 *
 * Within a round, home-region games lead, then games with more tracked
 * sides, then kickoff time; ties keep schedule-file order. A playoff game
 * with no round name groups under "Playoffs", after the named rounds.
 *
 * Returns { rounds: [{ round, games }], regular: [game] }.
 */
export function splitPlayoffRounds(games, homeRegionIds = null) {
  const byRound = new Map();
  const regular = [];
  for (const g of games ?? []) {
    if (!g.playoff) {
      regular.push(g);
      continue;
    }
    const r = g.playoff_round || "Playoffs";
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(g);
  }
  const order = playoffRoundsInOrder(games);
  const rank = (r) => {
    const i = order.indexOf(r);
    return i < 0 ? order.length : i;
  };
  const local = (g) =>
    homeRegionIds
      ? (homeRegionIds.has(g.home.school_id) ? 1 : 0) + (homeRegionIds.has(g.away.school_id) ? 1 : 0)
      : 0;
  const tracked = (g) => (g.home.school_id ? 1 : 0) + (g.away.school_id ? 1 : 0);
  const rounds = [...byRound.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([round, list]) => ({
      round,
      games: list
        .map((g, i) => ({ g, i }))
        .sort(
          (a, b) =>
            local(b.g) - local(a.g) ||
            tracked(b.g) - tracked(a.g) ||
            new Date(a.g.date).getTime() - new Date(b.g.date).getTime() ||
            a.i - b.i,
        )
        .map(({ g }) => g),
    }));
  return { rounds, regular };
}
