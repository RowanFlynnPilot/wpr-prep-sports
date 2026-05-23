import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";

/**
 * Shared shell: navy WPR masthead + freshness footer slot. All pages render
 * inside this so the iframe feels like one widget regardless of which view
 * the user is on.
 */
export default function Layout({ children, footer, lastUpdated, breadcrumb, sponsors }) {
  return (
    <div className="app">
      <header className="masthead">
        <Link to="/" className="masthead__title">
          Central Wisconsin <em>Prep Sports</em>
        </Link>
        <div className="masthead__attribution">
          <Sponsor slot="title" sponsors={sponsors} variant="compact" />
          <div>
            A <a href="https://wausaupilotandreview.com">Wausau Pilot &amp; Review</a> widget
            {lastUpdated && (
              <>
                <br />
                <span style={{ opacity: 0.7 }}>Updated {lastUpdated}</span>
              </>
            )}
          </div>
        </div>
      </header>

      {breadcrumb && (
        <nav aria-label="Breadcrumb" className="breadcrumb">
          {breadcrumb}
        </nav>
      )}

      <main className="app-main">{children}</main>

      {footer && <div className="freshness">{footer}</div>}
    </div>
  );
}
