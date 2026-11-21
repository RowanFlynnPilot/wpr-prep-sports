import { DEFAULT_SPORT, SPORT_IDS, configFor } from "../config/sports.js";
import { localDate } from "./dates.js";

const DAY_MS = 86_400_000;

/**
 * How long a sport's `seasonEnd` keeps it out of the in-season lists. The
 * config dates are absolute ("2026-11-21"), so without a bound a season
 * that ended last November would stay "over" forever and the sport would
 * never come back into season until someone edited the config. Half a
 * year covers every gap between a state final and the next opener.
 */
export const SEASON_END_HOLD_DAYS = 180;

/**
 * Is a sport in season right now? Its config's active months are the
 * coarse gate; the opener date (`nextSeasonStart`) is the fine one. By
 * month alone, Nov 1 flipped four winter sports "in season" sixteen days
 * before their first game, which put four empty tabs ahead of volleyball
 * and boys soccer during their state tournaments (postseason review,
 * 2026-10-31).
 */
export function sportInSeason(id, now = new Date()) {
  const cfg = configFor(id);
  if (!cfg) return false;
  if (!(cfg.activeMonths ?? []).includes(now.getMonth())) return false;
  if (cfg.nextSeasonStart) {
    const opener = localDate(cfg.nextSeasonStart);
    if (opener && now < opener) return false;
  }
  // Fall sports share November with the winter openers; once a sport's
  // state tournament is over (`seasonEnd`, the day after the finals) it
  // leaves the in-season lists instead of lingering to month's end.
  if (seasonOver(cfg, now)) return false;
  return true;
}

/** Has this season's state tournament finished (within the hold window)? */
export function seasonOver(cfg, now = new Date()) {
  const end = cfg?.seasonEnd ? localDate(cfg.seasonEnd) : null;
  if (!end) return false;
  const since = now.getTime() - end.getTime();
  return since >= 0 && since < SEASON_END_HOLD_DAYS * DAY_MS;
}

/**
 * The sport a reader lands on at the site root. The WordPress embed loads
 * "/", and a fixed football default sent every reader to an off-season
 * football page from the state final until August while basketball and
 * hockey were being played (review run 21, 2026-11-21). The first sport
 * in season, in registry order (football before volleyball in the fall,
 * boys before girls basketball in winter); the default sport otherwise.
 *
 * index.html runs the same rule before the bundles load (to prefetch the
 * right meta.json), from `landingTable()` injected at build time — keep
 * the two in step.
 */
export function landingSport(now = new Date()) {
  return SPORT_IDS.find((id) => sportInSeason(id, now)) ?? DEFAULT_SPORT;
}

/** The config slice index.html's inline prefetch needs to run landingSport. */
export function landingTable() {
  return {
    fallback: DEFAULT_SPORT,
    holdDays: SEASON_END_HOLD_DAYS,
    sports: SPORT_IDS.map((id) => {
      const cfg = configFor(id);
      return {
        id,
        months: cfg.activeMonths ?? [],
        start: cfg.nextSeasonStart ?? null,
        end: cfg.seasonEnd ?? null,
      };
    }),
  };
}

/**
 * When does this sport next open? The config's `nextSeasonStart` is the
 * opener of the season being played; once it has passed (every
 * off-season until someone updates the config) it is rolled forward a
 * year at a time and marked `estimated`, so the off-season hero says
 * "returns in August 2027" instead of "returns Wednesday, August 19,
 * 2026 · Today" (volleyball, 2026-11-21).
 *
 * @returns {{ date: Date, estimated: boolean } | null}
 */
export function nextOpener(cfg, now = new Date()) {
  const configured = cfg?.nextSeasonStart ? localDate(cfg.nextSeasonStart) : null;
  if (!configured || Number.isNaN(configured.getTime())) return null;
  if (configured > now) return { date: configured, estimated: false };
  const d = new Date(configured);
  while (d <= now) d.setFullYear(d.getFullYear() + 1);
  return { date: d, estimated: true };
}
