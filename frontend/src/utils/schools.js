/**
 * Helpers for resolving a game's team metadata against the schools index.
 * The schools array comes from data/schools.json; build a lookup once
 * per render via `indexSchools(schools)`.
 */

export function indexSchools(schools) {
  const byId = new Map();
  for (const s of schools ?? []) byId.set(s.id, s);
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
