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

  // Off-season trick: until the 2026 season starts producing live games,
  // anchor "now" to just after the most recent scraped game so Hero/Ticker
  // surface real content rather than collapsing to empty states. Drop this
  // shim once the scraper is hitting the 2026-27 season.
  const now = useMemo(() => {
    const last = games.reduce(
      (acc, g) => Math.max(acc, new Date(g.date).getTime()),
      0,
    );
    return last ? new Date(last + 60_000) : new Date();
  }, [games]);

  const featured = useMemo(() => pickFeaturedGame(games, now), [games, now]);
  const recent = useMemo(() => tickerGames(games, now, 21), [games, now]);
  const week = useMemo(() => pickFeaturedWeek(games, now), [games, now]);

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
