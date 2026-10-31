/**
 * Pick the "marquee" game for the current sport — a single high-stakes
 * matchup we surface above the dashboard hero. Different heuristic for
 * in-season (upcoming game) vs off-season (past game we want to remember).
 *
 * Returns either:
 *   { kind: "upcoming", game, eyebrow, headline }   // next-up high-stakes game
 *   { kind: "marquee",  game, eyebrow, headline }   // historic standout
 *   null                                            // nothing worth highlighting
 */

import { isTbdSide } from "./postseason.js";
import { formatGameDate, formatGameShortDay } from "./dates.js";

const DAY_MS = 86_400_000;

// Round depth for the postseason tiebreak: a Level 4 game outranks a
// Level 3 game when everything else is equal.
const ROUND_DEPTH = [
  /level\s*1\b/, /level\s*2\b/, /level\s*3\b/, /level\s*4\b/,
  /^regional/, /^sectional/, /quarterfinal/, /semifinal/, /final|championship/,
];

function roundDepth(round) {
  if (!round) return 0;
  const r = round.toLowerCase();
  if (r.startsWith("state")) {
    if (r.includes("quarterfinal")) return 7;
    if (r.includes("semifinal")) return 8;
    return 9;
  }
  const i = ROUND_DEPTH.findIndex((re) => re.test(r));
  return i < 0 ? 0 : i + 1;
}

/**
 * True when any playoff game is still to be played within 14 days of
 * `now`: the window in which the Game of the Week may feature a playoff
 * game with only one tracked side. By Level 2 almost every remaining
 * opponent is from outside the coverage area (Lomira, West De Pere,
 * Grantsburg) or still TBD, and the both-sides-tracked rule left the
 * strip empty for the whole postseason.
 */
function inPostseason(games, now) {
  return games.some((g) => {
    if (!g.playoff || g.status !== "scheduled") return false;
    const ts = new Date(g.date).getTime();
    return ts >= now && ts - now <= 14 * DAY_MS;
  });
}

/**
 * Score an upcoming game's "stakes". Higher = more pitchable.
 *
 * Both teams in our manifest is the floor: a featured game has to involve
 * teams we cover. We layer on conference matchup, top-of-standings vs
 * top-of-standings, and proximity (next 14 days).
 *
 * Postseason exception: a playoff game with ONE tracked side qualifies
 * (the other side untracked or TBD), a little below a both-tracked game.
 */
function scoreUpcoming(game, schoolsById, now, homeRegionIds, slateDay = null, postseason = false) {
  if (game.status !== "scheduled") return -Infinity;
  const ts = new Date(game.date).getTime();
  if (ts < now) return -Infinity;
  const daysOut = (ts - now) / 86_400_000;
  if (daysOut > 14) return -Infinity;

  const homeTracked = !!game.home.school_id && schoolsById.has(game.home.school_id);
  const awayTracked = !!game.away.school_id && schoolsById.has(game.away.school_id);
  const bothTracked = homeTracked && awayTracked;
  const oneSidePlayoff = postseason && game.playoff && (homeTracked || awayTracked);
  if (!bothTracked && !oneSidePlayoff) return -Infinity;

  let score = bothTracked ? 10 : 8;
  // A named opponent is a better pitch than "opponent TBD".
  if (isTbdSide(game.home) || isTbdSide(game.away)) score -= 1;
  if (game.conference_game) score += 4;
  // The playoff bonus belongs to the main slate's night. Uncapped, a
  // Saturday 8-player Level 1 game (28.7) outscored four tied Friday
  // locals (25.0) the week the playoffs began (critique run 18).
  if (game.playoff) {
    score += slateDay && game.date.slice(0, 10) !== slateDay ? 2 : 8;
    // Deeper round breaks a tie, never outweighs a home-region side.
    score += roundDepth(game.playoff_round) * 0.25;
  }
  // Home-region stake outranks a generic conference tag: without this the
  // Wausau paper's Game of the Week landed on Marion at Menominee Nation
  // (first tied conference game in file order) over a Wausau West game.
  if (homeRegionIds && homeRegionIds.size > 0) {
    const localSides =
      (homeRegionIds.has(game.home.school_id) ? 1 : 0) +
      (homeRegionIds.has(game.away.school_id) ? 1 : 0);
    if (localSides >= 1) score += 6;
    if (localSides === 2) score += 3;
  }
  // Prefer sooner games — same-week beats two-weeks-out by a tiebreaker.
  score += Math.max(0, 7 - daysOut) * 0.4;
  return score;
}

/**
 * Score a completed game's "marquee" weight — close + meaningful + recent.
 * Used in off-season mode to surface a "best game of the year" callout.
 */
function scoreMarquee(game, schoolsById) {
  if (game.status !== "final") return -Infinity;
  const home = game.home;
  const away = game.away;
  if (home.score == null || away.score == null) return -Infinity;

  const margin = Math.abs(home.score - away.score);
  const total = home.score + away.score;

  const homeTracked = !!home.school_id && schoolsById.has(home.school_id);
  const awayTracked = !!away.school_id && schoolsById.has(away.school_id);
  if (!homeTracked && !awayTracked) return -Infinity;

  let score = 0;
  // At least one tracked team is required; both is much better.
  score += homeTracked && awayTracked ? 10 : 3;
  // Closeness pays — a one-score game beats a blowout by a wide margin.
  if (margin <= 3) score += 18;
  else if (margin <= 7) score += 10;
  else if (margin <= 14) score += 3;
  // Volume — high-scoring games feel "shootout" memorable. Capped so
  // basketball doesn't always win (typical totals 100+).
  score += Math.min(8, total / 20);
  // Conference + playoff context.
  if (game.conference_game) score += 4;
  if (game.playoff) score += 6;
  // Deeper playoff round = bigger deal.
  if (game.playoff_round) {
    const round = game.playoff_round.toLowerCase();
    if (round.includes("championship") || round.includes("state final")) score += 10;
    else if (round.includes("semifinal")) score += 6;
    else if (round.includes("final")) score += 4;
    else if (round.match(/level\s*4/)) score += 5;
    else if (round.match(/level\s*3/)) score += 3;
  }
  return score;
}

/**
 * Public entry. Returns the single marquee pick for the dashboard, or null
 * when nothing qualifies.
 *
 * `now` is the dashboard's anchor date, not necessarily the wall clock —
 * preseason it sits on the season opener so the Game of the Week is picked
 * from the opening slate. Without it, the 14-day horizon in `scoreUpcoming`
 * rejects every game in the weeks between the schedule landing and the
 * first whistle, and the slot renders empty. Defaults to the wall clock so
 * callers that genuinely mean "today" need not pass it.
 */
export function pickMarqueeGame({
  games,
  schoolsById,
  offSeason,
  now = Date.now(),
  homeRegionIds = null,
}) {
  if (!games || games.length === 0) return null;

  if (!offSeason) {
    const slateDay = mainSlateDay(games, now);
    const postseason = inPostseason(games, now);
    const best = bestBy(games, (g) =>
      scoreUpcoming(g, schoolsById, now, homeRegionIds, slateDay, postseason),
    );
    if (!best || best.score === -Infinity) return null;
    const g = best.item;
    return {
      kind: "upcoming",
      game: g,
      eyebrow: g.playoff
        ? g.playoff_round
          ? `Playoff matchup · ${g.playoff_round}`
          : "Playoff matchup"
        : "Game of the Week",
      headline: matchupHeadline(g),
    };
  }

  // Off-season: marquee callout from the season just past.
  const best = bestBy(games, (g) => scoreMarquee(g, schoolsById));
  if (!best || best.score === -Infinity) return null;
  return {
    kind: "marquee",
    game: best.item,
    eyebrow: bestEyebrow(best.item),
    headline: matchupHeadline(best.item, { withScore: true }),
  };
}

/**
 * The day in the coming week with the most scheduled games (three or more),
 * earliest day on a tie: Friday for football, a weeknight for volleyball.
 * Null when no day reaches three.
 */
function mainSlateDay(games, now) {
  const counts = new Map();
  for (const g of games) {
    if (g.status !== "scheduled") continue;
    const ts = new Date(g.date).getTime();
    if (!(ts >= now && ts - now < 7 * 86_400_000)) continue;
    const day = g.date.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let best = null;
  for (const [day, n] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (n >= 3 && (best === null || n > best.n)) best = { day, n };
  }
  return best?.day ?? null;
}

function bestEyebrow(game) {
  if (game.playoff && game.playoff_round) {
    const r = game.playoff_round.toLowerCase();
    if (r.includes("championship") || r.includes("state final")) return "Match of the Season";
    if (r.includes("semifinal")) return "Semifinal classic";
    if (r.includes("final")) return "Playoff classic";
    return "Playoff highlight";
  }
  if (game.conference_game) return "Conference classic";
  return "Match of the Season";
}

function matchupHeadline(game, { withScore = false } = {}) {
  const home = game.home;
  const away = game.away;
  // Bracket placeholder: lead with the team we know ("Gilman vs opponent
  // TBD · Fri Nov 6"); "TBD at Gilman" reads like a typo.
  if (!withScore && (isTbdSide(home) || isTbdSide(away))) {
    const known = isTbdSide(home) ? away : home;
    const day = formatGameShortDay(game.date);
    const when = `${day.charAt(0)}${day.slice(1).toLowerCase()} ${formatGameDate(game.date)}`;
    return `${isTbdSide(known) ? "TBD" : known.name} vs opponent TBD · ${when}`;
  }
  if (!withScore) {
    return `${away.name} at ${home.name}`;
  }
  return `${away.name} ${away.score ?? "—"} · ${home.name} ${home.score ?? "—"}`;
}

function bestBy(items, scoreFn) {
  let bestItem = null;
  let bestScore = -Infinity;
  for (const it of items) {
    const s = scoreFn(it);
    if (s > bestScore) {
      bestScore = s;
      bestItem = it;
    }
  }
  if (bestItem == null) return null;
  return { item: bestItem, score: bestScore };
}
