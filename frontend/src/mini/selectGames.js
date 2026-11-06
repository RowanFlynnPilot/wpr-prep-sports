/**
 * Which games the mini scoreboard shows, and in what order.
 *
 * Fixed caps, not "as many as fit": the WordPress embed has no resize
 * script, so the iframe height is whatever the editor typed. With at most
 * MINI_RESULTS score cards and MINI_UPCOMING fixture rows the tallest
 * possible mini is a known number, and the README's snippet height covers
 * it at every width.
 *
 * Order, for a homepage in the publisher's town:
 *   results  — live games, then games underway (a scheduled game whose
 *              start time has passed within the last three hours and no
 *              live feed yet — utils/games.js `isUnderway`; shown with an
 *              "Underway" chip and no score, never under "Up next" with a
 *              start time that has gone by), then finals from the last 6
 *              days. A followed school's game first, then games with a
 *              home-region school, newest day first; within a day, the
 *              game nearest the publisher leads (the order of
 *              SITE.homeRegionCities, Wausau first — the same weight the
 *              dashboard orders conferences by), then both-sides-local,
 *              conference, closest margin. Forfeits, unreported finals and
 *              score-pending games (started 3–36 h ago, no result) are
 *              skipped: a scoreboard with four slots has no room for a
 *              non-result.
 *   upcoming — the next 10 days: a followed school's game first, then
 *              games with a home-region school, soonest day first, then
 *              kickoff time; nearness to the publisher only breaks ties
 *              within one time slot (a 5:00 PM game two counties over
 *              still lists before a 7:00 PM game in town).
 *
 * `cityRank` maps school id → index of its city in SITE.homeRegionCities;
 * a school absent from it is not home-region.
 */
import {
  isForfeitScore,
  isStaleScheduled,
  isUnderway,
  isUnreportedFinal,
} from "../utils/games.js";

export const MINI_RESULTS = 4;
export const MINI_UPCOMING = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const RESULT_WINDOW_MS = 6 * DAY_MS;
const UPCOMING_WINDOW_MS = 10 * DAY_MS;

const dayOf = (g) => String(g.date).slice(0, 10);
const timeOf = (g) => new Date(g.date).getTime();

export function selectMiniGames(games, { now = Date.now(), cityRank, followedIds, pinnedId = null } = {}) {
  const rank = cityRank ?? new Map();
  const followed = new Set(followedIds ?? []);
  const localSides = (g) =>
    (rank.has(g.home?.school_id) ? 1 : 0) + (rank.has(g.away?.school_id) ? 1 : 0);
  const nearest = (g) =>
    Math.min(rank.get(g.home?.school_id) ?? Infinity, rank.get(g.away?.school_id) ?? Infinity);
  const isFollowed = (g) => followed.has(g.home?.school_id) || followed.has(g.away?.school_id);
  const flag = (b) => (b ? 1 : 0);
  const byNearness = (a, b) =>
    (nearest(a) === nearest(b) ? 0 : nearest(a) < nearest(b) ? -1 : 1) ||
    localSides(b) - localSides(a) ||
    flag(b.conference_game) - flag(a.conference_game);

  const live = [];
  const underway = [];
  const finals = [];
  const upcoming = [];
  for (const g of games ?? []) {
    const t = timeOf(g);
    if (!Number.isFinite(t)) continue;
    if (g.status === "in_progress") {
      live.push(g);
    } else if (g.status === "final") {
      if (isUnreportedFinal(g) || isForfeitScore(g)) continue;
      if (t <= now && now - t <= RESULT_WINDOW_MS) finals.push(g);
    } else if (g.status === "scheduled") {
      if (isStaleScheduled(g, now)) continue;
      if (isUnderway(g, now)) underway.push(g);
      // Past kickoff but not underway = score pending: not a result, not
      // upcoming; the four slots go to games with something to show.
      else if (t >= now && t - now <= UPCOMING_WINDOW_MS) upcoming.push(g);
    }
  }

  const byInterest = (a, b) =>
    flag(isFollowed(b)) - flag(isFollowed(a)) ||
    flag(localSides(b) > 0) - flag(localSides(a) > 0);

  live.sort((a, b) => byInterest(a, b) || byNearness(a, b) || timeOf(a) - timeOf(b));
  underway.sort((a, b) => byInterest(a, b) || byNearness(a, b) || timeOf(a) - timeOf(b));
  finals.sort(
    (a, b) =>
      byInterest(a, b) ||
      dayOf(b).localeCompare(dayOf(a)) ||
      byNearness(a, b) ||
      Math.abs(a.home.score - a.away.score) - Math.abs(b.home.score - b.away.score) ||
      String(a.home?.name).localeCompare(String(b.home?.name)),
  );
  // The dashboard's Game of the Week leads "Up next" (critique run 17: the
  // mini's three slots skipped it on a Friday afternoon).
  // ...but only on its own day: next Friday's pick must not jump ahead
  // of tonight's games.
  const firstDay = upcoming.map(dayOf).sort()[0];
  const pinned = (g) => flag(pinnedId != null && g.id === pinnedId && dayOf(g) === firstDay);
  // Kickoff time before nearness: the slate reads in the order the games
  // tip off, and a 7:00 PM game in town no longer leapfrogs a 5:00 PM one.
  upcoming.sort(
    (a, b) =>
      pinned(b) - pinned(a) ||
      byInterest(a, b) ||
      dayOf(a).localeCompare(dayOf(b)) ||
      timeOf(a) - timeOf(b) ||
      byNearness(a, b) ||
      String(a.home?.name).localeCompare(String(b.home?.name)),
  );

  const results = spread([...live, ...underway, ...finals], MINI_RESULTS);
  const next = spread(upcoming, MINI_UPCOMING);
  return {
    results,
    upcoming: next,
    liveCount: results.filter((g) => g.status === "in_progress").length,
    // Scheduled games in `results` are the underway ones (nothing else
    // scheduled gets there); the card and the section label read them as
    // "Underway" rather than "Live".
    underwayCount: results.filter((g) => g.status === "scheduled").length,
    // One shared day lets the section label carry the date instead of every row.
    resultsDay: sharedDay(results),
    upcomingDay: sharedDay(next),
  };
}

/**
 * The top `cap` games with each school shown once before any school shows
 * twice, in the ranked order. A volleyball Saturday invitational gives one
 * school four or five matches; ranked straight, the homepage mini was four
 * Wausau East scores and nothing else. Repeats still fill leftover slots.
 */
function spread(ranked, cap) {
  const sides = (g) => [
    g.home?.school_id || `name:${g.home?.name}`,
    g.away?.school_id || `name:${g.away?.name}`,
  ];
  const seen = new Set();
  const first = [];
  const repeats = [];
  for (const g of ranked) {
    if (first.length >= cap) break;
    if (sides(g).some((s) => seen.has(s))) {
      repeats.push(g);
      continue;
    }
    first.push(g);
    for (const s of sides(g)) seen.add(s);
  }
  const chosen = new Set([...first, ...repeats.slice(0, cap - first.length)]);
  return ranked.filter((g) => chosen.has(g));
}

function sharedDay(list) {
  if (list.length === 0) return null;
  const first = dayOf(list[0]);
  return list.every((g) => dayOf(g) === first) ? list[0].date : null;
}
