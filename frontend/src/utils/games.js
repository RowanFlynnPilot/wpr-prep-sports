/** Game selection helpers used by the Hero and Ticker. */

const DAY_MS = 24 * 60 * 60 * 1000;
// How long a home-region final leads the hero before the next preview
// takes over: Saturday through Monday after a Friday slate.
const RESULT_LEAD_MS = 72 * 60 * 60 * 1000;

// WIAA records forfeits as 1-0 (basketball sometimes 2-0) finals —
// impossible on-field scores in those sports. Same rule recap.js uses to
// phrase them; soccer/hockey 1-0s are real games and never match here.
export function isForfeitScore(game) {
  const h = game?.home?.score;
  const a = game?.away?.score;
  if (typeof h !== "number" || typeof a !== "number") return false;
  const hi = Math.max(h, a);
  const lo = Math.min(h, a);
  if (game.sport === "football") return hi === 1 && lo === 0;
  if ((game.sport ?? "").includes("basketball")) return (hi === 1 || hi === 2) && lo === 0;
  return false;
}

/**
 * A scheduled game whose kickoff is well past (36h) with no result is
 * postponed or unreported — its stale "7:00 PM" days later reads like a
 * glitch, and "Upcoming" is simply false. Every surface that labels a
 * game's status should agree on this, so it lives here.
 */
export const STALE_SCHEDULED_MS = 36 * 60 * 60 * 1000;
export function isStaleScheduled(game, now = Date.now()) {
  if (!game || game.status === "final" || game.status === "in_progress") return false;
  return now - new Date(game.date).getTime() > STALE_SCHEDULED_MS;
}

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
  const nowTs = now.getTime();

  // Lead with the RESULT for three days after a slate. The reader's
  // Saturday-through-Monday question is "did we win?", not "who's next?"
  // — the hero used to answer the second one all week, and Friday's
  // home-region score sat thousands of pixels down the page. Among the
  // most recent day's local finals, conference games first, then the
  // closest margin. Falls through to the preview pick after 72 hours.
  if (preferIds && preferIds.size > 0) {
    const localSides = (g) =>
      (preferIds.has(g.home.school_id) ? 1 : 0) + (preferIds.has(g.away.school_id) ? 1 : 0);
    const recentLocal = games
      .filter((g) => g.status === "final" && g.home.score != null && g.away.score != null)
      // A forfeit is a result, not a story — never the lead.
      .filter((g) => !isForfeitScore(g))
      .filter((g) => localSides(g) > 0)
      .map((g) => ({ g, ts: new Date(g.date).getTime() }))
      .filter(({ ts }) => ts <= nowTs && nowTs - ts < RESULT_LEAD_MS);
    if (recentLocal.length > 0) {
      const days = recentLocal.map(({ g }) => g.date.slice(0, 10)).sort();
      const latestDay = days[days.length - 1];
      // Stakes first (conference game, both sides local), then the
      // closest margin — the tightest local rivalry result leads.
      const stakes = (g) => (g.conference_game ? 2 : 0) + (localSides(g) === 2 ? 1 : 0);
      const lead = recentLocal
        .filter(({ g }) => g.date.slice(0, 10) === latestDay)
        .sort(
          (a, b) =>
            stakes(b.g) - stakes(a.g) ||
            Math.abs(a.g.home.score - a.g.away.score) - Math.abs(b.g.home.score - b.g.away.score),
        )[0];
      if (lead) return lead.g;
    }
  }

  const upcoming = games
    .filter((g) => g.status === "scheduled")
    .map((g) => ({ g, ts: new Date(g.date).getTime() }))
    .filter(({ ts }) => ts >= nowTs && ts - nowTs < 7 * DAY_MS)
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
