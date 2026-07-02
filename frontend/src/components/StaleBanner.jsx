/**
 * If data hasn't refreshed in a while AND we're in the current sport's
 * active calendar window, warn the reader the scores may be lagging.
 * Off-season we stay quiet — stale data is expected.
 *
 * `activeMonths` is a sport-config-driven list of 0-indexed months
 * (e.g. football = [7, 8, 9, 10] for Aug–Nov). Defaults to the
 * football window so existing callers keep working during the
 * phase-1 refactor.
 */
const FOOTBALL_FALLBACK_MONTHS = [7, 8, 9, 10];

export default function StaleBanner({
  lastUpdatedIso,
  activeMonths = FOOTBALL_FALLBACK_MONTHS,
  now = new Date(),
}) {
  if (!lastUpdatedIso) return null;
  const last = new Date(lastUpdatedIso);
  const ageHours = (now.getTime() - last.getTime()) / 3_600_000;

  const month = now.getMonth();
  const inSeason = activeMonths.includes(month);

  // Off-season, stale is the expected state — no banner. (Previously a
  // 48h off-season threshold existed but was masked by the live cron
  // bumping last_updated nightly; that no-op write is gone now.)
  if (!inSeason) return null;
  if (ageHours <= 4) return null;

  const ageLabel =
    ageHours >= 24
      ? `${Math.floor(ageHours / 24)} day${Math.floor(ageHours / 24) === 1 ? "" : "s"} ago`
      : `${Math.floor(ageHours)} hour${Math.floor(ageHours) === 1 ? "" : "s"} ago`;

  return (
    <div className="stale-banner" role="status">
      <strong>Heads up:</strong> last data refresh was {ageLabel}. Live scores
      may lag if the WIAA scrape ran into trouble.
    </div>
  );
}
