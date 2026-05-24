import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";
import SportSwitcher from "./SportSwitcher.jsx";
import Footer from "./Footer.jsx";
import { useSportPrefix } from "../utils/links.js";

// Self-hosted under frontend/public so we don't depend on the WPR CDN
// (which previously rendered blank in some browsers / iframe contexts).
// BASE_URL resolves to "/wpr-prep-sports/" on GitHub Pages or whatever
// VITE_BASE is set to.
const WPR_LOGO = `${import.meta.env.BASE_URL}wpr-logo.png`;

/**
 * Shared shell: navy WPR masthead + freshness footer slot. All pages render
 * inside this so the iframe feels like one widget regardless of which view
 * the user is on.
 */
export default function Layout({
  children,
  footerStats,
  lastUpdated,
  dataStale = false,
  breadcrumb,
  sponsors,
}) {
  const sportPrefix = useSportPrefix();
  return (
    <div className="app">
      <header className="masthead">
        <a
          href="https://wausaupilotandreview.com"
          className="masthead__brand"
          aria-label="Wausau Pilot & Review"
        >
          <img
            src={WPR_LOGO}
            alt="Wausau Pilot & Review"
            className="masthead__brand-logo"
            loading="eager"
            decoding="async"
          />
        </a>
        <span className="masthead__divider" aria-hidden="true" />
        <Link to={sportPrefix} className="masthead__title">
          Central Wisconsin <em>Prep Sports</em>
        </Link>
        <div className="masthead__attribution">
          <Sponsor slot="title" sponsors={sponsors} variant="compact" />
          {lastUpdated && (
            <div
              className={
                "masthead__updated" +
                (dataStale ? " masthead__updated--stale" : " masthead__updated--fresh")
              }
              title={dataStale ? "Scrape hasn't run recently" : "Data is up to date"}
            >
              <span className="masthead__updated-dot" aria-hidden="true" />
              Updated {lastUpdated}
            </div>
          )}
        </div>
      </header>

      <SportSwitcher />

      {breadcrumb && (
        <nav aria-label="Breadcrumb" className="breadcrumb">
          {breadcrumb}
        </nav>
      )}

      <main className="app-main">{children}</main>

      {/* Don't pass lastUpdated — already shown in the masthead, no point
          duplicating it at the bottom of the page. */}
      <Footer stats={footerStats} />
    </div>
  );
}
