/**
 * Loading skeleton — matches the dashboard's visual rhythm so the page
 * doesn't jolt when real data arrives. Plain divs with a CSS shimmer;
 * no animation libs.
 */
export default function Skeleton() {
  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__title">
          Central Wisconsin <em>Prep Sports</em>
        </div>
        <div className="masthead__attribution">Loading the latest…</div>
      </header>
      <main className="app-main">
        <div className="skeleton skeleton--hero" aria-hidden="true" />
        <div>
          <div className="skeleton skeleton--header" aria-hidden="true" />
          <div className="skeleton skeleton--row" aria-hidden="true" />
          <div className="skeleton skeleton--row" aria-hidden="true" />
          <div className="skeleton skeleton--row" aria-hidden="true" />
        </div>
        <div>
          <div className="skeleton skeleton--header" aria-hidden="true" />
          <div className="skeleton-grid" aria-hidden="true">
            <div className="skeleton skeleton--card" />
            <div className="skeleton skeleton--card" />
            <div className="skeleton skeleton--card" />
            <div className="skeleton skeleton--card" />
          </div>
        </div>
      </main>
      <p className="sr-only" role="status">Loading scores…</p>
    </div>
  );
}
