/** Game selection helpers used by the Hero and Ticker. */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Headline stat lines for a game — the first line per (team, category).
 * Post-split data carries these as `headline_stats` on the slim game;
 * pre-split data still has the full `stat_leaders` inline, whose first
 * line per (team, category) is identical. Full box scores live in
 * per-game files (see fetchBoxscore) — only GamePage needs those.
 */
export function topStatLines(game) {
  return game?.headline_stats ?? game?.stat_leaders ?? [];
}

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
 *   1. The next slate of upcoming games (status=scheduled) within the next 7
 *      days, preferring one from the publisher's home region — see below.
 *   2. Most recent final between two tracked schools (rivalry / conference).
 *   3. Most recent final involving any tracked school.
 *   4. null if there are no games at all.
 *
 * `preferIds` biases step 1 toward the home region WITHOUT breaking the
 * "Up Next" label above the card. Coverage spans whole conferences so
 * standings are complete, which means the chronologically next game can be
 * two schools on the Michigan border — accurate, and no reason for a Wausau
 * reader to care. So the preference applies only WITHIN the earliest day
 * that has games: the card still shows a game from the next slate, just the
 * one this audience has a stake in. On the 2026 football opener that turns
 * Tri-County at Hurley (5:00 PM) into Wausau West at Menomonie (7:00 PM) —
 * same night either way.
 *
 * Deliberately never reaches past that day. Skipping tomorrow's game to
 * feature one on Saturday would make the eyebrow a lie, and a wrong label
 * costs more than a less local matchup.
 *
 * `excludeId` is the game already showing as Game of the Week directly
 * above. Both cards prefer the best local game on the same slate, so
 * without this they pick the same one and the page's two biggest slots
 * carry one matchup. Only ever skips that single game, and only while
 * another local one exists on the day.
 */
export function pickFeaturedGame(
  games,
  now = new Date(),
  preferIds = null,
  excludeId = null,
) {
  if (!games || games.length === 0) return null;

  const upcoming = games
    .filter((g) => g.status === "scheduled")
    .map((g) => ({ g, ts: new Date(g.date).getTime() }))
    .filter(({ ts }) => ts >= now.getTime() && ts - now.getTime() < 7 * DAY_MS)
    .sort((a, b) => a.ts - b.ts);
  if (upcoming.length > 0) {
    if (preferIds && preferIds.size > 0) {
      // Same slice the schedule groups on, so "day" means the same thing here
      // as it does in the list below the hero.
      const firstDay = upcoming[0].g.date.slice(0, 10);
      const locals = upcoming.filter(
        ({ g }) =>
          g.date.slice(0, 10) === firstDay &&
          (preferIds.has(g.home.school_id) || preferIds.has(g.away.school_id)),
      );
      // Prefer a local game the marquee isn't already showing; if that game
      // is the only local one, showing it here too still beats dropping to
      // a matchup from the other end of the state.
      const local =
        locals.find(({ g }) => g.id !== excludeId) ?? locals[0];
      if (local) return local.g;
    }
    return upcoming[0].g;
  }

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
 *   - Any final within the last `windowDays` (most recent first)
 *   - Plus any in_progress/scheduled through tomorrow
 * The upper bound matters when `now` is anchored to the season opener
 * (preseason): without it every future scheduled game would flood in.
 */
export function tickerGames(games, now = new Date(), windowDays = 7) {
  if (!games) return [];
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const horizon = now.getTime() + DAY_MS;
  return games
    .filter((g) => {
      const ts = new Date(g.date).getTime();
      return ts >= cutoff && ts <= horizon;
    })
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
