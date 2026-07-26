/**
 * Pick'em API — a single Cloudflare Worker + KV namespace behind the
 * static widget. Three endpoints:
 *
 *   POST /api/picks        { client_id, name?, sport, picks: {gameId: "home"|"away"} }
 *   GET  /api/aggregates   ?sport=football&ids=id1,id2   → { id1: {home, away}, ... }
 *   GET  /api/leaderboard  ?sport=football&client_id=…   → { leaders: [...], you: {...} }
 *
 * Design notes:
 * - client_id is a random UUID the widget mints into localStorage — no
 *   accounts, no PII beyond an optional display name.
 * - Picks LOCK AT KICKOFF server-side: the worker fetches the sport's
 *   games.json from GitHub Pages (edge-cached 5 min) and rejects picks
 *   for games whose start time has passed. That plus server-side
 *   scoring makes the leaderboard trustworthy — clients never submit
 *   results, only pregame predictions.
 * - Aggregates are recomputed from stored picks on read (cached 60s)
 *   rather than incremented on write — KV has no atomic counters and
 *   this traffic (hundreds of players) doesn't need them.
 * - KV layout:
 *     entry:<sport>:<client_id> → { name, picks, updated_at }
 *     (one key per player per sport; list() by prefix for aggregates
 *      and leaderboard — fine for local-news scale, revisit past ~5k
 *      players per sport)
 */

// Per-tenant config comes from wrangler.toml [vars] (DATA_ORIGIN,
// ALLOWED_ORIGINS) — these defaults are the WPR production values so
// the original deployment needs no vars at all.
// NOTE: the widget moved to its own subdomain on 2026-07-26. The old
// github.io URL still 301s (path intact), so DATA_ORIGIN would have kept
// working via a redirect hop — but the allow-list would NOT: requests come
// from the iframe's own origin, so a stale list blocks every API call with
// a CORS error and the community features silently never appear.
const DEFAULT_DATA_ORIGIN = "https://sports.wausaupilotandreview.com";
const DEFAULT_ALLOWED_ORIGINS = [
  // The widget itself — this is the Origin the browser actually sends,
  // since the fetches run inside the iframe.
  "https://sports.wausaupilotandreview.com",
  // The host page, for a future direct call from WordPress.
  "https://wausaupilotandreview.com",
  "https://www.wausaupilotandreview.com",
  // Local dev: 5173 is Vite's default, 5199 is .claude/launch.json.
  "http://localhost:5173",
  "http://localhost:5199",
];

function dataOrigin(env) {
  return (env?.DATA_ORIGIN || DEFAULT_DATA_ORIGIN).replace(/\/+$/, "");
}

function allowedOrigins(env) {
  if (!env?.ALLOWED_ORIGINS) return DEFAULT_ALLOWED_ORIGINS;
  return String(env.ALLOWED_ORIGINS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
const KNOWN_SPORTS = new Set([
  "football",
  "boys_basketball",
  "girls_basketball",
  "volleyball",
  "boys_hockey",
  "girls_hockey",
  "boys_soccer",
  "girls_soccer",
]);
const MAX_NAME_LEN = 24;
const MAX_PICKS_PER_SUBMIT = 40;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/api/picks" && request.method === "POST") {
        return await handleSubmit(request, env, ctx, cors);
      }
      if (url.pathname === "/api/aggregates" && request.method === "GET") {
        return await handleAggregates(url, env, ctx, cors);
      }
      if (url.pathname === "/api/leaderboard" && request.method === "GET") {
        return await handleLeaderboard(url, env, ctx, cors);
      }
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: `internal: ${e.message}` }, 500, cors);
    }
  },
};

function corsHeaders(origin, env) {
  const origins = allowedOrigins(env);
  const allowed = origins.includes(origin) ? origin : origins[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

/** games.json for a sport, edge-cached 5 minutes. Returns Map<id, game>. */
async function gamesIndex(sport, env) {
  const req = new Request(`${dataOrigin(env)}/data/${sport}/games.json`, {
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  const resp = await fetch(req);
  if (!resp.ok) throw new Error(`games.json fetch failed (${resp.status})`);
  const games = await resp.json();
  return new Map(games.map((g) => [g.id, g]));
}

async function handleSubmit(request, env, ctx, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "bad json" }, 400, cors);

  const { client_id: clientId, sport, picks } = body;
  const name = sanitizeName(body.name);
  if (!isUuidish(clientId)) return json({ error: "bad client_id" }, 400, cors);
  if (!KNOWN_SPORTS.has(sport)) return json({ error: "unknown sport" }, 400, cors);
  if (!picks || typeof picks !== "object" || Array.isArray(picks)) {
    return json({ error: "bad picks" }, 400, cors);
  }
  const entries = Object.entries(picks).slice(0, MAX_PICKS_PER_SUBMIT);

  const index = await gamesIndex(sport, env);
  const now = Date.now();
  const key = `entry:${sport}:${clientId}`;
  const existing = (await env.PICKS.get(key, "json")) ?? { picks: {} };

  const accepted = [];
  const rejected = [];
  for (const [gameId, side] of entries) {
    const game = index.get(gameId);
    if (!game || (side !== "home" && side !== "away" && side !== null)) {
      rejected.push(gameId);
      continue;
    }
    // Kickoff lock: no new picks, changes, OR unsets once play begins.
    if (new Date(game.date).getTime() <= now) {
      rejected.push(gameId);
      continue;
    }
    if (side === null) delete existing.picks[gameId];
    else existing.picks[gameId] = side;
    accepted.push(gameId);
  }

  existing.name = name ?? existing.name ?? null;
  existing.updated_at = new Date().toISOString();
  await env.PICKS.put(key, JSON.stringify(existing));

  return json({ ok: true, accepted, rejected }, 200, cors);
}

async function handleAggregates(url, env, ctx, cors) {
  const sport = url.searchParams.get("sport");
  if (!KNOWN_SPORTS.has(sport)) return json({ error: "unknown sport" }, 400, cors);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, MAX_PICKS_PER_SUBMIT);
  if (ids.length === 0) return json({}, 200, cors);

  // Cache the assembled response briefly — every widget load asks for
  // the same upcoming-week ids.
  const cacheKey = new Request(url.toString());
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const cached = new Response(hit.body, hit);
    Object.entries(cors).forEach(([k, v]) => cached.headers.set(k, v));
    return cached;
  }

  const wanted = new Set(ids);
  const counts = Object.fromEntries(ids.map((id) => [id, { home: 0, away: 0 }]));
  for await (const entry of listEntries(env, sport)) {
    for (const [gameId, side] of Object.entries(entry.picks ?? {})) {
      if (wanted.has(gameId) && (side === "home" || side === "away")) {
        counts[gameId][side]++;
      }
    }
  }

  const resp = json(counts, 200, { ...cors, "Cache-Control": "public, max-age=60" });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

async function handleLeaderboard(url, env, ctx, cors) {
  const sport = url.searchParams.get("sport");
  if (!KNOWN_SPORTS.has(sport)) return json({ error: "unknown sport" }, 400, cors);
  const clientId = url.searchParams.get("client_id");

  const index = await gamesIndex(sport, env);
  const rows = [];
  for await (const entry of listEntries(env, sport)) {
    let correct = 0;
    let total = 0;
    for (const [gameId, side] of Object.entries(entry.picks ?? {})) {
      const g = index.get(gameId);
      if (!g || g.status !== "final") continue;
      if (g.home.score == null || g.away.score == null || g.home.score === g.away.score) continue;
      total++;
      const winner = g.home.score > g.away.score ? "home" : "away";
      if (winner === side) correct++;
    }
    if (total > 0) {
      rows.push({
        client_id: entry.client_id,
        name: entry.name || "Anonymous",
        correct,
        total,
      });
    }
  }
  rows.sort((a, b) => b.correct - a.correct || a.total - b.total);

  const leaders = rows.slice(0, 10).map(({ name, correct, total }, i) => ({
    rank: i + 1,
    name,
    correct,
    total,
  }));
  let you = null;
  if (clientId) {
    const idx = rows.findIndex((r) => r.client_id === clientId);
    if (idx >= 0) {
      you = { rank: idx + 1, ...rows[idx] };
      delete you.client_id;
    }
  }
  return json(
    { players: rows.length, leaders, you },
    200,
    { ...cors, "Cache-Control": "public, max-age=60" },
  );
}

/** Async-iterate every stored entry for a sport. */
async function* listEntries(env, sport) {
  const prefix = `entry:${sport}:`;
  let cursor = undefined;
  do {
    const page = await env.PICKS.list({ prefix, cursor });
    for (const k of page.keys) {
      const entry = await env.PICKS.get(k.name, "json");
      if (entry) {
        entry.client_id = k.name.slice(prefix.length);
        yield entry;
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

function sanitizeName(name) {
  if (typeof name !== "string") return null;
  const cleaned = name.replace(/[<>]/g, "").trim().slice(0, MAX_NAME_LEN);
  return cleaned || null;
}

function isUuidish(v) {
  return typeof v === "string" && /^[0-9a-f-]{20,40}$/i.test(v);
}
