import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./styles/global.css";
import "./styles/hardening.css";

// HashRouter (not BrowserRouter) is the correct choice for an embedded
// iframe widget: it doesn't require server-side route configuration on
// the host site, and survives the GitHub Pages base path cleanly.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
