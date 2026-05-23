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

/**
 * Score an upcoming game's "stakes". Higher = more pitchable.
 *
 * Both teams in our manifest is the floor: a featured game has to involve
 * teams we cover. We layer on conference matchup, top-of-standings vs
 * top-of-standings, and proximity (next 14 days).
 */
function scoreUpcoming(game, schoolsById, now) {
  if (game.status !== "scheduled") return -Infinity;
  const ts = new Date(game.date).getTime();
  if (ts < now) return -Infinity;
  const daysOut = (ts - now) / 86_400_000;
  if (daysOut > 14) return -Infinity;

  const homeTracked = !!game.home.school_id && schoolsById.has(game.home.school_id);
  const awayTracked = !!game.away.school_id && schoolsById.has(game.away.school_id);
  if (!homeTracked || !awayTracked) return -Infinity;

  let score = 10;
  if (game.conference_game) score += 4;
  if (game.playoff) score += 8;
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
 */
export function pickMarqueeGame({ games, schoolsById, offSeason }) {
  if (!games || games.length === 0) return null;

  if (!offSeason) {
    const now = Date.now();
    const best = bestBy(games, (g) => scoreUpcoming(g, schoolsById, now));
    if (!best || best.score === -Infinity) return null;
    return {
      kind: "upcoming",
      game: best.item,
      eyebrow: best.item.playoff ? "Playoff matchup" : "Game of the Week",
      headline: matchupHeadline(best.item),
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
