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
import { isDataBehind } from "../utils/freshness.js";

const FOOTBALL_FALLBACK_MONTHS = [7, 8, 9, 10];

export default function StaleBanner({
  lastUpdatedIso,
  activeMonths = FOOTBALL_FALLBACK_MONTHS,
  games = [],
  now = new Date(),
}) {
  if (!lastUpdatedIso) return null;
  const last = new Date(lastUpdatedIso);
  const ageHours = (now.getTime() - last.getTime()) / 3_600_000;

  // Off-season, stale is the expected state — no banner. In season, an
  // old file is only a problem once a game has kicked off since it was
  // written (utils/freshness.js): at 5 p.m. on a Friday the morning
  // scrape is six hours old and nothing is behind yet. The old age-only
  // test warned readers before every slate (critique run 17).
  if (!isDataBehind({ lastUpdated: last, games, activeMonths, now })) return null;

  const ageLabel =
    ageHours >= 24
      ? `${Math.floor(ageHours / 24)} day${Math.floor(ageHours / 24) === 1 ? "" : "s"} ago`
      : `${Math.floor(ageHours)} hour${Math.floor(ageHours) === 1 ? "" : "s"} ago`;

  return (
    <div className="stale-banner" role="status">
      {/* Was "HEADS UP: last data refresh was 4 hours ago. Live scores may
          lag if the WIAA scrape ran into trouble." — the all-caps
          "HEADS UP" prefix read as an alarm to a reader who just wanted
          a score. Same information, calmer voice: leads with the
          reassurance (auto-refresh), states the fact, notes the
          practical implication without blaming an upstream service. */}
      <strong>Scores refresh automatically.</strong> Last update was {ageLabel} —
      a longer gap than usual, so live scores may be a bit behind.
    </div>
  );
}
