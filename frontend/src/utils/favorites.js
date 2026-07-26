/**
 * Favorite schools — browser-local, cross-sport.
 *
 * Readers pin the schools they actually care about (their kid's, their alma
 * mater) and those get a strip at the top of every sport's dashboard.
 * Favorites are school ids, not per-sport teams: Wisconsin schools sit in
 * different conferences for different sports, so one favorite follows a
 * school through football in October and basketball in January.
 *
 * STORAGE, and why there are two sources
 * --------------------------------------
 * The widget runs in a third-party iframe (github.io inside the publisher's
 * site), so localStorage is *partitioned* — measured 2026-07-26: it writes
 * and survives reloads in Chromium, but lives in a bucket keyed to (host
 * site, widget origin), invisible to a first-party visit to the widget URL.
 * Safari/ITP additionally caps third-party script-writable storage at 7 days
 * without first-party interaction, which nobody here will ever have. So on
 * iOS a stored list may silently evaporate.
 *
 * Hence the `?favorites=` URL seed: a link like
 *   .../wpr-prep-sports/?favorites=wausau-east,edgar#/football
 * works no matter what storage does, is shareable and bookmarkable, and lets
 * the publisher link "follow your team" straight from an article. It is
 * applied ONCE per session (a repeat application would resurrect favorites
 * the reader had just removed, since the host page's iframe src keeps the
 * param).
 *
 * The durable fix is serving the widget from a subdomain of the publisher's
 * own site, which makes the frame same-site and removes every restriction
 * above — see docs/favorites-spec.md.
 */

import { useSyncExternalStore } from "react";
import { SITE } from "../config/site.js";

const KEY = `${SITE.storagePrefix}-favorites-v1`;
const SEED_KEY = `${SITE.storagePrefix}-favorites-seeded`;

/** Enough for a family with kids at two schools plus an alma mater; small
 *  enough that the pinned strip never becomes a second dashboard. */
export const MAX_FAVORITES = 5;

export const URL_PARAM = "favorites";

/** School ids are manifest slugs: lowercase, digits, hyphens. */
const ID_RE = /^[a-z0-9-]+$/;

/** Validate, lowercase, de-dupe, and cap. Always returns a fresh array. */
function clean(ids) {
  const out = [];
  for (const raw of ids ?? []) {
    const id = String(raw ?? "").trim().toLowerCase();
    if (!id || !ID_RE.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

function readStorage() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.schools) ? parsed.schools : [];
  } catch {
    return []; // unavailable / partitioned away / malformed
  }
}

function writeStorage(ids) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ schools: ids, updated: new Date().toISOString() }),
    );
  } catch {
    // Storage blocked or full. The in-memory list still works for this
    // visit; the URL param is the durable path.
  }
}

/**
 * Read `?favorites=a,b` — once per session. Hash routing puts the query
 * before the hash, same as `?season=` in utils/season.js.
 */
function takeUrlSeed() {
  if (typeof window === "undefined") return [];
  let seeded = false;
  try {
    seeded = window.sessionStorage.getItem(SEED_KEY) === "1";
  } catch {
    // sessionStorage unavailable — fall through and seed each load. Worse
    // than once-per-session, but only for readers who have storage off
    // entirely, and it keeps shared links working for them.
  }
  if (seeded) return [];
  const raw = new URLSearchParams(window.location.search).get(URL_PARAM);
  if (!raw) return [];
  try {
    window.sessionStorage.setItem(SEED_KEY, "1");
  } catch {
    /* ignore */
  }
  return raw.split(",");
}

// --- store ---------------------------------------------------------------
// Module-level so the strip and every star button share one source of truth
// without threading state through the page tree. useSyncExternalStore
// requires a stable snapshot reference, so `current` is only reassigned on
// an actual change.

let current = null;
const listeners = new Set();

function init() {
  if (current) return current;
  const stored = readStorage();
  const seed = takeUrlSeed();
  // Seed first: a shared link should surface its schools at the top.
  current = clean([...seed, ...stored]);
  if (seed.length) writeStorage(current);
  return current;
}

function emit() {
  for (const l of listeners) l();
}

export function getFavorites() {
  return init();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setFavorites(ids) {
  const next = clean(ids);
  const prev = getFavorites();
  if (next.length === prev.length && next.every((id, i) => id === prev[i])) {
    return prev; // no-op: keep the snapshot reference stable
  }
  current = next;
  writeStorage(current);
  emit();
  return current;
}

/**
 * Add or remove a school. Returns { favorites, added, atCapacity } so the
 * caller can explain a refusal rather than silently doing nothing.
 */
export function toggleFavorite(schoolId) {
  const now = getFavorites();
  const has = now.includes(schoolId);
  if (!has && now.length >= MAX_FAVORITES) {
    return { favorites: now, added: false, atCapacity: true };
  }
  const next = has ? now.filter((id) => id !== schoolId) : [...now, schoolId];
  return { favorites: setFavorites(next), added: !has, atCapacity: false };
}

export function isFavorite(schoolId) {
  return getFavorites().includes(schoolId);
}

/** Shareable link that reproduces a favorites list on any device. */
export function favoritesShareUrl(ids, { sport } = {}) {
  const base = SITE.widgetOrigin.replace(/[?#].*$/, "").replace(/\/$/, "");
  const q = `?${URL_PARAM}=${encodeURIComponent(clean(ids).join(","))}`;
  return `${base}/${q}${sport ? `#/${sport}` : ""}`;
}

// Keep multiple frames/tabs of the same origin in step (e.g. the widget and
// a per-school embed on the same article).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const next = clean(readStorage());
    const prev = getFavorites();
    if (next.length === prev.length && next.every((id, i) => id === prev[i])) return;
    current = next;
    emit();
  });
}

/** Subscribe a component to the favorites list. */
export function useFavorites() {
  return useSyncExternalStore(subscribe, getFavorites, getFavorites);
}
