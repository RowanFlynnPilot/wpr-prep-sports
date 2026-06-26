import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import SectionTabs from "../components/SectionTabs.jsx";
import { buildNotable } from "../utils/notable.js";
import Hero from "../components/Hero.jsx";
import ScoreTicker from "../components/ScoreTicker.jsx";
import ThisWeekGrid from "../components/ThisWeekGrid.jsx";
import MonthCalendar from "../components/MonthCalendar.jsx";
import PlayerOfWeek from "../components/PlayerOfWeek.jsx";
import TournamentBracket from "../components/TournamentBracket.jsx";
import Notable from "../components/Notable.jsx";
import Pickem from "../components/Pickem.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import StaleBanner from "../components/StaleBanner.jsx";
import { isEmbedded } from "../utils/iframe.js";
import Sponsor from "../components/Sponsor.jsx";
import TopPerformers from "../components/TopPerformers.jsx";
import Marquee from "../components/Marquee.jsx";
import SpiritStrip from "../components/SpiritStrip.jsx";
import PowerRankings from "../components/PowerRankings.jsx";
import { pickFeaturedGame, tickerGames } from "../utils/games.js";
import { pickFeaturedWeek } from "../utils/weeks.js";
import { pickMarqueeGame } from "../utils/marquee.js";
import { SPORT_IDS } from "../config/sports.js";

/** True if any season-stats row is for an actual player (not a "Team" total). */
function hasPlayerRows(rows) {
  return (rows ?? []).some((r) => r.player_name && r.player_name !== "Team");
}

export default function DashboardPage({ dataset, schoolIndex, sponsors, sportConfig }) {
  const { meta, schools, games, standings, seasonStats, spirit, potwOverride, powerRankings } = dataset;

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

  // Marquee pick — single high-stakes game above the hero. In-season:
  // upcoming Game of the Week. Off-season: Match of the Season callout.
  const marquee = useMemo(
    () => pickMarqueeGame({ games, schoolsById: schoolIndex, offSeason }),
    [games, schoolIndex, offSeason],
  );

  const lastUpdated = meta?.last_updated
    ? new Date(meta.last_updated).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  // Same threshold as StaleBanner: 4 hours in-season, 48 hours off-season.
  const dataStale = useMemo(() => {
    if (!meta?.last_updated) return false;
    const ageHours =
      (Date.now() - new Date(meta.last_updated).getTime()) / 3_600_000;
    const inSeason = (sportConfig?.activeMonths ?? []).includes(
      new Date().getMonth(),
    );
    return ageHours > (inSeason ? 4 : 48);
  }, [meta?.last_updated, sportConfig?.activeMonths]);

  // Only show the "This Week" section when we're actually in a week that
  // has games — the prior off-season fallback ("Week of Oct 17") read as
  // misleading. The new month calendar covers the off-season gap.
  const showThisWeek = week?.isCurrent === true;

  // --- Section tabs ---------------------------------------------------
  // Marquee + Hero + Player of the Week stay pinned above the tabs; the
  // rest of the dashboard is grouped into four tabs so the page isn't one
  // long scroll. A tab only appears when it has content (no empty tabs
  // for coverage-in-progress or stat-less sports). The active tab is
  // URL-synced (?tab=) so deep links and sponsor links land on it.
  const notableItems = useMemo(
    () => buildNotable({ games, standings, seasonStats, sportConfig }),
    [games, standings, seasonStats, sportConfig],
  );
  const hasStatsTab =
    standings.length > 0 ||
    (powerRankings?.rankings?.length ?? 0) > 0 ||
    (seasonStats?.length > 0 && hasPlayerRows(seasonStats)) ||
    games.some((g) => g.playoff);
  const hasSpotlightTab = notableItems.length > 0 || (spirit?.length ?? 0) > 0;

  const tabDefs = [
    { id: "scores", label: "Scores", show: games.length > 0 },
    { id: "schedule", label: "Schedule", show: games.length > 0 },
    { id: "standings", label: "Standings & Stats", show: hasStatsTab },
    { id: "spotlight", label: "Spotlight", show: hasSpotlightTab },
  ];
  const tabs = tabDefs.filter((t) => t.show);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = tabs.some((t) => t.id === requestedTab)
    ? requestedTab
    : tabs[0]?.id;
  const setActiveTab = (id) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", id);
        return next;
      },
      { replace: true },
    );

  return (
    <Layout
      lastUpdated={lastUpdated}
      dataStale={dataStale}
      sponsors={sponsors}
      footerStats={{
        sports: SPORT_IDS.length,
        games: games.length,
        schools: schools.length,
      }}
    >
      {!isEmbedded && (
        <StaleBanner
          lastUpdatedIso={meta?.last_updated}
          activeMonths={sportConfig?.activeMonths}
        />
      )}

      {standings.length === 0 && (
        <div className="coverage-note" role="status">
          <strong>Coverage in progress.</strong>{" "}
          We track {sportConfig.label.toLowerCase()} schedules and scores, but
          conference standings and team stats aren't wired up yet — most of the
          central-WI programs are co-op entries that need extra manifest work.
          The schedule and recent scores below are accurate.
        </div>
      )}

      {/* Pinned showcase — always visible above the tabs. */}
      <Marquee pick={marquee} sportConfig={sportConfig} sponsors={sponsors} />

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

      <PlayerOfWeek
        games={games}
        schoolIndex={schoolIndex}
        sponsors={sponsors}
        sportConfig={sportConfig}
        override={potwOverride}
      />

      <SectionTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab && (
        <Sponsor
          slot={`tab:${activeTab}`}
          sponsors={sponsors}
          variant="inline"
          className="section-tabs__sponsor"
        />
      )}

      {/* Tab: Scores — the live scoreboard. */}
      {activeTab === "scores" && (
        <>
          {showThisWeek && (
            <section>
              <div className="section-header">
                <h2>This Week</h2>
                <span className="section-header__hint">
                  {week.games.length} games · grouped by day
                </span>
              </div>
              <ThisWeekGrid week={week} schoolIndex={schoolIndex} allGames={games} sportConfig={sportConfig} />
            </section>
          )}

          <section>
            <div className="section-header">
              <h2>Recent Scores</h2>
              <Sponsor slot="ticker" sponsors={sponsors} variant="inline" />
            </div>
            <ScoreTicker games={recent} schoolIndex={schoolIndex} allGames={games} sportConfig={sportConfig} />
          </section>

          <Pickem games={games} schoolIndex={schoolIndex} sponsors={sponsors} />
        </>
      )}

      {/* Tab: Schedule — full-season calendar. */}
      {activeTab === "schedule" && games.length > 0 && (
        <section>
          <div className="section-header">
            <h2>Schedule</h2>
            <span className="section-header__hint">Month at a glance · click a day for details</span>
          </div>
          <MonthCalendar
            key={sportConfig.id}
            games={games}
            schoolIndex={schoolIndex}
            sportConfig={sportConfig}
          />
        </section>
      )}

      {/* Tab: Standings & Stats — the league picture. */}
      {activeTab === "standings" && (
        <>
          {standings.length > 0 && (
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
                    games={games}
                  />
                ))}
              </div>
            </section>
          )}

          <PowerRankings
            rankings={powerRankings?.rankings}
            method={powerRankings?.method}
            schoolIndex={schoolIndex}
            sponsors={sponsors}
            sportConfig={sportConfig}
          />

          {seasonStats && seasonStats.length > 0 && hasPlayerRows(seasonStats) && (
            <section>
              <div className="section-header">
                <h2>Top Performers</h2>
                <span className="section-header__hint">Season leaders across all tracked schools</span>
              </div>
              <TopPerformers
                rows={seasonStats}
                schoolIndex={schoolIndex}
                sportConfig={sportConfig}
                n={5}
              />
            </section>
          )}

          {games.some((g) => g.playoff) && (
            <section>
              <div className="section-header">
                <h2>Playoff Bracket</h2>
                <span className="section-header__hint">WIAA tournament · {sportConfig.label}</span>
              </div>
              <TournamentBracket
                games={games}
                schoolIndex={schoolIndex}
                sportConfig={sportConfig}
              />
            </section>
          )}
        </>
      )}

      {/* Tab: Spotlight — editorial & community. */}
      {activeTab === "spotlight" && (
        <>
          <Notable
            games={games}
            standings={standings}
            seasonStats={seasonStats}
            sportConfig={sportConfig}
            schoolIndex={schoolIndex}
          />

          <SpiritStrip photos={spirit} schoolIndex={schoolIndex} sportConfig={sportConfig} />
        </>
      )}
    </Layout>
  );
}
