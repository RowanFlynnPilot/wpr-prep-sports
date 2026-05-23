// Self-hosted under frontend/public; BASE_URL resolves to
// "/wpr-prep-sports/" on GitHub Pages or whatever VITE_BASE is set to.
const WPR_LOGO = `${import.meta.env.BASE_URL}wpr-logo.png`;

/**
 * Footer block — newsroom-style credit + data attribution + stats.
 * Rendered by Layout under every page so the chrome stays consistent.
 *
 * Accepts a `stats` prop with optional game/school/sport counts to summarize.
 * If stats are omitted (e.g. a non-dashboard page), only the credit line shows.
 */
export default function Footer({ stats, lastUpdated }) {
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer__divider" aria-hidden="true" />
      <div className="site-footer__row site-footer__row--credit">
        <a
          href="https://wausaupilotandreview.com/category/sports/"
          className="site-footer__brand"
          rel="noopener noreferrer"
          target="_top"
        >
          <img
            src={WPR_LOGO}
            alt=""
            aria-hidden="true"
            className="site-footer__brand-logo"
            loading="lazy"
            decoding="async"
          />
          <span>Wausau Pilot &amp; Review</span>
        </a>
        <span className="site-footer__sep" aria-hidden="true">·</span>
        <span className="site-footer__tag">Central Wisconsin Prep Sports</span>
      </div>
      {stats && (
        <div className="site-footer__row site-footer__row--stats">
          <span>Data via WIAA</span>
          {stats.sports != null && (
            <>
              <span className="site-footer__sep" aria-hidden="true">·</span>
              <span>{stats.sports} sport{stats.sports === 1 ? "" : "s"}</span>
            </>
          )}
          {stats.games != null && (
            <>
              <span className="site-footer__sep" aria-hidden="true">·</span>
              <span>{stats.games.toLocaleString()} games tracked</span>
            </>
          )}
          {stats.schools != null && (
            <>
              <span className="site-footer__sep" aria-hidden="true">·</span>
              <span>{stats.schools} schools</span>
            </>
          )}
        </div>
      )}
      {lastUpdated && (
        <div className="site-footer__row site-footer__row--updated">
          Updated {lastUpdated}
        </div>
      )}
    </footer>
  );
}
