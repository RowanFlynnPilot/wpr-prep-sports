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
