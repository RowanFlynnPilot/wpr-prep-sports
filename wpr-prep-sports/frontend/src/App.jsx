import { useEffect, useState } from "react";
import { fetchDataset } from "./data/fetchDataset.js";
import ScoreTicker from "./components/ScoreTicker.jsx";
import "./styles/App.css";

export default function App() {
  const [dataset, setDataset] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDataset()
      .then(setDataset)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">Couldn’t load scores: {error}</div>;
  if (!dataset) return <div className="loading">Loading scores…</div>;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Central Wisconsin High School Sports</h1>
        <p className="tagline">
          Powered by <a href="https://wausaupilotandreview.com">Wausau Pilot &amp; Review</a>
        </p>
      </header>

      <ScoreTicker games={dataset.games} />

      <main className="app-main">
        {/* TODO: schedule grid, standings, per-team pages */}
        <p>
          Data last updated:{" "}
          {dataset.meta.last_updated
            ? new Date(dataset.meta.last_updated).toLocaleString()
            : "—"}
        </p>
      </main>
    </div>
  );
}
