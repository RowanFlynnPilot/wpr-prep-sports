/**
 * Game day: is there a slate today, and has the afternoon arrived?
 *
 * Critique run 17 (a Friday, 5 PM): the hero was Thursday's Loyal–Pacelli
 * final, Game of the Week was a thin strip beneath it, the Wausau West
 * page said nothing about that night's kickoff, and the mini's "Up next"
 * led with whichever game sorted first. Friday evening is the week's
 * biggest moment and the page did not know it was happening.
 *
 * From noon on a day with a slate (SLATE_MIN games dated today in this
 * sport) until the day ends, the dashboard leads with tonight: the hero
 * takes the Game of the Week with a count of the night's games, team
 * pages carry a "Tonight" line, and the mini pins the Game of the Week.
 * Once every game on the slate is final the mode stays on until midnight
 * (the hero shows the result with the night's count), then the ordinary
 * result-first logic takes over for the weekend.
 */
const SLATE_MIN = 3;
const START_HOUR = 12;

const dayKey = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/**
 * @returns {{ isGameDay: boolean, slate: Array, scheduled: number, live: number,
 *             finals: number, firstKickoff: Date|null, today: string }}
 */
export function gameDayState(games, now = new Date()) {
  const today = dayKey(now);
  const slate = [];
  for (const g of games ?? []) {
    if (!g?.date) continue;
    // Local calendar day: the dataset's dates carry their own offset, and
    // a reader's phone sits in the same time zone as the schools.
    if (dayKey(new Date(g.date)) === today) slate.push(g);
  }
  const scheduled = slate.filter((g) => g.status === "scheduled").length;
  const live = slate.filter((g) => g.status === "in_progress").length;
  const finals = slate.filter((g) => g.status === "final").length;
  const kickoffs = slate.map((g) => new Date(g.date).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const firstKickoff = kickoffs.length ? new Date(kickoffs[0]) : null;
  const afternoon = now.getHours() >= START_HOUR;
  return {
    isGameDay: afternoon && slate.length >= SLATE_MIN,
    slate,
    scheduled,
    live,
    finals,
    firstKickoff,
    today,
  };
}

/** Today's game for one school, if any (scheduled, live or final). */
export function todaysGameFor(games, schoolId, now = new Date()) {
  const today = dayKey(now);
  let found = null;
  for (const g of games ?? []) {
    if (!g?.date) continue;
    if (g.home?.school_id !== schoolId && g.away?.school_id !== schoolId) continue;
    if (dayKey(new Date(g.date)) !== today) continue;
    // Two games in a day (a volleyball Saturday): the one still to come
    // or in progress beats the one already final.
    if (!found || (found.status === "final" && g.status !== "final")) found = g;
  }
  return found;
}

/** "Tonight" for an evening kickoff, "Today" for a matinee. */
export function todayWord(date) {
  const h = new Date(date).getHours();
  return h >= 17 ? "Tonight" : "Today";
}

/** One line for the slate: "37 games tonight · 12 final · 3 live". */
export function slateSummary(state) {
  if (!state?.slate?.length) return "";
  const n = state.slate.length;
  // "tonight" when most of the slate kicks off in the evening; a lone
  // 4 p.m. game should not turn a Friday night into "today".
  const evening = state.slate.filter((g) => new Date(g.date).getHours() >= 17).length;
  const word = evening * 2 >= n ? "tonight" : "today";
  const parts = [`${n} game${n === 1 ? "" : "s"} ${word}`];
  if (state.live > 0) parts.push(`${state.live} live`);
  if (state.finals > 0) parts.push(`${state.finals} final`);
  return parts.join(" · ");
}

/**
 * Tonight's lead for the hero. The Game of the Week if it is on today's
 * slate; otherwise the best game on the slate for this audience: a live
 * local game first, then a local final (the result), then a local game
 * still to come; conference games and close margins break ties. The
 * marquee picker itself moves on to next week the moment tonight's game
 * kicks off, so this cannot lean on it after 7 p.m.
 */
export function pickTonightGame(slate, homeRegionIds, marqueeGame = null) {
  if (!slate?.length) return null;
  if (marqueeGame && slate.some((g) => g.id === marqueeGame.id)) return marqueeGame;
  const local = (g) =>
    (homeRegionIds?.has(g.home?.school_id) ? 1 : 0) + (homeRegionIds?.has(g.away?.school_id) ? 1 : 0);
  const statusWeight = { in_progress: 3, final: 2, scheduled: 1 };
  const margin = (g) =>
    g.status === "final" && g.home?.score != null && g.away?.score != null
      ? Math.abs(g.home.score - g.away.score)
      : 99;
  return [...slate].sort(
    (a, b) =>
      local(b) - local(a) ||
      (statusWeight[b.status] ?? 0) - (statusWeight[a.status] ?? 0) ||
      (b.conference_game ? 1 : 0) - (a.conference_game ? 1 : 0) ||
      margin(a) - margin(b),
  )[0];
}
