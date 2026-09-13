/**
 * Stat-abbreviation glossary — the expansion behind every <abbr> on a
 * box score and the "What do these abbreviations mean?" list under
 * Game Stats.
 *
 * The recap sentences are written for a grandparent; the stat tables
 * assumed a coach. Critique run 14 found `document.querySelectorAll("abbr")`
 * empty on every route of a product built on stat lines. This module is
 * the one place a key's meaning lives.
 *
 * Keys collide across sports and even across categories inside one
 * sport: "A" is assists on a hockey line and aces on a volleyball
 * serving line, "AST" is assisted tackles on a football defensive line
 * and assists everywhere else, "PF" is personal fouls in a basketball
 * box score and points-for in a standings table. Lookups therefore go
 * category → sport → shared, most specific first. Keys match
 * case-insensitively with internal whitespace removed, so the sources'
 * "SV %", "Sv%" and "SV%" are one key.
 */

/** Uppercase, whitespace-free form of a source column header. */
export function normalizeStatKey(key) {
  return String(key ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

const SHARED = {
  // Football
  YDS: "Yards",
  TDS: "Touchdowns",
  TD: "Touchdowns",
  ATT: "Attempts",
  AVG: "Average per attempt",
  LNG: "Longest play",
  INT: "Interceptions",
  REC: "Receptions",
  "C/A": "Completions / attempts",
  C: "Completions",
  COMP: "Completions",
  "C%": "Completion percentage",
  QBRATE: "Passer rating",
  CAR: "Carries",
  "100+": "100-yard games",
  TKL: "Tackles",
  TOTTCKLS: "Total tackles",
  TFL: "Tackles for loss",
  SKS: "Sacks",
  SOLO: "Solo tackles",
  ASST: "Assisted tackles",
  FR: "Fumble recoveries",
  // Basketball
  PTS: "Points",
  FG: "Field goals made–attempted",
  FGM: "Field goals made",
  FGA: "Field goals attempted",
  "FG%": "Field-goal percentage",
  FG_PCT: "Field-goal percentage",
  "AFG%": "Adjusted field-goal percentage (three-pointers weighted)",
  "3PT": "Three-pointers made",
  FT: "Free throws made–attempted",
  MIN: "Minutes played",
  RBD: "Rebounds",
  REB: "Rebounds",
  OREB: "Offensive rebounds",
  DREB: "Defensive rebounds",
  OFF: "Offensive rebounds",
  AST: "Assists",
  STL: "Steals",
  BLK: "Blocks",
  BLK_BB: "Blocks",
  TO: "Turnovers",
  "A/TO": "Assist-to-turnover ratio",
  PF: "Personal fouls",
  // Hockey
  G: "Goals",
  A: "Assists",
  SOG: "Shots on goal",
  PIM: "Penalty minutes",
  "+/-": "Plus-minus (on ice for goals for minus goals against)",
  GA: "Goals against",
  SV: "Saves",
  "SV%": "Save percentage",
  // Volleyball
  SP: "Sets played",
  K: "Kills",
  KLS: "Kills",
  "K/S": "Kills per set",
  "KILL%": "Kill percentage",
  E: "Attack errors",
  "HIT%": "Hitting percentage (kills minus errors, over attempts)",
  ACE: "Aces",
  SA: "Service aces",
  SE: "Service errors",
  "SERV%": "Serve percentage",
  "ACE%": "Ace percentage",
  TOTBLKS: "Total blocks",
  "B/S": "Blocks per set",
  BA: "Block assists",
  BS: "Solo blocks",
  BE: "Block errors",
  D: "Digs",
  DIG: "Digs",
  "D/S": "Digs per set",
  DE: "Dig errors",
  "AST/S": "Assists per set",
  BHA: "Ball-handling attempts",
  BHE: "Ball-handling errors",
  GP: "Games played",
};

const BY_SPORT = {
  football: {
    AST: "Assisted tackles",
    A: "Assisted tackles",
  },
  volleyball: {
    ATT: "Attack attempts",
    E: "Attack errors",
    A: "Assists",
  },
};

const BY_CATEGORY = {
  "Serve Aces": {
    A: "Aces",
    "A/S": "Aces per set",
    PTS: "Points scored on serve",
  },
  Kills: {
    ATT: "Attack attempts",
    E: "Attack errors",
  },
  "Total Tackles": {
    AST: "Assisted tackles",
    A: "Assisted tackles",
  },
  "Hockey Saves": {
    MIN: "Minutes in goal",
  },
};

/**
 * Full name for a stat key, or null when the glossary has nothing for it.
 * `category` is the source line's category ("Passing Yards", "Serve
 * Aces"); `sportId` the registry id ("football", "volleyball").
 */
export function statTitle(key, { sportId, category } = {}) {
  const k = normalizeStatKey(key);
  if (!k) return null;
  return BY_CATEGORY[category]?.[k] ?? BY_SPORT[sportId]?.[k] ?? SHARED[k] ?? null;
}

/**
 * Glossary entries for a set of stat lines: every distinct (key, meaning)
 * pair the lines use, in first-seen order, unknown keys skipped. A key
 * that means two things on one page ("A" as aces and as assists) appears
 * twice, each with its own meaning.
 */
export function glossaryForLines(lines, sportId) {
  const seen = new Set();
  const out = [];
  for (const line of lines ?? []) {
    for (const rawKey of Object.keys(line?.stats ?? {})) {
      const title = statTitle(rawKey, { sportId, category: line.category });
      if (!title) continue;
      const id = `${normalizeStatKey(rawKey)}|${title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ key: String(rawKey).trim(), title });
    }
  }
  return out;
}
