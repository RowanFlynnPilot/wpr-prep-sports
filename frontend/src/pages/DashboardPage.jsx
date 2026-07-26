import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import SectionTabs, { tabId, panelId } from "../components/SectionTabs.jsx";
import { buildNotable } from "../utils/notable.js";
import Hero from "../components/Hero.jsx";
import ScoreTicker from "../components/ScoreTicker.jsx";
import ThisWeekGrid from "../components/ThisWeekGrid.jsx";
import MonthCalendar from "../components/MonthCalendar.jsx";
import PlayerOfWeek from "../components/PlayerOfWeek.jsx";
import TournamentBracket from "../components/TournamentBracket.jsx";
import SectionBoundary from "../components/SectionBoundary.jsx";
import Notable from "../components/Notable.jsx";
import Pickem from "../components/Pickem.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import StaleBanner from "../components/StaleBanner.jsx";
import FavoritesStrip from "../components/FavoritesStrip.jsx";
import { isEmbedded } from "../utils/iframe.js";
import Sponsor from "../components/Sponsor.jsx";
import TopPerformers from "../components/TopPerformers.jsx";
import Marquee from "../components/Marquee.jsx";
import SpiritStrip from "../components/SpiritStrip.jsx";
import SeniorSpotlight from "../components/SeniorSpotlight.jsx";
import PowerRankings from "../components/PowerRankings.jsx";
import { pickFeaturedGame, tickerGames } from "../utils/games.js";
import { pickFeaturedWeek } from "../utils/weeks.js";
import { pickMarqueeGame } from "../utils/marquee.js";
import { SPORT_IDS } from "../config/sports.js";
import { trackEvent } from "../utils/analytics.js";
import { SITE, SITE_TITLE } from "../config/site.js";

/** Heading label for a sport, falling back if the registry entry is thin. */
function configLabelForHeading(sportConfig) {
  return sportConfig?.label ?? "Scores";
}

/** True if any season-stats row is for an actual player (not a "Team" total). */
function hasPlayerRows(rows) {
  return (rows ?? []).some((r) => r.player_name && r.player_name !== "Team");
}

/**
 * Share of a sport's tracked roster that has a schedule published yet.
 * WIAA posts a new season school-by-school over several weeks, so a
 * rolled-over sport spends a while holding a handful of real fixtures and
 * one-team conference tables. Accurate data — but presented as a live
 * season it reads as broken coverage, so we caption it honestly instead.
 */
function rosterCoverage(schools, games, sportId) {
  const roster = new Set(
    (schools ?? [])
      .filter((s) => (s.conferences ?? []).some((c) => c.sport === sportId))
      .map((s) => s.id),
  );
  if (roster.size === 0) return 1;
  const scheduled = new Set();
  for (const g of games ?? []) {
    for (const side of [g.home, g.away]) {
      if (side?.school_id && roster.has(side.school_id)) scheduled.add(side.school_id);
    }
  }
  return scheduled.size / roster.size;
}

/** Below this share of the roster, a rolled-over season is "still posting". */
const SCHEDULE_COVERAGE_FLOOR = 1 / 3;

/** A conference table needs at least two teams to be worth rendering. */
function isMeaningfulTable(standing) {
  return (standing?.rows?.length ?? 0) >= 2;
}

export default function DashboardPage({
  dataset,
  schoolIndex,
  sponsors,
  sportConfig,
  liveRefreshStalled = false,
}) {
  const { meta, schools, games, standings, seasonStats, spirit, potwOverride, powerRankings } = dataset;

  // "anchor now" is the content shim: pick games / ticker / featured-week
  // relative to a date clamped INTO the season window, so every section
  // has real content in all three phases —
  //   preseason  (new schedule, no games played): anchor = season opener,
  //   in-season:                                  anchor = actual today,
  //   off-season (all games in the past):         anchor = just after the
  //                                               final game.
  // The off-season Hero treatment below uses TODAY's real date for its
  // countdown, not this anchor.
  const lastGameTs = useMemo(
    () => games.reduce((acc, g) => Math.max(acc, new Date(g.date).getTime()), 0),
    [games],
  );
  const firstGameTs = useMemo(
    () =>
      games.reduce(
        (acc, g) => Math.min(acc, new Date(g.date).getTime()),
        Number.POSITIVE_INFINITY,
      ),
    [games],
  );
  const anchorNow = useMemo(() => {
    if (!lastGameTs) return new Date();
    const clamped = Math.min(Math.max(Date.now(), firstGameTs), lastGameTs + 60_000);
    return new Date(clamped);
  }, [firstGameTs, lastGameTs]);

  // Preseason: the schedule is published but nothing has been played yet, so
  // `anchorNow` is sitting on the opener rather than today. The sections
  // below still fill correctly, but their in-season headings ("This Week",
  // "Recent Scores") would caption opening-night fixtures as if they were
  // current results — misleading for the weeks between the schedule landing
  // and the first whistle. Retitle instead of hiding: the opening slate is
  // exactly what readers want to see in that window.
  const preseason = useMemo(
    () => Number.isFinite(firstGameTs) && firstGameTs > Date.now(),
    [firstGameTs],
  );

  // A rolled-over sport whose schedules WIAA has barely started posting.
  // Gated on `preseason` so it only describes the rollover window, never a
  // live season having a quiet week.
  const scheduleStillPosting = useMemo(
    () =>
      preseason &&
      rosterCoverage(schools, games, sportConfig?.id) < SCHEDULE_COVERAGE_FLOOR,
    [preseason, schools, games, sportConfig?.id],
  );

  const featured = useMemo(() => pickFeaturedGame(games, anchorNow), [games, anchorNow]);
  const recent = useMemo(() => tickerGames(games, anchorNow, 21), [games, anchorNow]);
  const week = useMemo(() => pickFeaturedWeek(games, anchorNow), [games, anchorNow]);

  // Real today, for the off-season detection. We treat the sport as
  // off-season when the last game was > 14 days ago — short enough that
  // a Friday game still feels current on Tuesday, long enough that the
  // 4-month summer gap reliably triggers it. Archive view opts out:
  // when reliving a finished season, show it in full swing (featured
  // game hero), not a countdown to a season that already happened.
  const offSeason = useMemo(() => {
    if (!lastGameTs || dataset.archiveSeason) return false;
    const daysSinceLast = (Date.now() - lastGameTs) / 86_400_000;
    return daysSinceLast > 14;
  }, [lastGameTs, dataset.archiveSeason]);

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
  // Standings only count toward the tab once a table has two teams in it —
  // a rolled-over sport can carry a single 0-0 row for weeks, and a
  // one-team "conference" reads as a bug rather than a season starting.
  const meaningfulStandings = useMemo(
    () => standings.filter(isMeaningfulTable),
    [standings],
  );
  const hasStatsTab =
    meaningfulStandings.length > 0 ||
    (powerRankings?.rankings?.length ?? 0) > 0 ||
    (seasonStats?.length > 0 && hasPlayerRows(seasonStats)) ||
    games.some((g) => g.playoff);
  const hasSpotlightTab = notableItems.length > 0 || (spirit?.length ?? 0) > 0;

  // Icons echo the sport switcher's emoji treatment one row above. Labels
  // are full-length everywhere — on a phone "Standings & Stats" wraps onto
  // a second line rather than being abbreviated away.
  const tabDefs = [
    { id: "scores", label: "Scores", icon: "🆚", show: games.length > 0 },
    { id: "schedule", label: "Schedule", icon: "📅", show: games.length > 0 },
    { id: "standings", label: "Standings & Stats", icon: "📊", show: hasStatsTab },
    { id: "spotlight", label: "Spotlight", icon: "⭐", show: hasSpotlightTab },
  ];
  const tabs = tabDefs.filter((t) => t.show);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = tabs.some((t) => t.id === requestedTab)
    ? requestedTab
    : tabs[0]?.id;
  const setActiveTab = (id) => {
    trackEvent("tab-switch", { tab: id, sport: sportConfig?.id ?? "unknown" });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", id);
        return next;
      },
      { replace: true },
    );
  };

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
      {/* The dashboard's visual identity is the masthead, which is a link
          rather than a heading — so this view had no <h1> at all, leaving
          screen-reader users without a document title to orient by and
          giving crawlers no top-level heading. Visually hidden because the
          masthead already says it on screen; the sport is included because
          it is what actually distinguishes one dashboard from another. */}
      <h1 className="sr-only">
        {configLabelForHeading(sportConfig)} — {SITE_TITLE}
      </h1>

      {!isEmbedded && !dataset.archiveSeason && (
        <StaleBanner
          lastUpdatedIso={meta?.last_updated}
          activeMonths={sportConfig?.activeMonths}
        />
      )}

      {liveRefreshStalled && (
        <div className="live-stall-note" role="status">
          Live updates are lagging — scores may be a minute or two behind.
          They&rsquo;ll catch up automatically.
        </div>
      )}

      {/* Safety-net note: with the preseason 0-0 standings fix in the
          scraper this should never fire for a fully-scraped sport — it
          covers partial mid-publish states (e.g. WIAA still loading a
          new season's schedules). */}
      {games.length > 0 && (scheduleStillPosting || !standings.some(isMeaningfulTable)) && (
        <div className="coverage-note" role="status">
          <strong>Early look.</strong>{" "}
          {sportConfig.label} schedules for {sportConfig.season} are still being
          published by {SITE.governingBody} — most of the slate, and the
          conference standings, will fill in over the coming weeks. Everything
          shown below is accurate; there just isn&rsquo;t much of it yet.
        </div>
      )}

      {/* Reader's own schools, above everything else — the whole point of
          favoriting. Renders nothing when none are set, so a first-time
          visitor sees the dashboard exactly as before. */}
      <SectionBoundary label="favorites">
        <FavoritesStrip
          dataset={dataset}
          schoolIndex={schoolIndex}
          sponsors={sponsors}
          sportConfig={sportConfig}
          now={anchorNow.getTime()}
        />
      </SectionBoundary>

      {/* Pinned showcase — always visible above the tabs. Each pinned
          section is fenced so one crashing can't take down the page. */}
      <SectionBoundary label="marquee">
        <Marquee pick={marquee} sportConfig={sportConfig} sponsors={sponsors} schoolIndex={schoolIndex} />
      </SectionBoundary>

      <SectionBoundary label="hero">
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
      </SectionBoundary>

      <SectionBoundary label="player-of-week">
        <PlayerOfWeek
          games={games}
          schoolIndex={schoolIndex}
          sponsors={sponsors}
          sportConfig={sportConfig}
          override={potwOverride}
        />
      </SectionBoundary>

      <SectionTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab && (
        <Sponsor
          slot={`tab:${activeTab}`}
          sponsors={sponsors}
          variant="inline"
          className="section-tabs__sponsor"
        />
      )}

      {/* Keyed wrapper: remounts on tab change so the panel fades in.
          role/aria wire it to the tab that controls it — without this the
          tablist announces tabs that control nothing. */}
      <div
        key={activeTab}
        className="tab-panel"
        id={activeTab ? panelId(activeTab) : undefined}
        role={activeTab ? "tabpanel" : undefined}
        aria-labelledby={activeTab ? tabId(activeTab) : undefined}
        tabIndex={-1}
      >
      {/* Tab: Scores — the live scoreboard. */}
      {activeTab === "scores" && (
        <>
          {showThisWeek && (
            <section>
              <div className="section-header">
                <h2>{preseason ? "Opening Week" : "This Week"}</h2>
                <span className="section-header__hint">
                  {week.games.length} {week.games.length === 1 ? "game" : "games"} · grouped by day
                </span>
              </div>
              <ThisWeekGrid week={week} schoolIndex={schoolIndex} allGames={games} sportConfig={sportConfig} />
            </section>
          )}

          <section>
            <div className="section-header">
              <h2>{preseason ? "Season Openers" : "Recent Scores"}</h2>
              <Sponsor slot="ticker" sponsors={sponsors} variant="inline" />
            </div>
            <ScoreTicker games={recent} schoolIndex={schoolIndex} allGames={games} sportConfig={sportConfig} />
          </section>

          <SectionBoundary label="pickem">
            <Pickem
              games={games}
              schoolIndex={schoolIndex}
              sponsors={sponsors}
              sportId={sportConfig?.id}
              now={anchorNow.getTime()}
            />
          </SectionBoundary>
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
          {meaningfulStandings.length > 0 && (
            <section>
              <div className="section-header">
                <h2>Conference Standings</h2>
                <span className="section-header__hint">
                  {sportConfig.label} · {sportConfig.season}
                </span>
              </div>
              <div className="standings-grid">
                {meaningfulStandings.map((s) => (
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
                <span className="section-header__hint">{SITE.governingBody} tournament · {sportConfig.label}</span>
              </div>
              <SectionBoundary label="bracket">
                <TournamentBracket
                  games={games}
                  schoolIndex={schoolIndex}
                  sportConfig={sportConfig}
                />
              </SectionBoundary>
            </section>
          )}
        </>
      )}

      {/* Tab: Spotlight — editorial & community. */}
      {activeTab === "spotlight" && (
        <>
          <SeniorSpotlight
            spotlights={dataset.spotlights}
            schoolIndex={schoolIndex}
            sponsors={sponsors}
            sportId={sportConfig?.id}
          />

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
      </div>
    </Layout>
  );
}
