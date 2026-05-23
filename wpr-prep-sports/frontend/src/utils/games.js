/** Game selection helpers used by the Hero and Ticker. */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Most recent final between two TRACKED schools (both have school_id). */
function isRivalryFinal(g) {
  return (
    g.status === "final" &&
    g.home.school_id &&
    g.away.school_id
  );
}

/**
 * Pick the most "feature-worthy" game.
 *
 * Priority order:
 *   1. The very next upcoming game (status=scheduled) within the next 7 days
 *      involving any tracked school — Friday night spotlight.
 *   2. Most recent final between two tracked schools (rivalry / conference).
 *   3. Most recent final involving any tracked school.
 *   4. null if there are no games at all.
 */
export function pickFeaturedGame(games, now = new Date()) {
  if (!games || games.length === 0) return null;

  const upcoming = games
    .filter((g) => g.status === "scheduled")
    .map((g) => ({ g, ts: new Date(g.date).getTime() }))
    .filter(({ ts }) => ts >= now.getTime() && ts - now.getTime() < 7 * DAY_MS)
    .sort((a, b) => a.ts - b.ts);
  if (upcoming.length > 0) return upcoming[0].g;

  const finals = games
    .filter((g) => g.status === "final")
    .map((g) => ({ g, ts: new Date(g.date).getTime() }))
    .sort((a, b) => b.ts - a.ts);

  const rivalry = finals.find(({ g }) => isRivalryFinal(g));
  if (rivalry) return rivalry.g;

  return finals[0]?.g ?? null;
}

/**
 * Games to show in the ticker. We surface "recently completed + tonight":
 *   - Any final within the last 7 days (most recent first)
 *   - Plus any in_progress/scheduled in the same window
 */
export function tickerGames(games, now = new Date(), windowDays = 7) {
  if (!games) return [];
  const cutoff = now.getTime() - windowDays * DAY_MS;
  return games
    .filter((g) => new Date(g.date).getTime() >= cutoff)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** Group games by ISO date (yyyy-mm-dd). */
export function groupByDate(games) {
  const map = new Map();
  for (const g of games) {
    const day = g.date.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(g);
  }
  return map;
}
