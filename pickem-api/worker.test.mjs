// Local test harness for worker.js — mocks KV, the edge cache, and the
// games.json fetch. No Cloudflare account needed. Run from this dir:
//   node worker.test.mjs
import worker from "./worker.js";

// ---- mocks ----------------------------------------------------------
const store = new Map();
const PICKS = {
  async get(key, type) {
    const v = store.get(key);
    if (v == null) return null;
    return type === "json" ? JSON.parse(v) : v;
  },
  async put(key, value) {
    store.set(key, value);
  },
  async list({ prefix }) {
    const keys = [...store.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  },
};
globalThis.caches = {
  default: { match: async () => undefined, put: async () => {} },
};

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();
const GAMES = [
  { id: "g-future", date: FUTURE, status: "scheduled", home: { score: null }, away: { score: null } },
  { id: "g-final", date: PAST, status: "final", home: { score: 28 }, away: { score: 14 } },
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/data/football/games.json")) {
    return new Response(JSON.stringify(GAMES), { status: 200 });
  }
  return realFetch(input);
};

const env = { PICKS };
const ctx = { waitUntil() {} };
const call = (path, init) =>
  worker.fetch(new Request(`https://pickem.example${path}`, init), env, ctx);

const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
};

// ---- tests ----------------------------------------------------------
const CID_A = "aaaaaaaa-1111-2222-3333-444444444444";
const CID_B = "bbbbbbbb-1111-2222-3333-444444444444";

// 0. Defaults track the live deployment.
//
// Regression guard for 2026-07-26: the widget moved to its own subdomain
// and these defaults still named the old github.io origin. Data would have
// limped along on GitHub's 301, but the allow-list would not — requests
// carry the iframe's own origin, so every API call would have failed CORS
// and the community features would have silently never appeared, with a
// green deploy. A stale default here is invisible until someone deploys.
const WIDGET_ORIGIN = "https://sports.wausaupilotandreview.com";
{
  const pre = await worker.fetch(
    new Request("https://pickem.example/api/picks", {
      method: "OPTIONS",
      headers: { Origin: WIDGET_ORIGIN },
    }),
    env,
    ctx,
  );
  assert(
    pre.headers.get("Access-Control-Allow-Origin") === WIDGET_ORIGIN,
    "default allow-list covers the production widget origin",
  );

  let defaultFetched = null;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    defaultFetched = typeof input === "string" ? input : input.url;
    return new Response(JSON.stringify(GAMES), { status: 200 });
  };
  await worker.fetch(
    new Request("https://pickem.example/api/leaderboard?sport=football"),
    env,
    ctx,
  );
  globalThis.fetch = prevFetch;
  assert(
    defaultFetched === `${WIDGET_ORIGIN}/data/football/games.json`,
    "default DATA_ORIGIN points at the live widget domain",
  );
}

// 1. Submit: future accepted, started game rejected.
let r = await call("/api/picks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_id: CID_A,
    sport: "football",
    name: "Rowan F.",
    picks: { "g-future": "home", "g-final": "home" },
  }),
});
let body = await r.json();
assert(r.status === 200, "submit returns 200");
assert(body.accepted.includes("g-future"), "future pick accepted");
assert(body.rejected.includes("g-final"), "started game rejected (kickoff lock)");

// 2. Second player picks away.
await call("/api/picks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_id: CID_B, sport: "football", picks: { "g-future": "away" } }),
});

// 3. Aggregates.
r = await call("/api/aggregates?sport=football&ids=g-future");
body = await r.json();
assert(body["g-future"].home === 1 && body["g-future"].away === 1, "aggregates count 1-1");

// 4. Leaderboard: seed a pregame pick on the (now final) game directly,
//    as if submitted before kickoff.
const key = `entry:football:${CID_A}`;
const entry = JSON.parse(store.get(key));
entry.picks["g-final"] = "home"; // winner
store.set(key, JSON.stringify(entry));
const keyB = `entry:football:${CID_B}`;
const entryB = JSON.parse(store.get(keyB));
entryB.picks["g-final"] = "away"; // loser
store.set(keyB, JSON.stringify(entryB));

r = await call(`/api/leaderboard?sport=football&client_id=${CID_B}`);
body = await r.json();
assert(body.players === 2, "leaderboard sees 2 players");
assert(body.leaders[0].name === "Rowan F." && body.leaders[0].correct === 1, "correct picker leads");
assert(body.you && body.you.rank === 2 && body.you.correct === 0, "you-row ranks the caller");

// 5. Validation guards.
r = await call("/api/picks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_id: "short", sport: "football", picks: {} }),
});
assert(r.status === 400, "bad client_id rejected");
r = await call("/api/aggregates?sport=quidditch&ids=x");
assert(r.status === 400, "unknown sport rejected");
r = await call("/api/nope");
assert(r.status === 404, "unknown route 404s");

// 6. Tenant overrides: ALLOWED_ORIGINS + DATA_ORIGIN from env (white-label).
const tenantEnv = {
  PICKS,
  DATA_ORIGIN: "https://tenant.example/prep-widget/",
  ALLOWED_ORIGINS: "https://tenant.example, https://news.example",
};
r = await worker.fetch(
  new Request("https://pickem.example/api/aggregates?sport=football&ids=g-future", {
    headers: { Origin: "https://news.example" },
  }),
  tenantEnv,
  ctx,
);
assert(
  r.headers.get("Access-Control-Allow-Origin") === "https://news.example",
  "env ALLOWED_ORIGINS echoed for tenant origin",
);
let tenantFetched = null;
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  tenantFetched = url;
  return new Response(JSON.stringify(GAMES), { status: 200 });
};
await worker.fetch(
  new Request("https://pickem.example/api/leaderboard?sport=football"),
  tenantEnv,
  ctx,
);
assert(
  tenantFetched === "https://tenant.example/prep-widget/data/football/games.json",
  "env DATA_ORIGIN drives games.json fetch (trailing slash trimmed)",
);

console.log(process.exitCode ? "\nTESTS FAILED" : "\nall tests passed");
