import { Link } from "react-router-dom";

/**
 * Shared shell: navy WPR masthead + freshness footer slot. All pages render
 * inside this so the iframe feels like one widget regardless of which view
 * the user is on.
 */
export default function Layout({ children, footer, lastUpdated, breadcrumb }) {
  return (
    <div className="app">
      <header className="masthead">
        <Link to="/" className="masthead__title">
          Central Wisconsin <em>Prep Sports</em>
        </Link>
        <div className="masthead__attribution">
          A <a href="https://wausaupilotandreview.com">Wausau Pilot &amp; Review</a> widget
          {lastUpdated && (
            <>
              <br />
              <span style={{ opacity: 0.7 }}>Updated {lastUpdated}</span>
            </>
          )}
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
