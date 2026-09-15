/**
 * Query parameters for the mini scoreboard (mini.html). Plain query string,
 * no hash routing: the mini is one screen, and a WordPress editor edits the
 * iframe src by hand.
 *
 *   ?sport=volleyball          one sport (default: football)
 *   ?sports=in-season          reader switcher over whatever is in season this
 *                              month — football/volleyball/boys soccer in the
 *                              fall, basketball and hockey in winter — so a
 *                              homepage placement never needs editing
 *   ?sports=football,volleyball   switcher over a fixed list
 *   ?to=https://…              where taps land (default: SITE.hubUrl)
 *
 * `sport` picks the opening tab when it's in the switcher's list; a sport
 * that isn't (football in January) yields to the list's first entry.
 */
import { DEFAULT_SPORT, SPORT_IDS, configFor, isKnownSport } from "../config/sports.js";
import { SITE } from "../config/site.js";

/** Sports whose season is running this calendar month, in registry order. */
export function inSeasonSports(now = new Date()) {
  const month = now.getMonth();
  return SPORT_IDS.filter((id) => (configFor(id).activeMonths ?? []).includes(month));
}

/** Resolve the mini's settings from a query string. */
export function readMiniParams(search = "", now = new Date()) {
  const q = new URLSearchParams(search);

  const list = (q.get("sports") ?? "").trim().toLowerCase();
  let sports = [];
  if (list === "in-season") {
    sports = inSeasonSports(now);
  } else if (list) {
    sports = [...new Set(list.split(",").map((s) => s.trim()))].filter(isKnownSport);
  }
  // A switcher needs two sports; one sport is just that sport.
  if (sports.length < 2) sports = sports.length === 1 ? [sports[0]] : [];

  const requested = (q.get("sport") ?? "").trim().toLowerCase();
  let sport;
  if (sports.length > 0) {
    sport = sports.includes(requested) ? requested : sports[0];
  } else {
    sport = isKnownSport(requested) ? requested : DEFAULT_SPORT;
  }

  // `link` is the obituaries mini's name for the same thing.
  const to = (q.get("to") ?? q.get("link") ?? "").trim();
  const destination = /^https?:\/\//i.test(to) ? to : SITE.hubUrl;

  return { sport, sports: sports.length > 1 ? sports : [], destination };
}
