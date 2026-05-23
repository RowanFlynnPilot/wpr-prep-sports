import { useMemo } from "react";
import Layout from "../components/Layout.jsx";
import Hero from "../components/Hero.jsx";
import ScoreTicker from "../components/ScoreTicker.jsx";
import ThisWeekGrid from "../components/ThisWeekGrid.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import StaleBanner from "../components/StaleBanner.jsx";
import Sponsor from "../components/Sponsor.jsx";
import TopPerformers from "../components/TopPerformers.jsx";
import { pickFeaturedGame, tickerGames } from "../utils/games.js";
import { pickFeaturedWeek } from "../utils/weeks.js";

export default function DashboardPage({ dataset, schoolIndex, sponsors, sportConfig }) {
  const { meta, schools, games, standings, seasonStats } = dataset;

  // "anchor now" is the off-season content shim: pick games / ticker /
  // featured-week relative to just after the most-recent scraped game so
  // every section has real content even when today's real calendar date
  // is months past the last game. The off-season Hero treatment below
  // uses TODAY's real date for its countdown, not this anchor.
  const lastGameTs = useMemo(
    () => games.reduce((acc, g) => Math.max(acc, new Date(g.date).getTime()), 0),
    [games],
  );
  const anchorNow = useMemo(
    () => (lastGameTs ? new Date(lastGameTs + 60_000) : new Date()),
    [lastGameTs],
  );

  const featured = useMemo(() => pickFeaturedGame(games, anchorNow), [games, anchorNow]);
  const recent = useMemo(() => tickerGames(games, anchorNow, 21), [games, anchorNow]);
  const week = useMemo(() => pickFeaturedWeek(games, anchorNow), [games, anchorNow]);

  // Real today, for the off-season detection. We treat the sport as
  // off-season when the last game was > 14 days ago — short enough that
  // a Friday game still feels current on Tuesday, long enough that the
  // 4-month summer gap reliably triggers it.
  const offSeason = useMemo(() => {
    if (!lastGameTs) return false;
    const daysSinceLast = (Date.now() - lastGameTs) / 86_400_000;
    return daysSinceLast > 14;
  }, [lastGameTs]);

  const nextSeasonStart = useMemo(() => {
    if (!offSeason || !sportConfig?.nextSeasonStart) return null;
    const d = new Date(`${sportConfig.nextSeasonStart}T00:00:00-05:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [offSeason, sportConfig]);

  const daysToNext = useMemo(() => {
    if (!nextSeasonStart) return null;
    return Math.max(0, Math.ceil((nextSeasonStart - Date.now()) / 86_400_000));
  }, [nextSeasonStart]);

  const lastUpdated = meta?.last_updated
    ? new Date(meta.last_updated).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const weekLabel = week
    ? week.isCurrent
      ? "This Week"
      : `Week of ${new Date(week.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "This Week";

  return (
    <Layout
      lastUpdated={lastUpdated}
      sponsors={sponsors}
      footer={`Data via WIAA · ${games.length} games tracked · ${schools.length} schools`}
    >
      <StaleBanner
        lastUpdatedIso={meta?.last_updated}
        activeMonths={sportConfig?.activeMonths}
      />

      <Hero
        game={featured}
        schoolIndex={schoolIndex}
        games={games}
        seasonStats={seasonStats}
        offSeason={offSeason}
        sportConfig={sportConfig}
        nextSeasonStart={nextSeasonStart}
        daysToNext={daysToNext}
      />

      <section>
        <div className="section-header">
          <h2>{weekLabel}</h2>
          <span className="section-header__hint">
            {week ? `${week.games.length} games · grouped by day` : ""}
          </span>
        </div>
        <ThisWeekGrid week={week} schoolIndex={schoolIndex} allGames={games} />
      </section>

      <section>
        <div className="section-header">
          <h2>Recent Scores</h2>
          <Sponsor slot="ticker" sponsors={sponsors} variant="inline" />
        </div>
        <ScoreTicker games={recent} schoolIndex={schoolIndex} allGames={games} />
      </section>

      <section>
        <div className="section-header">
          <h2>Conference Standings</h2>
          <span className="section-header__hint">
            {sportConfig.label} · {sportConfig.season}
          </span>
        </div>
        <div className="standings-grid">
          {standings.map((s) => (
            <StandingsTable
              key={`${s.conference}-${s.sport}`}
              standing={s}
              schoolIndex={schoolIndex}
              sponsors={sponsors}
              seasonStats={seasonStats}
              sportConfig={sportConfig}
            />
          ))}
        </div>
      </section>

      {seasonStats && seasonStats.length > 0 && (
        <section>
          <div className="section-header">
            <h2>Top Performers</h2>
            <span className="section-header__hint">Season leaders across all tracked schools</span>
          </div>
          <TopPerformers rows={seasonStats} schoolIndex={schoolIndex} n={5} />
        </section>
      )}
    </Layout>
  );
}
