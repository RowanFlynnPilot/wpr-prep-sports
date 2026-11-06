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

function roundIndexOf(round) {
  return ROUND_INDEX.has(round) ? ROUND_INDEX.get(round) : 99;
}

/**
 * Identity of one side of a game: the manifest id when the school is
 * tracked, otherwise its listed name (De Pere, Onalaska and the rest of
 * the bracket are only ever names).
 */
function sideKey(side) {
  if (side?.school_id) return `id:${side.school_id}`;
  const name = (side?.name ?? "").trim().toLowerCase();
  return name && name !== "tbd" ? `name:${name}` : null;
}

/** Whether `side` plays in a later round of the same bracket. */
function appearsInLaterRound(side, roundIndex, playoffs) {
  const key = sideKey(side);
  if (!key) return false;
  return playoffs.some(
    (g) =>
      g.playoff &&
      roundIndexOf(g.playoff_round) > roundIndex &&
      (sideKey(g.home) === key || sideKey(g.away) === key),
  );
}

/**
 * WIAA records a soccer playoff game decided on penalty kicks as a tie
 * (De Pere 4, Hudson 4 in the 2026 Sectional Final; Wausau East 1,
 * Onalaska 1 in the Regional), so by the score alone both sides read as
 * eliminated. A tie in a single-elimination bracket cannot stand: the
 * side that shows up in a later round won the shootout.
 *
 * Returns null unless `game` is a tied playoff final. Otherwise, from the
 * perspective of the home (`isHome`) or away side:
 *   { shootout: true, won: true,  undecided: false }  advanced on PKs
 *   { shootout: true, won: false, undecided: false }  lost the shootout
 *   { shootout: true, won: false, undecided: true }   neither side has a
 *       later game yet — nobody is eliminated until the bracket says so
 *
 * `playoffs` is the sport's playoff games (any list; non-playoff entries
 * are ignored). With only one team's own games, that team's advancement
 * is still detected; its opponent's is not, so the result reads undecided
 * rather than lost.
 */
export function resolveShootout(game, isHome, playoffs) {
  if (!game?.playoff || game.status !== "final") return null;
  const h = game.home?.score;
  const a = game.away?.score;
  if (typeof h !== "number" || typeof a !== "number" || h !== a) return null;
  const idx = roundIndexOf(game.playoff_round);
  const own = isHome ? game.home : game.away;
  const opp = isHome ? game.away : game.home;
  const list = playoffs ?? [];
  const ownLater = appearsInLaterRound(own, idx, list);
  const oppLater = appearsInLaterRound(opp, idx, list);
  if (ownLater && !oppLater) return { shootout: true, won: true, undecided: false };
  if (oppLater && !ownLater) return { shootout: true, won: false, undecided: false };
  return { shootout: true, won: false, undecided: true };
}

/**
 * "W 4-4 (PK)", "L 4-4 (PK)", "4-4 (PK)" while the shootout result is
 * unknown, or the plain "W 57-0" / "L 9-0" — the one spelling of a
 * playoff result for the team page, the bracket and Road to State.
 * Returns null for a game that is not final.
 */
export function playoffResultLabel(entry) {
  if (!entry?.isFinal) return null;
  const score = `${entry.ownScore}-${entry.oppScore}`;
  if (entry.shootout) {
    if (entry.undecided) return `${score} (PK)`;
    return `${entry.won ? "W" : "L"} ${score} (PK)`;
  }
  return `${entry.won ? "W" : "L"} ${score}`;
}

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
 * Each entry: { schoolId, school, games: [{game, round, won, shootout,
 * undecided, ownScore, oppScore, opponent}] } where games is sorted by
 * canonical round order. A tied playoff final is a penalty-kick shootout
 * (see resolveShootout): `won` follows the bracket, `shootout` is true,
 * and `undecided` means neither side has a later game yet.
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
      const scored = isFinal && own != null && opp != null;
      const shootout = scored && own === opp ? resolveShootout(g, isHome, playoffs) : null;
      const won = shootout ? shootout.won : scored && own > opp;
      journeyBySchool.get(sid).push({
        game: g,
        round: g.playoff_round ?? "Playoff",
        roundIndex: roundIndexOf(g.playoff_round),
        isHome,
        won,
        shootout: !!shootout,
        undecided: !!shootout?.undecided,
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
    // Alive = the journey's last game is still to be played, or was won.
    // A team with a scheduled next round and a TBD opponent is alive even
    // though nothing is final yet (Gilman the morning after Level 3). A
    // shootout nobody has been seen advancing from keeps both sides alive.
    const last = entries[entries.length - 1];
    const alive = !!last && (!last.isFinal || last.won || last.undecided);
    return { schoolId, school, games: entries, alive };
  });

  // Sort: most rounds played first, then last-round-won (still alive) above eliminated.
  journeys.sort((a, b) => {
    // Alive teams first: with Level 3 off-screen at 375px, an eliminated
    // team sorted between two alive ones looked unbeaten.
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
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
