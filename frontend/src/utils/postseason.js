import { buildTeamJourneys, playoffRoundsInOrder } from "./bracket.js";

const WEEK_MS = 7 * 86_400_000;

/**
 * One view of the postseason for every surface that talks about it: the
 * Road to State strip, the playoff-aware week grid, the team page's
 * season banner and the mini. Built on the bracket's journeys so "alive"
 * means the same thing everywhere (last playoff game still to be played,
 * or won).
 *
 * `active` is true from the first scheduled playoff game until a week
 * after the last final, which is the window the bracket leads the
 * Standings tab in. Outside it `teams` is empty.
 */
export function postseasonState(games, schoolIndex, now = Date.now()) {
  const t = typeof now === "number" ? now : new Date(now).getTime();
  const playoff = (games ?? []).filter((g) => g.playoff);
  const active = playoff.some(
    (g) => g.status !== "final" || t - new Date(g.date).getTime() < WEEK_MS,
  );
  if (!active) return { active: false, rounds: [], teams: [], alive: [], eliminated: [] };

  const teams = buildTeamJourneys(playoff, schoolIndex).map((j) => {
    const last = j.games[j.games.length - 1] ?? null;
    const next = j.games.find((e) => e.game.status !== "final") ?? null;
    // A final win in a title round ends the run as champions: not "alive"
    // (no next game is coming), not eliminated.
    const champion = !!last && last.isFinal && last.won && isTitleRound(last.round);
    return {
      schoolId: j.schoolId,
      school: j.school,
      alive: j.alive && !champion,
      champion,
      games: j.games,
      wins: j.games.filter((e) => e.won).length,
      nextGame: next?.game ?? null,
      nextRound: next?.round ?? null,
      nextIsHome: next ? next.isHome : null,
      nextOpponent: next?.opponent ?? null,
      lastGame: last?.game ?? null,
      lastEntry: last,
    };
  });
  return {
    active: true,
    rounds: playoffRoundsInOrder(playoff),
    teams,
    alive: teams.filter((e) => e.alive),
    champions: teams.filter((e) => e.champion),
    eliminated: teams.filter((e) => !e.alive && !e.champion),
  };
}

const TITLE_ROUNDS = new Set(["State Final", "State Championship"]);

/** The round that ends a bracket with a trophy (WIAA's state title rows). */
export function isTitleRound(round) {
  return TITLE_ROUNDS.has(round ?? "");
}

/**
 * Reader-facing round names. WIAA's football rounds are "Level 1-4", where
 * Level 4 is the state semifinal for 11- and 8-player alike (the title game
 * is its own "State Championship" row); other sports name their rounds.
 */
export function roundLabel(round, sportId = null) {
  if (!round) return "";
  if (sportId === "football" || /^Level \d$/.test(round)) {
    if (round === "Level 4") return "State semifinal (Level 4)";
    return round;
  }
  return round;
}

/**
 * Neutral-site game: the venue names neither school. State and sectional
 * games are played at arenas and the "home" side is only WIAA's listing
 * order, so "@ Heritage Christian" misleads; the surfaces say "vs" and
 * show the venue instead.
 */
export function isNeutralSite(game, schoolIndex = null) {
  const venue = (game?.venue ?? "").toLowerCase();
  if (!venue) return false;
  const names = [];
  for (const side of [game.home, game.away]) {
    if (!side) continue;
    names.push(side.name ?? "");
    const school = side.school_id && schoolIndex?.get ? schoolIndex.get(side.school_id) : null;
    if (school?.name) names.push(school.name);
    if (school?.city) names.push(school.city);
  }
  const tokens = names
    .flatMap((n) => n.toLowerCase().split(/[^a-z]+/))
    .filter((t) => t.length >= 4 && !["high", "school", "catholic", "central", "area", "lutheran"].includes(t));
  return !tokens.some((t) => venue.includes(t));
}

/** The postseason entry for one school, or null when it has no playoff games (or the postseason is over). */
export function teamPostseason(games, schoolId, schoolIndex, now = Date.now()) {
  if (!schoolId) return null;
  return postseasonState(games, schoolIndex, now).teams.find((e) => e.schoolId === schoolId) ?? null;
}

/** "TBD" (any case) is a bracket placeholder, not a team. */
export function isTbdSide(side) {
  return /^tbd$/i.test(side?.name ?? "");
}
