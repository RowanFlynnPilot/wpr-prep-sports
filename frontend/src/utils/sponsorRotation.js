/**
 * Banner rotation — every full-creative sponsor shares every banner
 * surface.
 *
 * Each banner slot used to be one fixed surface: JARP under every
 * dashboard tab, Rotographic on game pages, Wimmer on team pages. A
 * reader (or the ad rep checking the placement) who stays on the
 * dashboard then saw JARP on every tab and the others never (Chris
 * Weber, 2026-09-18). With `rotation.banner` in data/sponsors.json
 * listing the pooled slot keys, a banner surface shows
 *
 *   pool[(own position + session start + offset) % pool size]
 *
 * - `offset` is the dashboard tab's index, so switching tabs steps
 *   through the sponsors.
 * - the session start is random per visit, so over time every sponsor
 *   gets an equal share of every surface, first view included.
 * - a new banner sponsor joins by adding its slot key to the pool; no
 *   code change.
 *
 * Returns the slot key to RENDER, so click tracking stays per sponsor
 * (`sponsor-click:banner:game` is always Rotographic, wherever it ran).
 * Surfaces outside the pool, unsold pool entries, and a pool of one all
 * fall through to the fixed behavior.
 */
import { SITE } from "../config/site.js";

const SEED_KEY = `${SITE.storagePrefix}-banner-seed`;
let memorySeed = null;

function sessionSeed() {
  if (memorySeed != null) return memorySeed;
  try {
    const stored = window.sessionStorage.getItem(SEED_KEY);
    if (stored != null && Number.isFinite(Number(stored))) {
      memorySeed = Number(stored);
      return memorySeed;
    }
  } catch {
    /* storage blocked — seed lasts this page load only */
  }
  memorySeed = Math.floor(Math.random() * 1000);
  try {
    window.sessionStorage.setItem(SEED_KEY, String(memorySeed));
  } catch {
    /* ignore */
  }
  return memorySeed;
}

export function rotatedBannerSlot(sponsors, slot, offset = 0) {
  const slots = sponsors?.slots ?? {};
  const pool = (sponsors?.rotation?.banner ?? []).filter(
    (key) => slots[key]?.name && slots[key]?.logo_url,
  );
  const position = pool.indexOf(slot);
  if (pool.length < 2 || position < 0) return slot;
  return pool[(position + sessionSeed() + Math.max(0, offset)) % pool.length];
}
