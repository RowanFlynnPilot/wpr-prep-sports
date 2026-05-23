/**
 * Fetch the four JSON resources written by the scraper and assemble them
 * into a single dataset object.
 *
 * In dev: the Vite plugin in vite.config.js serves repo-root data/ at this
 * URL. In prod (GitHub Pages): the deploy workflow copies data/ into
 * frontend/dist/data/, so the same URL works.
 *
 * BASE_URL is set by Vite based on `base` (defaults to /wpr-prep-sports/).
 * Override with VITE_BASE at build time if deploying to a custom domain.
 * VITE_DATA_BASE is a further override for split-deployment scenarios.
 */
const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ??
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

export async function fetchDataset() {
  // Bust browser cache when the meta.json timestamp changes. We fetch meta
  // first; subsequent requests carry ?v=<timestamp> so a freshly-scraped
  // dataset is picked up immediately without manual cache clears.
  const meta = await fetchJson(`${DATA_BASE}/meta.json`);
  const v = encodeURIComponent(meta.last_updated ?? Date.now());
  const [schools, games, standings, sponsors, seasonStats] = await Promise.all([
    fetchJson(`${DATA_BASE}/schools.json?v=${v}`),
    fetchJson(`${DATA_BASE}/games.json?v=${v}`),
    fetchJson(`${DATA_BASE}/standings.json?v=${v}`),
    // Sponsors and season_stats are optional — the widget renders fine without them.
    fetchJsonOptional(`${DATA_BASE}/sponsors.json?v=${v}`),
    fetchJsonOptional(`${DATA_BASE}/season_stats.json?v=${v}`),
  ]);
  return {
    meta,
    schools,
    games,
    standings,
    sponsors,
    seasonStats: seasonStats ?? [],
  };
}

async function fetchJson(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText} — ${url}`);
  }
  return resp.json();
}

async function fetchJsonOptional(url) {
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}
