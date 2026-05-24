/**
 * Tournament bracket helpers.
 *
 * We don't get a structured bracket from WIAA — we infer the round
 * order from the playoff_round names that the scraper attached to each
 * game. Rounds are sorted by canonical order per sport family so the
 * earliest round renders leftmost.
 */

// Canonical round order. Anything not listed falls to the end, alpha-
// sorted, so a future round name doesn't break the view.
const ROUND_ORDER = [
  // Football
  "Level 1",
  "Level 2",
  "Level 3",
  "Level 4",
  // Basketball / volleyball / hockey
  "Regional",
  "Regional Semifinal",
  "Regional Final",
  "Sectional",
  "Sectional Semifinal",
  "Sectional Final",
  // State rounds (shared across sports)
  "State Quarterfinal",
  "State Semifinal",
  "State Final",
  "State Championship",
];

const ROUND_INDEX = new Map(ROUND_ORDER.map((r, i) => [r, i]));

/**
 * Group games by playoff_round in canonical order. Returns an array of
 * { round, games } in order. Games within a round are sorted by date
 * then by tracked-team involvement (tracked first) so the area's games
 * cluster at the top of each column.
 */
export function groupPlayoffGames(games) {
  if (!games || games.length === 0) return [];
  const playoffs = games.filter((g) => g.playoff);
  if (playoffs.length === 0) return [];

  const byRound = new Map();
  for (const g of playoffs) {
    const r = g.playoff_round ?? "Playoff";
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(g);
  }

  const rounds = [...byRound.entries()].sort(([a], [b]) => {
    const ai = ROUND_INDEX.has(a) ? ROUND_INDEX.get(a) : 99;
    const bi = ROUND_INDEX.has(b) ? ROUND_INDEX.get(b) : 99;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });

  return rounds.map(([round, gs]) => ({
    round,
    games: gs.slice().sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      if (ta !== tb) return ta - tb;
      // Tracked-team games first within the same day.
      const aTracked = (a.home.school_id ? 1 : 0) + (a.away.school_id ? 1 : 0);
      const bTracked = (b.home.school_id ? 1 : 0) + (b.away.school_id ? 1 : 0);
      return bTracked - aTracked;
    }),
  }));
}

/** True if either side of the game is in our manifest. */
export function gameHasTrackedTeam(game) {
  return !!(game.home.school_id || game.away.school_id);
}

/**
 * Compact "team journey" view of the playoffs: one entry per tracked
 * team that played a playoff game, with their games ordered by round.
 *
 * Each entry: { schoolId, school, games: [{game, round, won, ownScore, oppScore, opponent}] }
 * where games is sorted by canonical round order.
 *
 * Teams are returned sorted by how far they advanced — state champs at
 * the top (most rounds + last round won), eliminated Round 1 at the
 * bottom.
 */
export function buildTeamJourneys(games, schoolIndex) {
  if (!games || games.length === 0) return [];
  const playoffs = games.filter((g) => g.playoff);
  if (playoffs.length === 0) return [];

  const journeyBySchool = new Map();
  for (const g of playoffs) {
    for (const side of ["home", "away"]) {
      const sid = g[side].school_id;
      if (!sid) continue;
      if (!journeyBySchool.has(sid)) journeyBySchool.set(sid, []);
      const isHome = side === "home";
      const own = isHome ? g.home.score : g.away.score;
      const opp = isHome ? g.away.score : g.home.score;
      const isFinal = g.status === "final";
      const won = isFinal && own != null && opp != null && own > opp;
      journeyBySchool.get(sid).push({
        game: g,
        round: g.playoff_round ?? "Playoff",
        roundIndex: ROUND_INDEX.has(g.playoff_round) ? ROUND_INDEX.get(g.playoff_round) : 99,
        isHome,
        won,
        isFinal,
        ownScore: own,
        oppScore: opp,
        opponent: isHome ? g.away : g.home,
      });
    }
  }

  const journeys = [...journeyBySchool.entries()].map(([schoolId, entries]) => {
    entries.sort((a, b) => a.roundIndex - b.roundIndex);
    const school = schoolIndex?.get?.(schoolId) ?? null;
    return { schoolId, school, games: entries };
  });

  // Sort: most rounds played first, then last-round-won (still alive) above eliminated.
  journeys.sort((a, b) => {
    if (a.games.length !== b.games.length) return b.games.length - a.games.length;
    const aLast = a.games[a.games.length - 1];
    const bLast = b.games[b.games.length - 1];
    const aAdvanced = aLast.won ? 1 : 0;
    const bAdvanced = bLast.won ? 1 : 0;
    if (aAdvanced !== bAdvanced) return bAdvanced - aAdvanced;
    return (a.school?.name ?? a.schoolId).localeCompare(b.school?.name ?? b.schoolId);
  });

  return journeys;
}

/**
 * Canonical round columns for a given sport's playoff games — used as
 * the header row of the team-journey grid. Returns the rounds in
 * order that actually appear in the games list.
 */
export function playoffRoundsInOrder(games) {
  const present = new Set();
  for (const g of games ?? []) {
    if (g.playoff && g.playoff_round) present.add(g.playoff_round);
  }
  return [...present].sort((a, b) => {
    const ai = ROUND_INDEX.has(a) ? ROUND_INDEX.get(a) : 99;
    const bi = ROUND_INDEX.has(b) ? ROUND_INDEX.get(b) : 99;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
}
