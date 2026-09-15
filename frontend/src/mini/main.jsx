import React from "react";
import ReactDOM from "react-dom/client";
import MiniScoreboard, { MiniBoundary } from "./MiniScoreboard.jsx";
import { initTheme } from "../utils/theme.js";
import "../styles/global.css";
import "../styles/TeamLogo.css";
import "../styles/Sponsor.css";
import "../styles/Mini.css";

// Entry for mini.html — the homepage/sidebar scoreboard. Deliberately its
// own page: no router, no dashboard components, no full-season data. The
// dashboard's entry (main.jsx) never imports anything from here.
initTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MiniBoundary>
      <MiniScoreboard />
    </MiniBoundary>
  </React.StrictMode>,
);
