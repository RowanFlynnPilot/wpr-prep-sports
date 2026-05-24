/**
 * Pick'em — localStorage-backed weekly winner predictions.
 *
 * No backend; user picks live in their browser. Scoring is computed
 * client-side once games finalize. Cross-device sync not supported —
 * deliberate choice to keep the widget static-site friendly.
 */

const STORAGE_KEY = "wpr-pickem-v1";

/** Read all picks from localStorage. Shape: { [gameId]: "home" | "away" } */
export function loadPicks() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Persist a pick. side is "home" | "away" | null (null to unset). */
export function savePick(gameId, side) {
  if (typeof window === "undefined") return;
  const picks = loadPicks();
  if (side === null) delete picks[gameId];
  else picks[gameId] = side;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  } catch {
    // localStorage unavailable / quota; ignore
  }
}

/**
 * Games this week the user can pick (upcoming finals). Excludes games
 * already started or completed.
 */
export function pickableGames(games, now = new Date()) {
  if (!games) return [];
  const nowTs = now.getTime();
  const endTs = nowTs + 7 * 86_400_000;
  return games
    .filter((g) => g.status === "scheduled")
    .filter((g) => {
      const t = new Date(g.date).getTime();
      return t > nowTs && t < endTs;
    })
    .filter((g) => g.home.school_id || g.away.school_id) // require a tracked side
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Score the user's running record across ALL games the user has
 * picked. Returns { correct, incorrect, pending, total }.
 */
export function scorePicks(games, picks) {
  let correct = 0, incorrect = 0, pending = 0;
  for (const [gameId, side] of Object.entries(picks ?? {})) {
    const g = games.find((g) => g.id === gameId);
    if (!g) continue; // game removed from data; ignore
    if (g.status !== "final") {
      pending++;
      continue;
    }
    if (g.home.score == null || g.away.score == null) {
      pending++;
      continue;
    }
    const winner = g.home.score > g.away.score ? "home" : "away";
    if (winner === side) correct++;
    else incorrect++;
  }
  return { correct, incorrect, pending, total: correct + incorrect + pending };
}
