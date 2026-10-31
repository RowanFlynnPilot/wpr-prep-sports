import { configFor } from "../config/sports.js";
import { localDate } from "./dates.js";

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
  if (cfg.seasonEnd) {
    const end = localDate(cfg.seasonEnd);
    if (end && now >= end) return false;
  }
  return true;
}
