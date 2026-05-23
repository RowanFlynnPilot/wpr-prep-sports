import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { fetchDataset } from "./data/fetchDataset.js";
import DashboardPage from "./pages/DashboardPage.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import Skeleton from "./components/Skeleton.jsx";
import { indexSchools } from "./utils/schools.js";
import { useIframeHeightReporter } from "./utils/iframe.js";

import "./styles/App.css";
import "./styles/TeamLogo.css";
import "./styles/Hero.css";
import "./styles/ScoreTicker.css";
import "./styles/StandingsTable.css";
import "./styles/ThisWeekGrid.css";
import "./styles/TeamPage.css";

export default function App() {
  const [dataset, setDataset] = useState(null);
  const [error, setError] = useState(null);

  useIframeHeightReporter();

  useEffect(() => {
    let cancelled = false;
    fetchDataset()
      .then((d) => !cancelled && setDataset(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

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
              We couldn't load the latest scores. The scraper or GitHub Pages
              may be having a moment — please check back shortly.
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

  const schoolIndex = indexSchools(dataset.schools);

  return (
    <Routes>
      <Route
        path="/"
        element={<DashboardPage dataset={dataset} schoolIndex={schoolIndex} />}
      />
      <Route
        path="/team/:schoolId"
        element={<TeamPage dataset={dataset} schoolIndex={schoolIndex} />}
      />
    </Routes>
  );
}
