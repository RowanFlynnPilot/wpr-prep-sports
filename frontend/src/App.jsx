import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { fetchDataset } from "./data/fetchDataset.js";
import DashboardPage from "./pages/DashboardPage.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import GamePage from "./pages/GamePage.jsx";
import PlayerPage from "./pages/PlayerPage.jsx";
import EmbedPage from "./pages/EmbedPage.jsx";
import Skeleton from "./components/Skeleton.jsx";
import NotFound from "./components/NotFound.jsx";

// Route-split: readers never visit the media kit or the OG-card
// generator target, so neither belongs in the main bundle. Their CSS
// moves with them (imported inside each page component).
const MediaKitPage = lazy(() => import("./pages/MediaKitPage.jsx"));
const OgCardPage = lazy(() => import("./pages/OgCardPage.jsx"));
import { indexSchools } from "./utils/schools.js";
import { useAnalytics } from "./utils/analytics.js";
import { useIframeHeightReporter } from "./utils/iframe.js";
import { DEFAULT_SPORT, configFor, configForDataset, isKnownSport } from "./config/sports.js";
import { SITE } from "./config/site.js";

import "./styles/App.css";
import "./styles/TeamLogo.css";
import "./styles/Hero.css";
import "./styles/ScoreTicker.css";
import "./styles/StandingsTable.css";
import "./styles/ThisWeekGrid.css";
import "./styles/MonthCalendar.css";
import "./styles/PlayerOfWeek.css";
import "./styles/TournamentBracket.css";
import "./styles/ScoringSummary.css";
import "./styles/Notable.css";
import "./styles/Pickem.css";
import "./styles/TeamPage.css";
import "./styles/Sponsor.css";
import "./styles/SeasonLeaders.css";
import "./styles/TopPerformers.css";
import "./styles/GamePage.css";
import "./styles/GamePreview.css";
import "./styles/HeadToHead.css";
import "./styles/Spirit.css";
import "./styles/PowerRankings.css";
import "./styles/PlayerPage.css";
import "./styles/Marquee.css";
import "./styles/Embed.css";
import "./styles/SeniorSpotlight.css";
import "./styles/Favorites.css";
import "./styles/Share.css";

export default function App() {
  useIframeHeightReporter();
  useAnalytics();
  useScrollToTopOnNavigate();

  return (
    <Routes>
      {/* Default landing → DEFAULT_SPORT's dashboard. */}
      <Route path="/" element={<Navigate to={`/${DEFAULT_SPORT}`} replace />} />

      {/* Legacy URLs (pre-phase-1, no sport prefix) → DEFAULT_SPORT prefix. */}
      <Route
        path="/team/:schoolId"
        element={<LegacyRedirect kind="team" />}
      />
      <Route
        path="/game/:gameId"
        element={<LegacyRedirect kind="game" />}
      />

      {/* OG share-card route — fetched by the PNG generator, never linked
          from the UI. Bypasses SportShell so the screenshot only captures
          the card with no widget chrome around it. Null fallback is safe:
          the generator waits for [data-og-ready], not first paint. */}
      <Route
        path="/card/:sport/:gameId"
        element={
          <Suspense fallback={null}>
            <OgCardPage />
          </Suspense>
        }
      />

      {/* Sponsor media kit — cross-sport sales page, linked from the footer. */}
      <Route
        path="/sponsor"
        element={
          <Suspense fallback={<Skeleton />}>
            <MediaKitPage />
          </Suspense>
        }
      />

      {/* Sport-scoped routes. SportShell fetches that sport's dataset and
          renders nested routes once it's loaded. */}
      <Route path="/:sport/*" element={<SportShell />} />

      {/* Fallback for unknown URLs. */}
      <Route path="*" element={<Navigate to={`/${DEFAULT_SPORT}`} replace />} />
    </Routes>
  );
}

/**
 * Scroll back to the top on every route change, the way a full page
 * navigation would. Without this, clicking a game from deep in the
 * scores list rendered the (much shorter) game page at the old scroll
 * offset. Standalone that strands the reader mid-page; embedded it's a
 * no-op (the iframe's own window never scrolls) — the host page's
 * matching correction rides on the `:navigated` message the height
 * reporter posts (see utils/iframe.js and the README snippet).
 */
function useScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
}

/**
 * Redirect a pre-phase-1 URL like `/team/auburndale` to its sport-scoped
 * equivalent `/football/team/auburndale`. Kept so the existing WPR
 * iframe and any bookmarks survive the path change indefinitely.
 */
function LegacyRedirect({ kind }) {
  const params = useParams();
  const id = kind === "team" ? params.schoolId : params.gameId;
  return <Navigate to={`/${DEFAULT_SPORT}/${kind}/${id}`} replace />;
}

/**
 * Mounts under `/:sport/*`. Reads the current sport from the URL,
 * fetches that sport's dataset, and renders the sport's pages.
 *
 * Remounting on sport change is intentional — each sport's dataset is
 * a separate fetch, so we re-skeleton during the switch rather than
 * trying to interpolate stale state across sports.
 */
function SportShell() {
  const { sport } = useParams();
  const location = useLocation();
  const valid = isKnownSport(sport);
  const [dataset, setDataset] = useState(null);
  const [error, setError] = useState(null);
  const [refreshFailures, setRefreshFailures] = useState(0);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    setDataset(null);
    setError(null);
    setRefreshFailures(0);
    fetchDataset(sport)
      .then((d) => !cancelled && setDataset(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sport, valid]);

  // Live auto-refresh: when any game in the current dataset is mid-play,
  // re-fetch every 60s so the Friday Night Lights crowd sees scores
  // tick up without a manual refresh. Failures keep the last good data
  // on screen but are counted — after two misses the dashboard shows a
  // "scores may lag" note instead of silently freezing.
  const hasLiveGame = useMemo(
    () => (dataset?.games ?? []).some((g) => g.status === "in_progress"),
    [dataset?.games],
  );
  useEffect(() => {
    if (!valid || !hasLiveGame) return;
    // cancelled guard matters here as much as on the initial load: a
    // refresh in flight when the user switches sports would otherwise
    // land AFTER the new sport's dataset, and the sport-mismatch guard
    // below would strand the widget on the skeleton.
    let cancelled = false;
    const id = setInterval(() => {
      fetchDataset(sport)
        .then((d) => {
          if (cancelled) return;
          setDataset(d);
          setRefreshFailures(0);
        })
        .catch((e) => {
          if (cancelled) return;
          console.warn(`[${SITE.messageNamespace}] live refresh failed:`, e);
          setRefreshFailures((n) => n + 1);
        });
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sport, valid, hasLiveGame]);

  // Season label follows the dataset, not the registry — see
  // configForDataset(). Memoized on the season string so the identity stays
  // stable across re-renders; several pages take sportConfig as a useMemo
  // dependency.
  const sportConfig = useMemo(
    () => configForDataset(sport, dataset?.meta?.season),
    [sport, dataset?.meta?.season],
  );

  // Unknown sport → bounce to default after hooks have run, so hook order
  // stays stable on subsequent renders.
  if (!valid) {
    return <Navigate to={`/${DEFAULT_SPORT}`} replace />;
  }

  if (error) {
    return (
      <div className="app">
        <header className="masthead">
          <div className="masthead__title">
            {SITE.titleLead} <em>{SITE.titleEm}</em>
          </div>
        </header>
        <main className="app-main">
          <div className="boundary">
            <h2>Scores temporarily unavailable.</h2>
            <p>
              We couldn&rsquo;t load the latest {configFor(sport).label} data. The
              scraper or GitHub Pages may be having a moment — please check
              back shortly.
            </p>
            <p style={{ fontSize: "0.8rem", color: "var(--muted-2)" }}>
              <code>{error}</code>
            </p>
            <button
              type="button"
              className="boundary__reload"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Guard against the brief window between a sport-id change and the new
  // dataset's arrival: state still holds the PREVIOUS sport's dataset for
  // one render (the [sport] effect clears it after), and pages like
  // GamePage would look up a volleyball game id in football's games and
  // bounce to the dashboard. The dataset knows which sport it is — treat
  // a mismatched one as still-loading.
  if (!dataset || dataset.sport !== sport) return <Skeleton />;

  const schoolIndex = indexSchools(dataset.schools, dataset.games);
  void location;

  // Accent is a single global token now (press red, matching the WPR
  // site's monochrome-plus-red look) — the per-sport accent recoloring
  // was retired in the 2026-07 retheme. data-sport stays for any
  // future sport-scoped styling.
  return (
    <div className="sport-shell" data-sport={sport}>
    <Routes>
      <Route
        path="/"
        element={
          <DashboardPage
            dataset={dataset}
            schoolIndex={schoolIndex}
            sponsors={dataset.sponsors}
            sportConfig={sportConfig}
            liveRefreshStalled={refreshFailures >= 2}
          />
        }
      />
      <Route
        path="/team/:schoolId"
        element={
          <TeamPage
            dataset={dataset}
            schoolIndex={schoolIndex}
            sponsors={dataset.sponsors}
            sportConfig={sportConfig}
          />
        }
      />
      {/* Chrome-free per-school module for WPR article/sidebar embeds. */}
      <Route
        path="/embed/:schoolId"
        element={
          <EmbedPage
            dataset={dataset}
            schoolIndex={schoolIndex}
            sportConfig={sportConfig}
          />
        }
      />
      <Route
        path="/player/:schoolId/:playerSlug"
        element={
          <PlayerPage
            dataset={dataset}
            schoolIndex={schoolIndex}
            sportConfig={sportConfig}
          />
        }
      />
      <Route
        path="/game/:gameId"
        element={
          <GamePage
            dataset={dataset}
            schoolIndex={schoolIndex}
            sportConfig={sportConfig}
          />
        }
      />
      {/* Anything else under a valid sport — a mistyped path, a shared
          URL an email client truncated mid-route — used to fall through
          to nothing: an empty sport-shell div, i.e. a blank page. */}
      <Route
        path="*"
        element={<NotFound kind="page" sportPrefix={`/${sport}`} sponsors={dataset.sponsors} />}
      />
    </Routes>
    </div>
  );
}
