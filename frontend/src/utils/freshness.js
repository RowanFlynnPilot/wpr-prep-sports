/**
 * Is the dataset actually behind, or just old?
 *
 * The scraper runs hourly in season and every 10 minutes during game
 * windows, so "last update was 6 hours ago" on a game-day afternoon is
 * normal: nothing has happened since the morning run. The old test
 * (age > 4 hours in an active month) warned readers at 5 p.m. every
 * Friday, before a single kickoff, and turned the masthead pill red.
 * Data is only *behind* when a game has started since the last update
 * and the file can't know its score yet.
 */

const HOUR_MS = 3_600_000;

/** Games that kicked off after `lastUpdated` and before `now`. */
export function gamesStartedSince(games, lastUpdated, now = new Date()) {
  const last = lastUpdated instanceof Date ? lastUpdated : new Date(lastUpdated);
  const lastMs = last.getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return 0;
  let n = 0;
  for (const g of games ?? []) {
    const start = new Date(g?.date).getTime();
    if (!Number.isFinite(start)) continue;
    if (start > lastMs && start <= nowMs) n += 1;
  }
  return n;
}

/**
 * True when readers could be looking at scores the file hasn't caught
 * up with: the data is older than `maxAgeHours` AND at least one game
 * has started in the gap. Off-season (no activeMonths match) is never
 * stale: nothing is being played.
 */
export function isDataBehind({
  lastUpdated,
  games,
  activeMonths,
  now = new Date(),
  maxAgeHours = 4,
}) {
  if (!lastUpdated) return false;
  const month = now.getMonth();
  if (activeMonths && !activeMonths.includes(month)) return false;
  const ageHours = (now.getTime() - new Date(lastUpdated).getTime()) / HOUR_MS;
  if (!(ageHours > maxAgeHours)) return false;
  return gamesStartedSince(games, lastUpdated, now) > 0;
}
