/**
 * Helpers for resolving a game's team metadata against the schools index.
 * The schools array comes from data/schools.json; build a lookup once
 * per render via `indexSchools(schools, games)`.
 *
 * When `games` is supplied, the WIAA logo URL is harvested from the first
 * game that references each school (home or away) and attached as
 * `logo_url` on the entry — so callers can render a real logo wherever
 * they have a school_id, even in views (like the conference standings)
 * where the underlying data model doesn't carry one.
 */

export function indexSchools(schools, games = []) {
  const byId = new Map();
  for (const s of schools ?? []) {
    byId.set(s.id, { ...s, logo_url: null });
  }
  for (const g of games ?? []) {
    for (const side of [g.home, g.away]) {
      if (!side?.school_id || !side?.logo_url) continue;
      const entry = byId.get(side.school_id);
      if (entry && !entry.logo_url) entry.logo_url = side.logo_url;
    }
  }
  return byId;
}

export function schoolFor(team, index) {
  if (!team?.school_id) return null;
  return index.get(team.school_id) ?? null;
}

/** Primary color for a school, or a neutral fallback. */
export function primaryColor(school) {
  return school?.colors?.[0] ?? "#1f2937";
}

/** Two-letter initials for a school name (e.g. "Wausau East" → "WE"). */
export function initials(name) {
  if (!name) return "?";
  const parts = name.replace(/\./g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
