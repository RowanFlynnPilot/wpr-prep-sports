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
