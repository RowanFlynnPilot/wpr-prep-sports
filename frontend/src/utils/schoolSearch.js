/**
 * School lookup for the masthead finder and the A–Z index.
 *
 * Readers type what they call the school, which is rarely its manifest
 * name: "Everest" for D.C. Everest, "Rapids" for Wisconsin Rapids, the
 * town for a small school, the mascot when that is what's on the
 * sweatshirt. Matching therefore runs over name, full name, mascot, and
 * city, folded to lowercase ASCII, and ranks name matches above the rest
 * so "Wausau" lists Wausau East and Wausau West before schools that
 * merely sit in Wausau.
 */

/** Lowercase, strip accents and punctuation, collapse separators. */
export function fold(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/[\s/.-]+/g, " ")
    .trim();
}

const compact = (s) => s.replace(/ /g, "");
const wordStarts = (hay, term) => hay.split(" ").some((w) => w.startsWith(term));

/**
 * Rank schools against a free-text query. Returns up to `limit` school
 * objects, best match first; an empty query returns nothing (the finder
 * shows no list until the reader types).
 */
export function searchSchools(schools, query, { limit = 8 } = {}) {
  const q = fold(query);
  if (!q) return [];
  const qc = compact(q);
  const terms = q.split(" ");
  const scored = [];

  for (const s of schools ?? []) {
    const name = fold(s.name);
    const full = fold(s.full_name);
    const mascot = fold(s.mascot);
    const city = fold(s.city);
    const aliases = (s.aliases ?? []).map(fold);
    const names = [name, full, ...aliases].filter(Boolean);

    let score = 0;
    if (names.some((h) => compact(h).startsWith(qc))) {
      // "d.c. ev", "dc ev", "wausau e" — the name as typed.
      score = 100;
    } else if (terms.every((t) => names.some((h) => wordStarts(h, t)))) {
      // Every typed word starts a word of the name: "everest", "rapids".
      score = 80;
    } else if (terms.every((t) => wordStarts(city, t))) {
      score = 60;
    } else if (terms.every((t) => wordStarts(mascot, t))) {
      score = 50;
    } else if (terms.every((t) => [...names, city, mascot].some((h) => h.includes(t)))) {
      score = 30;
    }
    if (score) scored.push({ school: s, score });
  }

  scored.sort(
    (a, b) => b.score - a.score || String(a.school.name).localeCompare(String(b.school.name)),
  );
  return scored.slice(0, limit).map((x) => x.school);
}

/** The conference a school plays `sport` in, or null if it fields no team. */
export function conferenceFor(school, sport) {
  return (school?.conferences ?? []).find((c) => c.sport === sport)?.conference ?? null;
}

/** Schools that field a team in `sport`, A–Z by name. */
export function schoolsForSport(schools, sport) {
  return (schools ?? [])
    .filter((s) => conferenceFor(s, sport))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Bucket an A–Z list by first letter: [{ letter, schools }]. */
export function groupByLetter(schools) {
  const map = new Map();
  for (const s of schools ?? []) {
    const letter = String(s.name ?? "?").charAt(0).toUpperCase();
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter).push(s);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, list]) => ({ letter, schools: list }));
}
