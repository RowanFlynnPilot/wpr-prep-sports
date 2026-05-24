import { useEffect, useMemo, useState } from "react";
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
import OgCardPage from "./pages/OgCardPage.jsx";
import PlayerPage from "./pages/PlayerPage.jsx";
import Skeleton from "./components/Skeleton.jsx";
import { indexSchools } from "./utils/schools.js";
import { useIframeHeightReporter } from "./utils/iframe.js";
import { DEFAULT_SPORT, configFor, isKnownSport } from "./config/sports.js";

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
import "./styles/OgCard.css";
import "./styles/Spirit.css";
import "./styles/PowerRankings.css";
import "./styles/PlayerPage.css";
import "./styles/Marquee.css";

export default function App() {
  useIframeHeightReporter();

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
          the card with no widget chrome around it. */}
      <Route path="/card/:sport/:gameId" element={<OgCardPage />} />

      {/* Sport-scoped routes. SportShell fetches that sport's dataset and
          renders nested routes once it's loaded. */}
      <Route path="/:sport/*" element={<SportShell />} />

      {/* Fallback for unknown URLs. */}
      <Route path="*" element={<Navigate to={`/${DEFAULT_SPORT}`} replace />} />
    </Routes>
  );
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

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    setDataset(null);
    setError(null);
    fetchDataset(sport)
      .then((d) => !cancelled && setDataset(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sport, valid]);

  // Live auto-refresh: when any game in the current dataset is mid-play,
  // re-fetch every 60s so the Friday Night Lights crowd sees scores
  // tick up without a manual refresh.
  const hasLiveGame = useMemo(
    () => (dataset?.games ?? []).some((g) => g.status === "in_progress"),
    [dataset?.games],
  );
  useEffect(() => {
    if (!valid || !hasLiveGame) return;
    const id = setInterval(() => {
      fetchDataset(sport)
        .then((d) => setDataset(d))
        .catch(() => {/* ignore — next tick will retry */});
    }, 60_000);
    return () => clearInterval(id);
  }, [sport, valid, hasLiveGame]);

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
            Central Wisconsin <em>Prep Sports</em>
          </div>
        </header>
        <main className="app-main">
          <div className="boundary">
            <h2>Scores temporarily unavailable.</h2>
            <p>
              We couldn't load the latest {configFor(sport).label} data. The
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

  if (!dataset) return <Skeleton />;

  const schoolIndex = indexSchools(dataset.schools, dataset.games);
  const sportConfig = configFor(sport);
  // Sanity: avoid stale dataset mismatching the URL during the brief
  // window between sport-id change and dataset arrival.
  void location;

  // Per-sport accent: re-emit --accent / --accent-700 from sportConfig so
  // every existing `var(--accent)` consumer recolors automatically when the
  // user switches sports — no per-component plumbing needed.
  const accentStyle = {
    "--accent": sportConfig.accentColor,
    "--accent-700": sportConfig.accentDarkColor,
  };

  return (
    <div className="sport-shell" data-sport={sport} style={accentStyle}>
    <Routes>
      <Route
        path="/"
        element={
          <DashboardPage
            dataset={dataset}
            schoolIndex={schoolIndex}
            sponsors={dataset.sponsors}
            sportConfig={sportConfig}
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
    </Routes>
    </div>
  );
}
