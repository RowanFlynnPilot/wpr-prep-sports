/**
 * If data hasn't refreshed in a while AND we're in the active football
 * window (mid-August through late November), warn the reader the scores
 * may be lagging. Off-season we stay quiet — stale data is expected.
 */
export default function StaleBanner({ lastUpdatedIso, now = new Date() }) {
  if (!lastUpdatedIso) return null;
  const last = new Date(lastUpdatedIso);
  const ageHours = (now.getTime() - last.getTime()) / 3_600_000;

  // Active season window — month is 0-indexed: Aug=7, Nov=10.
  const month = now.getMonth();
  const inSeason = month >= 7 && month <= 10;

  // 4-hour grace in-season, 48-hour grace off-season.
  const threshold = inSeason ? 4 : 48;
  if (ageHours <= threshold) return null;

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
