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
    return {
      schoolId: j.schoolId,
      school: j.school,
      alive: j.alive,
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
    eliminated: teams.filter((e) => !e.alive),
  };
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
