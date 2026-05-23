import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { fetchDataset } from "./data/fetchDataset.js";
import DashboardPage from "./pages/DashboardPage.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import { indexSchools } from "./utils/schools.js";

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

  useEffect(() => {
    fetchDataset()
      .then(setDataset)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">Couldn’t load scores: {error}</div>;
  if (!dataset) return <div className="loading">Loading scores…</div>;

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
