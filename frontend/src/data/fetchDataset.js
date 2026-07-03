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
import { selectedSeason } from "../utils/season.js";

const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ??
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

// Per-sport files resolve against the live season or an archived one
// (utils/season.js). Cross-sport files (schools, sponsors, potw,
// spirit, spotlights, history) always come from the live tree — the
// live schools.json carries the corrected colors/divisions, and
// editorial/sponsor config shouldn't time-travel.
function sportBaseFor(sportId) {
  const season = selectedSeason();
  return season === "live"
    ? `${DATA_BASE}/${sportId}`
    : `${DATA_BASE}/archive/${season}/${sportId}`;
}

export async function fetchDataset(sportId = DEFAULT_SPORT) {
  const sportBase = sportBaseFor(sportId);

  // Bust browser cache when the meta.json timestamp changes. We fetch meta
  // first; subsequent requests carry ?v=<timestamp> so a freshly-scraped
  // dataset is picked up immediately without manual cache clears.
  const meta = await fetchJson(`${sportBase}/meta.json`, { noStore: true });
  const v = encodeURIComponent(meta.last_updated ?? Date.now());
  const [schools, games, standings, sponsors, seasonStats, spirit, potwOverrides, powerRankingsRaw, spotlightsRaw] = await Promise.all([
    fetchJson(`${DATA_BASE}/schools.json?v=${v}`),
    fetchJson(`${sportBase}/games.json?v=${v}`),
    fetchJson(`${sportBase}/standings.json?v=${v}`),
    // Sponsors, season_stats, spirit photos, the editor's PotW
    // override, power rankings, and senior spotlights are all
    // optional — the widget renders fine without any of them.
    fetchJsonOptional(`${DATA_BASE}/sponsors.json?v=${v}`),
    fetchJsonOptional(`${sportBase}/season_stats.json?v=${v}`),
    fetchJsonOptional(`${DATA_BASE}/spirit.json?v=${v}`),
    fetchJsonOptional(`${DATA_BASE}/potw.json?v=${v}`),
    fetchJsonOptional(`${sportBase}/power_rankings.json?v=${v}`),
    fetchJsonOptional(`${DATA_BASE}/spotlights.json?v=${v}`),
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

  // power_rankings.json wraps the list in { method, generated_at,
  // rankings: [...] } so the renderer can show provenance. Unwrap to
  // { rankings, method, generatedAt } on the dataset object.
  const powerRankings = Array.isArray(powerRankingsRaw)
    ? { rankings: powerRankingsRaw, method: null, generatedAt: null }
    : {
        rankings: powerRankingsRaw?.rankings ?? [],
        method: powerRankingsRaw?.method ?? null,
        generatedAt: powerRankingsRaw?.generated_at ?? null,
      };

  return {
    sport: sportId,
    // Non-null when the reader flipped to an archived season — pages
    // use it to skip live-only framing (countdown hero, stale banner).
    archiveSeason: selectedSeason() === "live" ? null : selectedSeason(),
    meta,
    schools,
    games,
    standings,
    sponsors,
    seasonStats: seasonStats ?? [],
    spirit: spiritPhotos,
    potwOverride,
    powerRankings,
    // Wrapper { spotlights: [...] } so editors can park notes alongside.
    spotlights: Array.isArray(spotlightsRaw)
      ? spotlightsRaw
      : (spotlightsRaw?.spotlights ?? []),
  };
}

function isOverrideExpired(o) {
  if (!o?.expires_at) return false;
  const ts = Date.parse(o.expires_at);
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
}

/**
 * Per-game full box score, fetched on demand by GamePage. Returns
 * { game_id, stat_leaders } or null (game has no reported stats, or
 * pre-split data where stat_leaders still live inline on the game).
 */
export function fetchBoxscore(sportId, gameId, version) {
  const v = encodeURIComponent(version ?? "");
  return fetchJsonOptional(
    `${sportBaseFor(sportId)}/boxscores/${encodeURIComponent(gameId)}.json?v=${v}`,
  );
}

/**
 * Head-to-head history from archived seasons ({ seasons, matchups }),
 * fetched on demand by GamePage's HeadToHead section. Built by
 * scraper/scripts/build_history.py; null when no archive exists for
 * this sport. Cached per sport for the session — the file only changes
 * once a season.
 */
const historyCache = new Map();
export function fetchHistory(sportId, version) {
  if (!historyCache.has(sportId)) {
    const v = encodeURIComponent(version ?? "");
    historyCache.set(
      sportId,
      fetchJsonOptional(`${DATA_BASE}/history/${sportId}.json?v=${v}`),
    );
  }
  return historyCache.get(sportId);
}

/**
 * Per-school player stat lines ({ school_id, lines: [...] }), fetched
 * on demand by PlayerPage. Null when the school has no stat lines on
 * record this season.
 */
export function fetchPlayerLines(sportId, schoolId, version) {
  const v = encodeURIComponent(version ?? "");
  return fetchJsonOptional(
    `${sportBaseFor(sportId)}/players/${encodeURIComponent(schoolId)}.json?v=${v}`,
  );
}

// Only meta.json bypasses the HTTP cache — it's the freshness signal.
// Everything else carries ?v=<meta.last_updated>, so a new scrape
// changes the URL and old cached payloads simply stop being requested.
// (Previously every fetch was no-store, which forced a full re-download
// of multi-MB JSON on every single widget load.)
async function fetchJson(url, { noStore = false } = {}) {
  const resp = await fetch(url, noStore ? { cache: "no-store" } : undefined);
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText} — ${url}`);
  }
  return resp.json();
}

async function fetchJsonOptional(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}
