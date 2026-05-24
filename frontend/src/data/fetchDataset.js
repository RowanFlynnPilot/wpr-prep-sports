/**
 * Fetch a single sport's dataset (games, standings, season stats, meta)
 * plus the cross-sport resources (schools, sponsors) and assemble them
 * into one dataset object.
 *
 * Layout:
 *   data/schools.json            (cross-sport)
 *   data/sponsors.json           (cross-sport, optional)
 *   data/<sport>/meta.json
 *   data/<sport>/games.json
 *   data/<sport>/standings.json
 *   data/<sport>/season_stats.json (optional)
 *
 * In dev: the Vite plugin in vite.config.js serves repo-root data/ at
 * this URL. In prod (GitHub Pages): the deploy workflow copies data/
 * into frontend/dist/data/, so the same URL works.
 *
 * BASE_URL is set by Vite based on `base` (defaults to /wpr-prep-sports/).
 * Override with VITE_BASE at build time if deploying to a custom domain.
 * VITE_DATA_BASE is a further override for split-deployment scenarios.
 */
import { DEFAULT_SPORT } from "../config/sports.js";

const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ??
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

export async function fetchDataset(sportId = DEFAULT_SPORT) {
  const sportBase = `${DATA_BASE}/${sportId}`;

  // Bust browser cache when the meta.json timestamp changes. We fetch meta
  // first; subsequent requests carry ?v=<timestamp> so a freshly-scraped
  // dataset is picked up immediately without manual cache clears.
  const meta = await fetchJson(`${sportBase}/meta.json`);
  const v = encodeURIComponent(meta.last_updated ?? Date.now());
  const [schools, games, standings, sponsors, seasonStats, spirit, potwOverrides] = await Promise.all([
    fetchJson(`${DATA_BASE}/schools.json?v=${v}`),
    fetchJson(`${sportBase}/games.json?v=${v}`),
    fetchJson(`${sportBase}/standings.json?v=${v}`),
    // Sponsors, season_stats, spirit photos, and the editor's PotW override
    // are all optional — the widget renders fine without any of them.
    fetchJsonOptional(`${DATA_BASE}/sponsors.json?v=${v}`),
    fetchJsonOptional(`${sportBase}/season_stats.json?v=${v}`),
    fetchJsonOptional(`${DATA_BASE}/spirit.json?v=${v}`),
    fetchJsonOptional(`${DATA_BASE}/potw.json?v=${v}`),
  ]);
  // Spirit file is a wrapper { photos: [...] } so editors can park
  // metadata alongside the photo list. Normalize to a flat array here.
  const spiritPhotos = Array.isArray(spirit)
    ? spirit
    : (spirit?.photos ?? []);
  // The override file is keyed by sport — pull just this sport's entry.
  // Expired entries are filtered out here so the algorithm takes over
  // cleanly without the renderer needing to know about expires_at.
  const overrideForSport = potwOverrides?.[sportId] ?? null;
  const potwOverride =
    overrideForSport && !isOverrideExpired(overrideForSport)
      ? overrideForSport
      : null;

  return {
    sport: sportId,
    meta,
    schools,
    games,
    standings,
    sponsors,
    seasonStats: seasonStats ?? [],
    spirit: spiritPhotos,
    potwOverride,
  };
}

function isOverrideExpired(o) {
  if (!o?.expires_at) return false;
  const ts = Date.parse(o.expires_at);
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
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
