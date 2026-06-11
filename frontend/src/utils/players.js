/**
 * Helpers for the player-profile route + cross-component player
 * identity. A player is identified by (sport, school_id, player_slug)
 * — sport scopes the dataset, school_id resolves school context, and
 * the slug disambiguates within a school.
 */

/**
 * Turn a player name into a URL-safe kebab-case slug.
 *   "Pacyn Stoffel"   → "pacyn-stoffel"
 *   "P. Jirschele"    → "p-jirschele"
 *   "Bridget Frye"    → "bridget-frye"
 *
 * Stable across re-runs: never depends on data outside the name. The
 * same player rendered from different sources should slug identically
 * (e.g., MP "P. Jirschele" and a future source's "Pamela Jirschele"
 * would slug differently — handle that in the data layer if it ever
 * matters).
 */
export function playerSlug(name) {
  return (name || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")  // strip accent combining marks (works in modern browsers)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the in-app URL fragment for a player profile.
 *   sportPrefix: "/football" (from useSportPrefix)
 *   schoolId:    "wausau-east"
 *   playerName:  "Pacyn Stoffel" — slugified internally
 */
export function playerProfileHref(sportPrefix, schoolId, playerName) {
  return `${sportPrefix}/player/${schoolId}/${playerSlug(playerName)}`;
}

/**
 * Normalize per-school stat lines to one shape regardless of data
 * layout. Post-split: the players/<school_id>.json file carries
 * { lines: [{ game_id, ...line }] }. Pre-split (or when that file is
 * missing): scan the games' inline stat_leaders. Every line in the
 * result belongs to `schoolId` and carries a `game_id`.
 */
export function buildSchoolLines(playerFile, games, schoolId) {
  if (playerFile?.lines?.length) return playerFile.lines;
  const out = [];
  for (const g of games ?? []) {
    for (const l of g.stat_leaders ?? []) {
      if ((l.team_school_id || "") === schoolId) {
        out.push({ game_id: g.id, ...l });
      }
    }
  }
  return out;
}

/**
 * Group the school's stat lines by finalized game for one player. Each
 * entry pairs the (slim) game object with the stat lines this player
 * registered in it (a player can register in multiple categories in
 * one game).
 */
export function findPlayerGameLog(schoolLines, games, playerName) {
  const slug = playerSlug(playerName);
  const gamesById = new Map((games ?? []).map((g) => [g.id, g]));
  const byGame = new Map();
  for (const l of schoolLines ?? []) {
    if (playerSlug(l.player_name) !== slug) continue;
    const game = gamesById.get(l.game_id);
    if (!game || game.status !== "final") continue;
    if (!byGame.has(l.game_id)) byGame.set(l.game_id, { game, lines: [] });
    byGame.get(l.game_id).lines.push(l);
  }
  // Chronological — Week 1 at the top, most recent at the bottom, so
  // a reader scrolls the player's season the way it actually unfolded.
  return [...byGame.values()].sort(
    (a, b) => new Date(a.game.date).getTime() - new Date(b.game.date).getTime(),
  );
}

/**
 * Pull all season-stats rows for a player. Returns the array sorted
 * in the same order categories appear in sportConfig.stats.categories
 * (so Volleyball Offense renders before Defense renders before Serving
 * etc.) when sportConfig is supplied.
 */
export function findPlayerSeasonStats(seasonStats, schoolId, playerName, sportConfig) {
  const slug = playerSlug(playerName);
  const rows = (seasonStats ?? []).filter(
    (r) => r.school_id === schoolId && playerSlug(r.player_name) === slug,
  );
  if (!sportConfig?.stats?.categories) return rows;
  const order = new Map();
  for (let i = 0; i < sportConfig.stats.categories.length; i++) {
    order.set(sportConfig.stats.categories[i].rawCategory, i);
  }
  return rows.sort(
    (a, b) =>
      (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99),
  );
}

/**
 * Resolve player display name from any stat line carrying the slug —
 * lets the page render the human name even when the URL only has the
 * slug. Returns null if the slug isn't found anywhere.
 */
export function resolvePlayerName({ schoolLines, seasonStats, schoolId, slug }) {
  for (const r of seasonStats ?? []) {
    if (r.school_id === schoolId && playerSlug(r.player_name) === slug) {
      return r.player_name;
    }
  }
  for (const l of schoolLines ?? []) {
    if (playerSlug(l.player_name) === slug) return l.player_name;
  }
  return null;
}

/**
 * Find the player's best position guess from their stat lines. If
 * multiple positions appear across rows, pick the most common.
 */
export function resolvePlayerPosition({ schoolLines, seasonStats, schoolId, slug }) {
  const counts = new Map();
  const bump = (pos) => {
    if (!pos) return;
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  };
  for (const r of seasonStats ?? []) {
    if (r.school_id === schoolId && playerSlug(r.player_name) === slug) {
      bump(r.position);
    }
  }
  for (const l of schoolLines ?? []) {
    if (playerSlug(l.player_name) === slug) bump(l.position);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Player year (class) from any source. Stat lines carry it more often
 * than season-stat rows (Bound emits "JR" in per-game stat leaders).
 */
export function resolvePlayerYear({ schoolLines, seasonStats, schoolId, slug }) {
  for (const r of seasonStats ?? []) {
    if (r.school_id === schoolId && playerSlug(r.player_name) === slug && r.player_year) {
      return r.player_year;
    }
  }
  for (const l of schoolLines ?? []) {
    if (playerSlug(l.player_name) === slug && l.player_year) {
      return l.player_year;
    }
  }
  return null;
}
