import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";

const WPR_LOGO =
  "https://wausaupilotandreview.com/wp-content/uploads/2024/04/WausauPilotandReviewLogo.png";

/**
 * Shared shell: navy WPR masthead + freshness footer slot. All pages render
 * inside this so the iframe feels like one widget regardless of which view
 * the user is on.
 */
export default function Layout({ children, footer, lastUpdated, breadcrumb, sponsors }) {
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
        <Link to="/" className="masthead__title">
          Central Wisconsin <em>Prep Sports</em>
        </Link>
        <div className="masthead__attribution">
          <Sponsor slot="title" sponsors={sponsors} variant="compact" />
          {lastUpdated && (
            <div className="masthead__updated">Updated {lastUpdated}</div>
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
