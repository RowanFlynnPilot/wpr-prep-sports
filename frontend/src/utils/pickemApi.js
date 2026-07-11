/**
 * Pick'em API client — talks to the Cloudflare Worker in pickem-api/.
 *
 * Entirely optional: when VITE_PICKEM_API is unset at build time every
 * function here is a quiet no-op / null, and Pick'em stays
 * localStorage-only exactly as before. Turning the community layer on
 * is: deploy the worker (pickem-api/README.md), set the repo variable,
 * re-run Deploy.
 */

import { SITE } from "../config/site.js";

const API_BASE = (import.meta.env.VITE_PICKEM_API || "").replace(/\/$/, "");
export const pickemApiEnabled = Boolean(API_BASE);

const CLIENT_ID_KEY = `${SITE.storagePrefix}-pickem-client-v1`;
const NAME_KEY = `${SITE.storagePrefix}-pickem-name-v1`;

/** Stable anonymous id for this browser (mints on first use). */
export function clientId() {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = window.crypto?.randomUUID?.() ?? fallbackId();
      window.localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function fallbackId() {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

export function loadDisplayName() {
  try {
    return window.localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}

export function saveDisplayName(name) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

/** Fire-and-forget submit of the player's current picks for a sport. */
export function submitPicks(sport, picks, name = undefined) {
  if (!pickemApiEnabled) return Promise.resolve(null);
  const id = clientId();
  if (!id) return Promise.resolve(null);
  return fetch(`${API_BASE}/api/picks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: id, sport, picks, name }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Community pick counts for a set of game ids → { id: {home, away} }. */
export function fetchAggregates(sport, gameIds) {
  if (!pickemApiEnabled || gameIds.length === 0) return Promise.resolve(null);
  const ids = encodeURIComponent(gameIds.slice(0, 40).join(","));
  return fetch(`${API_BASE}/api/aggregates?sport=${sport}&ids=${ids}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Season leaderboard (top 10 + your rank). */
export function fetchLeaderboard(sport) {
  if (!pickemApiEnabled) return Promise.resolve(null);
  const id = clientId();
  const you = id ? `&client_id=${encodeURIComponent(id)}` : "";
  return fetch(`${API_BASE}/api/leaderboard?sport=${sport}${you}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}
