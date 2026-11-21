/** Game selection helpers used by the Hero and Ticker. */

const DAY_MS = 24 * 60 * 60 * 1000;
// How long a home-region final leads the hero before the next preview
// takes over. Was 72h (Saturday through Monday after a Friday slate)
// — which meant the hero silently switched to "Up Next Friday Sep 11"
// on Tuesday morning, three days into the week the last Friday's
// result was still the story. Extended to 5 days so Grandma Deb's
// "did they win?" stays at the top of the page through Wednesday
// evening; the next preview takes over Thursday, when the coming
// Friday's game is about to be its own story.
const RESULT_LEAD_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * WIAA venues arrive prefixed with "@" ("@Lakeland" = "at Lakeland"),
 * which the frontend used to render verbatim — reading like a social
 * handle rather than a stadium location. Strip the "@" and prepend
 * "at". Non-"@" venues (a real stadium name) pass through unchanged.
 */
export function humanizeVenue(v) {
  const s = String(v ?? "").trim();
  return s.startsWith("@") ? `at ${s.slice(1)}` : s;
}

// WIAA records forfeits as 1-0 or 2-0 finals in football and basketball
// (2-0 football seen 2026-09-11: Rib Lake at Elcho/White Lake, a
// called-off game posted as "W 2-0" with no marker) — implausible
// on-field scores in those sports. Same rule recap.js uses to phrase
// them; soccer/hockey 1-0s and volleyball 2-0s are real and never match.
export function isForfeitScore(game) {
  const h = game?.home?.score;
  const a = game?.away?.score;
  if (typeof h !== "number" || typeof a !== "number") return false;
  const hi = Math.max(h, a);
  const lo = Math.min(h, a);
  const sport = game.sport ?? "";
  if (sport === "football" || sport.includes("basketball")) {
    return (hi === 1 || hi === 2) && lo === 0;
  }
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
 * Between kickoff plus a few hours and the 36h "Not reported" line, a
 * scheduled game with no score is neither upcoming nor unreported: it was
 * played and the result hasn't reached WIAA yet. Left as "7:00 PM", ten
 * Tuesday volleyball matches read as tonight's games on Wednesday night
 * (critique run 18). Surfaces say "Score pending" and use the past tense.
 */
export const PENDING_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Between the listed start time and the "Score pending" line, a scheduled
 * game with no live feed is being played right now. Left as "8:00 AM", a
 * state-tournament match that tipped two hours ago still read "Up next"
 * on the hero, the week grid and the mini (state day, 2026-11-05).
 * Surfaces say "Underway" and drop the start time.
 */
export function isUnderway(game, now = Date.now()) {
  if (!game || game.status !== "scheduled") return false;
  const age = now - new Date(game.date).getTime();
  return age >= 0 && age <= PENDING_AFTER_MS;
}

export function isScorePending(game, now = Date.now()) {
  if (!game || game.status !== "scheduled") return false;
  const age = now - new Date(game.date).getTime();
  return age > PENDING_AFTER_MS && age <= STALE_SCHEDULED_MS;
}

/**
 * WIAA occasionally marks a game "final" without posting a score — a
 * dropped upload or a game recorded on paper only. The row is a real
 * matchup but not a real result, so surfaces treat it like the stale-
 * scheduled case: no numerals, no "Final" chip, no fabricated 0-0. Left
 * unguarded, the game page rendered "TeamA null-null TeamB" and the aria-
 * label announced "TeamA 0, TeamB 0, final".
 */
export function isUnreportedFinal(game) {
  if (!game || game.status !== "final") return false;
  return game.home?.score == null || game.away?.score == null;
}

/** Convenience: either of the two "no reliable score to show" states. */
export function isNotReported(game, now = Date.now()) {
  return isStaleScheduled(game, now) || isUnreportedFinal(game);
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

/** The winning and losing sides of a scored final, or null for a tie / no score. */
function finalSides(game) {
  if (game?.status !== "final") return null;
  const h = game.home?.score;
  const a = game.away?.score;
  if (typeof h !== "number" || typeof a !== "number" || h === a) return null;
  return h > a ? { winner: game.home, loser: game.away } : { winner: game.away, loser: game.home };
}

/** A playoff final a tracked team won (it advances). */
export function isTrackedPlayoffWin(game) {
  if (!game?.playoff) return false;
  return !!finalSides(game)?.winner?.school_id;
}

/**
 * A playoff final that ended a tracked team's season and nothing else: the
 * loser is tracked, the winner isn't. (When both are tracked the game is
 * also somebody's win, and the hero tells it that way.) The hero's eyebrow
 * reads "Season over" for these instead of "Final".
 */
export function isTrackedElimination(game) {
  if (!game?.playoff) return false;
  const sides = finalSides(game);
  return !!sides?.loser?.school_id && !sides.winner?.school_id;
}

/** Most recent final between two TRACKED schools (both have school_id). */
/**
 * Margin past which a result is a rout, by sport. A blowout still leads
 * when it is the only local result, but a competitive local game beats it.
 * Volleyball has none: 3-0 is an ordinary sweep, not a story about margin.
 */
const BLOWOUT_MARGIN = {
  football: 28,
  boys_basketball: 25,
  girls_basketball: 25,
  boys_hockey: 5,
  girls_hockey: 5,
  boys_soccer: 4,
  girls_soccer: 4,
};
function blowoutMargin(sport) {
  return BLOWOUT_MARGIN[sport] ?? Number.POSITIVE_INFINITY;
}

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
 * When the first day has no local game at all, it looks ahead (within the
 * seven days) to the first day that does, and the hero's eyebrow reads
 * "Next local game" so the label stays true: a non-local Monday game
 * two hours west used to lead over Tuesday's 18-game local opener.
 *
 * `excludeId` is the game already showing as Game of the Week directly
 * above. Both cards prefer the best local game on the same slate, so
 * without this they pick the same one and the page's two biggest slots
 * carry one matchup. Only ever skips that single game, and only while
 * another local one exists on the day.
 *
 * `postseason` (utils/postseason.js `active`): on playoff weeks the result
 * that leads is a WIN by a tracked team, not the closest local margin. The
 * margin rule alone led the hero with Stratford's 9-0 Level 2 loss on the
 * morning Edgar won 56-18 and Gilman 55-0 (2026-10-31): a season ending is
 * news, but a team still alive is the story readers come back for. Wins
 * whose winner is in the home region rank first, then any tracked winner
 * with a local side, then any tracked winner; the most recent day, then
 * the closest margin, decides within a tier. With no tracked win in the
 * window the old rule runs, and an elimination can still lead (the hero
 * then says "Season over").
 */
export function pickFeaturedGame(
  games,
  now = new Date(),
  preferIds = null,
  excludeId = null,
  { postseason = false } = {},
) {
  if (!games || games.length === 0) return null;
  const nowTs = now.getTime();

  if (postseason) {
    const local = (side) => !!preferIds?.has?.(side?.school_id);
    const winnerOf = (g) => (g.home.score > g.away.score ? g.home : g.away);
    const tier = (g) => {
      if (local(winnerOf(g))) return 2;
      return local(g.home) || local(g.away) ? 1 : 0;
    };
    // A win only leads while it is the winner's latest result: Tuesday's
    // regional win is not the story once Thursday's sectional ended it.
    const latestFinal = new Map();
    for (const g of games) {
      if (!g.playoff || g.status !== "final") continue;
      for (const side of [g.home, g.away]) {
        const id = side?.school_id;
        const ts = new Date(g.date).getTime();
        if (id && !(latestFinal.get(id) >= ts)) latestFinal.set(id, ts);
      }
    }
    const wins = games
      .filter(isTrackedPlayoffWin)
      .filter((g) => !isForfeitScore(g))
      .map((g) => ({ g, ts: new Date(g.date).getTime() }))
      .filter(({ g, ts }) => latestFinal.get(winnerOf(g).school_id) === ts)
      .filter(({ ts }) => ts <= nowTs && nowTs - ts < RESULT_LEAD_MS)
      .sort(
        (a, b) =>
          tier(b.g) - tier(a.g) ||
          b.g.date.slice(0, 10).localeCompare(a.g.date.slice(0, 10)) ||
          Math.abs(a.g.home.score - a.g.away.score) - Math.abs(b.g.home.score - b.g.away.score),
      );
    if (wins.length > 0) return wins[0].g;
  }

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
      // Stakes first (conference game, both sides local), then a
      // competitive game over a rout, then a home-region WIN over a home-
      // region loss, then the closest margin. Regular-season version of the
      // postseason's winner-first rule: the hero had led boys hockey with
      // "The Raiders fell to Altoona Co-op 7-1" and girls basketball with
      // a 52-19 loss (critique run 21).
      const stakes = (g) => (g.conference_game ? 2 : 0) + (localSides(g) === 2 ? 1 : 0);
      const localWin = (g) => {
        const winner =
          g.home.score > g.away.score ? g.home : g.away.score > g.home.score ? g.away : null;
        return winner && preferIds.has(winner.school_id) ? 1 : 0;
      };
      const margin = (g) => Math.abs(g.home.score - g.away.score);
      const blowout = (g) => (margin(g) > blowoutMargin(g.sport) ? 1 : 0);
      const lead = recentLocal
        .filter(({ g }) => g.date.slice(0, 10) === latestDay)
        .sort(
          (a, b) =>
            stakes(b.g) - stakes(a.g) ||
            blowout(a.g) - blowout(b.g) ||
            localWin(b.g) - localWin(a.g) ||
            margin(a.g) - margin(b.g),
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
      // as it does in the list below the hero. The first day WITH a local
      // game, not just the first day: a Monday game two hours west
      // (Chetek-Weyerhaeuser at Bruce) led boys basketball over Tuesday's
      // 18-game opener (critique run 21). The hero's eyebrow then says
      // "Next local game" instead of "Up Next" (components/Hero.jsx).
      const isLocal = ({ g }) =>
        preferIds.has(g.home.school_id) || preferIds.has(g.away.school_id);
      const firstLocal = upcoming.find(isLocal);
      const firstDay = firstLocal ? firstLocal.g.date.slice(0, 10) : null;
      // Within the day, the bigger local game first: both sides local,
      // then a conference game, then the earlier start. Time order alone
      // put Rosholt at Port Edwards ahead of Antigo at Wausau East once
      // Game of the Week took a different game.
      const bothLocal = (g) =>
        preferIds.has(g.home.school_id) && preferIds.has(g.away.school_id) ? 1 : 0;
      const locals = upcoming
        .filter((item) => item.g.date.slice(0, 10) === firstDay && isLocal(item))
        .sort(
          (a, b) =>
            bothLocal(b.g) - bothLocal(a.g) ||
            (b.g.conference_game ? 1 : 0) - (a.g.conference_game ? 1 : 0) ||
            a.ts - b.ts,
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
