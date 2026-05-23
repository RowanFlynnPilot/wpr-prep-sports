/**
 * Central registry of every sport this widget can render.
 *
 * Phase 1 of the sport-switcher refactor: only the cosmetic + bootstrap
 * fields each sport needs to display its labels correctly live here.
 * Stat categories, thresholds, and recap verbs remain inside the football
 * utils (utils/recap.js, utils/seasonStats.js, utils/seasonSummary.js)
 * for now and will migrate into this registry as basketball/volleyball
 * are wired up — at which point the utils will start taking a
 * `sportConfig` argument instead of hardcoding football's constants.
 *
 * Add a new sport by appending an entry here and creating
 * `data/<id>/` with games.json, standings.json, season_stats.json
 * (optional), and meta.json.
 */

export const DEFAULT_SPORT = "football";

/**
 * Stats display category — one per "leader card" the team page / dashboard
 * should render. Same shape across sports; sports with one underlying raw
 * category (basketball's "Player Stats") declare multiple displays that all
 * filter to that raw category but sort by different metrics.
 *
 *   id           — unique key within the sport (used as React key)
 *   rawCategory  — the row.category value in season_stats.json to filter on
 *   displayLabel — what the user sees ("Scoring", "Passing", etc.)
 *   position     — 2–4 char tag rendered in the leader-row badge
 *   sortKey      — stat field used to pick / rank leaders
 *   formatLine   — (stats) => string, the one-line summary in leader rows
 */

/** Numeric parse that strips commas/percent and returns NaN otherwise. */
function asNum(value) {
  if (value == null) return NaN;
  const n = parseFloat(String(value).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Comma-separate a "60 YDS" style chain, dropping empty parts. */
function joinLine(parts) {
  return parts.filter(Boolean).join(" · ");
}

const FOOTBALL_STAT_CATEGORIES = [
  {
    id: "passing",
    rawCategory: "Passing",
    displayLabel: "Passing",
    position: "QB",
    sortKey: "YDS",
    formatLine: (s) => joinLine([
      s.YDS && `${s.YDS} YDS`,
      s.TDS && `${s.TDS} TD`,
      s["C/ATT"] && `${s["C/ATT"]}`,
    ]),
  },
  {
    id: "rushing",
    rawCategory: "Rushing",
    displayLabel: "Rushing",
    position: "RB",
    sortKey: "YDS",
    formatLine: (s) => joinLine([
      s.YDS && `${s.YDS} YDS`,
      s.TDS && `${s.TDS} TD`,
      s.CAR && `${s.CAR} CAR`,
    ]),
  },
  {
    id: "receiving",
    rawCategory: "Receiving",
    displayLabel: "Receiving",
    position: "WR",
    sortKey: "YDS",
    formatLine: (s) => joinLine([
      s.YDS && `${s.YDS} YDS`,
      s.TDS && `${s.TDS} TD`,
      s.REC && `${s.REC} REC`,
    ]),
  },
  {
    id: "defense",
    rawCategory: "Defense",
    displayLabel: "Defense",
    position: "DEF",
    sortKey: "TOT",
    formatLine: (s) => joinLine([
      s.TOT && `${s.TOT} TKL`,
      s.SACKS && parseFloat(s.SACKS) > 0 && `${s.SACKS} SK`,
      s.TFL && parseFloat(s.TFL) > 0 && `${s.TFL} TFL`,
    ]),
  },
];

/** Basketball: one underlying "Basketball" raw row produces multiple displays. */
function basketballCategories({ ppgKey, rpgKey, apgKey, dKey, dLabel }) {
  return [
    {
      id: "scoring",
      rawCategory: "Basketball",
      displayLabel: "Scoring",
      position: "SCO",
      sortKey: ppgKey,
      formatLine: (s) => joinLine([
        s[ppgKey] != null && `${s[ppgKey]} ${ppgKey}`,
        s.FGPCT && `${s.FGPCT} FG`,
        s["3PPCT"] && `${s["3PPCT"]} 3P`,
      ]),
    },
    {
      id: "rebounding",
      rawCategory: "Basketball",
      displayLabel: "Rebounding",
      position: "REB",
      sortKey: rpgKey,
      formatLine: (s) => joinLine([
        s[rpgKey] != null && `${s[rpgKey]} ${rpgKey}`,
        s.ORPG != null && `${s.ORPG} OFF`,
        s.ORB != null && `${s.ORB} OFF`,
        s.BPG && parseFloat(s.BPG) > 0 && `${s.BPG} BPG`,
        s.BLK && parseFloat(s.BLK) > 0 && `${s.BLK} BLK`,
      ]),
    },
    {
      id: "playmaking",
      rawCategory: "Basketball",
      displayLabel: "Playmaking",
      position: "AST",
      sortKey: apgKey,
      formatLine: (s) => joinLine([
        s[apgKey] != null && `${s[apgKey]} ${apgKey}`,
        s["A/TO"] && `${s["A/TO"]} A/TO`,
      ]),
    },
    {
      id: "defense",
      rawCategory: "Basketball",
      displayLabel: dLabel,
      position: "DEF",
      sortKey: dKey,
      formatLine: (s) => joinLine([
        s.SPG != null && `${s.SPG} SPG`,
        s.STL != null && `${s.STL} STL`,
        s.BPG != null && `${s.BPG} BPG`,
        s.BLK != null && `${s.BLK} BLK`,
      ]),
    },
  ];
}

const BOYS_BASKETBALL_STAT_CATEGORIES = basketballCategories({
  ppgKey: "PPG", rpgKey: "RPG", apgKey: "APG", dKey: "SPG", dLabel: "Steals & Blocks",
});
const GIRLS_BASKETBALL_STAT_CATEGORIES = basketballCategories({
  ppgKey: "PTS", rpgKey: "RBD", apgKey: "AST", dKey: "STL", dLabel: "Steals & Blocks",
});

const VOLLEYBALL_STAT_CATEGORIES = [
  {
    id: "kills",
    rawCategory: "Volleyball Offense",
    displayLabel: "Kills",
    position: "OH",
    sortKey: "KLS",
    formatLine: (s) => joinLine([
      s.KLS && `${s.KLS} KLS`,
      s.ATT && `${s.ATT} ATT`,
      s.EFF && `${s.EFF} EFF`,
    ]),
  },
  {
    id: "assists",
    rawCategory: "Volleyball Offense",
    displayLabel: "Assists",
    position: "S",
    sortKey: "AST",
    formatLine: (s) => joinLine([
      s.AST && `${s.AST} AST`,
      s.SP && `${s.SP} SP`,
    ]),
  },
  {
    id: "digs",
    rawCategory: "Volleyball Defense",
    displayLabel: "Digs",
    position: "L",
    sortKey: "DIG",
    formatLine: (s) => joinLine([
      s.DIG && `${s.DIG} DIG`,
      s.BLK && `${s.BLK} BLK`,
    ]),
  },
  {
    id: "serving",
    rawCategory: "Volleyball Serving",
    displayLabel: "Serving",
    position: "SVR",
    sortKey: "ACE",
    formatLine: (s) => joinLine([
      s.ACE && `${s.ACE} ACE`,
      s.SUC && `${s.SUC} SUC`,
    ]),
  },
];

/**
 * Standout-picker config used by seasonSummary.js to pick the single player
 * featured in a team's prose summary.
 *
 *   weights — { rawCategory: (stats) => score } — higher means more notable
 *   minScore — function(scale) → minimum score to be "worth mentioning";
 *              `scale = max(1, gamesPlayed) / nominalSeasonLength` so the
 *              threshold drops sensibly mid-season
 *   format — (row, { seasonComplete }) => string | null — the prose clause
 */

function playerTag(row) {
  const name = (row.player_name || "").replace(/\s+/g, " ").trim();
  const year = row.player_year ? ` (${row.player_year})` : "";
  return `${name}${year}`;
}

/* ---------------- football ---------------- */

const FOOTBALL_STANDOUT_WEIGHTS = {
  Passing: (s) => (asNum(s.YDS) || 0) + 30 * (asNum(s.TDS) || 0),
  Rushing: (s) => 1.5 * (asNum(s.YDS) || 0) + 30 * (asNum(s.TDS) || 0),
  Receiving: (s) => 1.5 * (asNum(s.YDS) || 0) + 30 * (asNum(s.TDS) || 0),
  Defense: (s) =>
    5 * (asNum(s.TOT) || 0) + 8 * (asNum(s.TFL) || 0) + 15 * (asNum(s.SACKS) || 0),
};

function footballStandoutMinScore(scale, category) {
  return category === "Defense" ? 350 * scale
       : category === "Passing"  ? 900 * scale
       : 700 * scale; // Rushing / Receiving
}

function footballStandoutFormat(row, { seasonComplete }) {
  const s = row.stats || {};
  const player = playerTag(row);
  const yds = asNum(s.YDS);
  const tds = asNum(s.TDS);
  const tot = asNum(s.TOT);
  const tfl = asNum(s.TFL);
  const sacks = asNum(s.SACKS);

  if (row.category === "Defense") {
    if (!Number.isFinite(tot) || tot <= 0) return null;
    const sackClause = Number.isFinite(sacks) && sacks >= 3
      ? ` and ${sacks % 1 === 0 ? sacks.toFixed(0) : sacks.toFixed(1)} sacks`
      : Number.isFinite(tfl) && tfl >= 8
        ? ` and ${Math.round(tfl)} tackles for loss`
        : "";
    if (seasonComplete) {
      return `${player} anchored the defense with ${Math.round(tot)} tackles${sackClause} on the season.`;
    }
    return `${player} has been a force on defense, racking up ${Math.round(tot)} tackles${sackClause} so far.`;
  }

  if (!Number.isFinite(yds) || yds <= 0) return null;
  const CAT_PHRASING = {
    Passing:   { done: "finished the season throwing for", going: "has thrown for", noun: "yards" },
    Rushing:   { done: "finished the season rushing for",  going: "has rushed for",  noun: "yards" },
    Receiving: { done: "finished the season with",         going: "has piled up",    noun: "receiving yards" },
  };
  const phrasing = CAT_PHRASING[row.category];
  if (!phrasing) return null;
  const verb = seasonComplete ? phrasing.done : phrasing.going;
  const noun = phrasing.noun;
  const floor = Math.floor(yds / 100) * 100;
  const yardsPhrase = yds >= 200 && floor > 0
    ? `over ${floor.toLocaleString()} ${noun}`
    : `${Math.round(yds).toLocaleString()} ${noun}`;
  const tdsClause = Number.isFinite(tds) && tds > 0
    ? ` and ${Math.round(tds)} ${tds === 1 ? "touchdown" : "touchdowns"}`
    : "";
  return seasonComplete
    ? `${player} ${verb} ${yardsPhrase}${tdsClause}.`
    : `${player} has been the bright spot, ${verb.replace(/^has /, "")} ${yardsPhrase}${tdsClause} so far this season.`;
}

const FOOTBALL_STANDOUT = {
  weights: FOOTBALL_STANDOUT_WEIGHTS,
  minScore: footballStandoutMinScore,
  format: footballStandoutFormat,
  /** Nominal season length in games — used to scale the minScore threshold. */
  nominalSeasonGames: 9,
};

/* ---------------- per-game line pickers (recap.js) ---------------- */

/**
 * `gameLine` config drives the headline stat-line that follows the score
 * recap on the dashboard, ticker, and game-detail page. Each sport gets:
 *
 *   order — priority list of stat-leader categories (matches the strings
 *           Bound writes into game.stat_leaders[*].category)
 *   format(line, { tone }) — returns prose or null when the line isn't
 *           interesting enough to mention. The football impl honors tone
 *           (rebound/streak/quiet/default); other sports ignore it.
 *   computeTone(line, prior) — football-only; returns the tone string for
 *           a "verb texture" lookup. Null/missing → "default" always.
 */

function playerNameWithYear(line) {
  const name = (line.player_name || "").replace(/\s+/g, " ").trim();
  if (!line.player_year) return name;
  return `${name} (${line.player_year})`;
}

function tonePhrase(tone, family) {
  const phrases = {
    passing: {
      default: "threw for", rebound: "bounced back to throw for",
      streak: "stayed hot with", quiet: "managed",
    },
    rushing: {
      default: "rushed for", rebound: "bounced back with",
      streak: "kept rolling with", quiet: "scratched out",
    },
    receiving: {
      default: "caught", rebound: "bounced back with",
      streak: "stayed productive with", quiet: "added",
    },
    tackles: {
      default: "led the defense with", rebound: "anchored the defense again with",
      streak: "kept disrupting with", quiet: "still chipped in",
    },
  };
  return phrases[family]?.[tone] ?? phrases[family]?.default ?? "had";
}

function tdsToClause(tds) {
  const n = asNum(tds);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n === 1) return " and a TD";
  return ` and ${Math.round(n)} TDs`;
}

const FOOTBALL_GAME_LINE = {
  order: ["Passing Yards", "Rushing Yards", "Receiving Yards", "Total Tackles"],
  format: (line, ctx = {}) => {
    const stats = line.stats ?? {};
    const yds = asNum(stats.YDS);
    const tds = asNum(stats.TDS);
    const tkl = asNum(stats.TKL);
    const player = playerNameWithYear(line);
    const tone = ctx.tone || "default";
    switch (line.category) {
      case "Passing Yards": {
        if (!Number.isFinite(yds) || (yds < 150 && (!Number.isFinite(tds) || tds < 2))) return null;
        const ca = stats["C/A"] ? ` (${stats["C/A"]})` : "";
        const verb = tonePhrase(tone, "passing");
        return `QB ${player} ${verb} ${Math.round(yds).toLocaleString()} yards${ca}${tdsToClause(tds)}.`;
      }
      case "Rushing Yards": {
        if (!Number.isFinite(yds) || (yds < 75 && (!Number.isFinite(tds) || tds < 2))) return null;
        const att = stats.ATT ? ` on ${stats.ATT} carries` : "";
        const verb = tonePhrase(tone, "rushing");
        return `RB ${player} ${verb} ${Math.round(yds).toLocaleString()} yards${att}${tdsToClause(tds)}.`;
      }
      case "Receiving Yards": {
        if (!Number.isFinite(yds) || (yds < 75 && (!Number.isFinite(tds) || tds < 2))) return null;
        const rec = stats.REC ? ` on ${stats.REC} catches` : "";
        const verb = tonePhrase(tone, "receiving");
        return `WR ${player} ${verb} ${Math.round(yds).toLocaleString()} yards${rec}${tdsToClause(tds)}.`;
      }
      case "Total Tackles": {
        if (!Number.isFinite(tkl) || tkl < 10) return null;
        const sks = asNum(stats.SKS);
        const sksClause = Number.isFinite(sks) && sks >= 1 ? ` and ${sks.toFixed(1)} sacks` : "";
        const verb = tonePhrase(tone, "tackles");
        return `LB ${player} ${verb} ${tkl.toFixed(1)} tackles${sksClause}.`;
      }
      default:
        return null;
    }
  },
  computeTone: (line, prior) => {
    if (!prior) return "default";
    const stats = line.stats || {};
    const priorStats = prior.line?.stats || {};
    const yds = asNum(stats.YDS);
    const priorYds = asNum(priorStats.YDS);
    const tkl = asNum(stats.TKL);
    const priorTkl = asNum(priorStats.TKL);
    if (line.category === "Total Tackles") {
      if (!Number.isFinite(tkl) || !Number.isFinite(priorTkl)) return "default";
      if (tkl >= 12 && priorTkl >= 12) return "streak";
      if (tkl >= 12 && priorTkl < 8) return "rebound";
      if (tkl < 10 && priorTkl >= 14) return "quiet";
      return "default";
    }
    if (!Number.isFinite(yds) || !Number.isFinite(priorYds)) return "default";
    const strong = line.category === "Passing Yards" ? 200 : 100;
    const weak = line.category === "Passing Yards" ? 100 : 50;
    if (yds >= strong && priorYds >= strong) return "streak";
    if (yds >= strong && priorYds <= weak) return "rebound";
    if (yds < weak && priorYds >= strong) return "quiet";
    return "default";
  },
};

const BASKETBALL_GAME_LINE = {
  order: ["Points", "Rebounds", "Assists"],
  format: (line) => {
    const s = line.stats ?? {};
    const player = playerNameWithYear(line);
    const pts = asNum(s.PTS);
    const rbd = asNum(s.RBD);
    const ast = asNum(s.AST);
    switch (line.category) {
      case "Points": {
        if (!Number.isFinite(pts) || pts < 15) return null;
        const fg = s.FG ? ` (${s.FG} FG` + (s["3PT"] ? `, ${s["3PT"]} 3PT)` : ")") : "";
        return `${player} dropped ${Math.round(pts)} points${fg}.`;
      }
      case "Rebounds": {
        if (!Number.isFinite(rbd) || rbd < 8) return null;
        const off = s.OFF ? ` (${s.OFF} OFF)` : "";
        return `${player} grabbed ${Math.round(rbd)} rebounds${off}.`;
      }
      case "Assists": {
        if (!Number.isFinite(ast) || ast < 6) return null;
        return `${player} dished ${Math.round(ast)} assists.`;
      }
      default:
        return null;
    }
  },
};

/* ---------------- hockey ---------------- */

const HOCKEY_STAT_CATEGORIES = [
  {
    id: "scoring",
    rawCategory: "Hockey Skater",
    displayLabel: "Scoring",
    position: "C",
    sortKey: "PTS",
    formatLine: (s) => joinLine([
      s.PTS && `${s.PTS} PTS`,
      s.G && `${s.G} G`,
      s.A && `${s.A} A`,
    ]),
  },
  {
    id: "goals",
    rawCategory: "Hockey Skater",
    displayLabel: "Goals",
    position: "W",
    sortKey: "G",
    formatLine: (s) => joinLine([
      s.G && `${s.G} G`,
      s.SOG && `${s.SOG} SOG`,
      s["SOG %"] && `${s["SOG %"]} SOG%`,
    ]),
  },
  {
    id: "assists",
    rawCategory: "Hockey Skater",
    displayLabel: "Assists",
    position: "D",
    sortKey: "A",
    formatLine: (s) => joinLine([
      s.A && `${s.A} A`,
      s.PPA && parseFloat(s.PPA) > 0 && `${s.PPA} PPA`,
    ]),
  },
  {
    id: "goaltending",
    rawCategory: "Hockey Goalie",
    displayLabel: "Goaltending",
    position: "G",
    sortKey: "SV",
    formatLine: (s) => joinLine([
      s["SV %"] && `${s["SV %"]} SV%`,
      s.GAA && `${s.GAA} GAA`,
      s.SV && `${s.SV} SV`,
    ]),
  },
];

const HOCKEY_STANDOUT = {
  weights: {
    "Hockey Skater": (s) =>
      (asNum(s.PTS) || 0) * 2
      + (asNum(s.G) || 0) * 3,
    // Goalies weighted on save volume × save percentage — keeps backup
    // goalies with one perfect game from outranking the real starter.
    "Hockey Goalie": (s) => {
      const sv = asNum(s.SV) || 0;
      const pct = asNum(s["SV %"]) || 0; // ".891" parses as 0.891
      return sv * 0.6 + pct * 100;
    },
  },
  minScore: (scale, category) =>
    category === "Hockey Goalie" ? 100 * scale : 60 * scale,
  format: (row, { seasonComplete }) => {
    const s = row.stats || {};
    const name = (row.player_name || "").trim();
    if (row.category === "Hockey Skater") {
      const pts = asNum(s.PTS);
      const g = asNum(s.G);
      const a = asNum(s.A);
      if (!Number.isFinite(pts) || pts <= 0) return null;
      const breakdown = (Number.isFinite(g) && Number.isFinite(a))
        ? ` (${Math.round(g)} G, ${Math.round(a)} A)`
        : "";
      return seasonComplete
        ? `${name} led the team with ${Math.round(pts)} points${breakdown} on the season.`
        : `${name} is leading the team with ${Math.round(pts)} points${breakdown}.`;
    }
    if (row.category === "Hockey Goalie") {
      const svPct = s["SV %"];
      const gaa = s.GAA;
      const w = asNum(s.W);
      if (!svPct) return null;
      const wins = Number.isFinite(w) && w > 0 ? ` and won ${Math.round(w)} games` : "";
      return seasonComplete
        ? `Goalie ${name} posted a ${svPct} save percentage${gaa ? ` and ${gaa} GAA` : ""}${wins} on the season.`
        : `Goalie ${name} is posting a ${svPct} save percentage${gaa ? ` and ${gaa} GAA` : ""}${wins} so far.`;
    }
    return null;
  },
  nominalSeasonGames: 24,
};

// Hockey per-game line — fed by transform/stats.py merge_wph_per_game_stats.
// Categories emitted by the scraper: "Hockey Points", "Hockey Goals",
// "Hockey Saves". Per team the scraper attaches at most one of each, so
// the order list below determines which line wins the recap headline.
const HOCKEY_GAME_LINE = {
  order: ["Hockey Saves", "Hockey Points", "Hockey Goals"],
  format: (line) => {
    const s = line.stats ?? {};
    const player = playerNameWithYear(line);
    // Skater position prefix when known ("F" / "D") — mirrors football's
    // QB/RB/WR/LB pattern. Goalie lines already start with "Goalie", so
    // skip prefixing on saves.
    const skaterPrefix = (line.position && /^[FD]$/.test(line.position))
      ? `${line.position} ` : "";
    switch (line.category) {
      case "Hockey Points": {
        const pts = asNum(s.PTS);
        const g = asNum(s.G);
        const a = asNum(s.A);
        if (!Number.isFinite(pts) || pts < 2) return null;
        const breakdown = (Number.isFinite(g) && Number.isFinite(a))
          ? ` (${Math.round(g)}G, ${Math.round(a)}A)`
          : "";
        return `${skaterPrefix}${player} racked up ${Math.round(pts)} points${breakdown}.`;
      }
      case "Hockey Goals": {
        const g = asNum(s.G);
        const sog = asNum(s.SOG);
        if (!Number.isFinite(g) || g < 2) return null;
        const sogClause = Number.isFinite(sog) && sog > g ? ` on ${Math.round(sog)} shots` : "";
        return `${skaterPrefix}${player} scored ${Math.round(g)} goals${sogClause}.`;
      }
      case "Hockey Saves": {
        const sv = asNum(s.SV);
        const sog = asNum(s.SOG);
        const ga = asNum(s.GA);
        const svPct = s["SV %"];
        if (!Number.isFinite(sv) || sv < 20) return null;
        // Shutout reads better than "saved 28 of 28."
        if (Number.isFinite(ga) && ga === 0 && Number.isFinite(sog) && sog >= 15) {
          return `Goalie ${player} stopped all ${Math.round(sog)} shots for the shutout.`;
        }
        if (Number.isFinite(sog) && sog > sv) {
          const pctClause = svPct ? ` (${svPct})` : "";
          return `Goalie ${player} stopped ${Math.round(sv)} of ${Math.round(sog)} shots${pctClause}.`;
        }
        return `Goalie ${player} made ${Math.round(sv)} saves.`;
      }
      default:
        return null;
    }
  },
};

const VOLLEYBALL_GAME_LINE = {
  order: ["Kills", "Assists", "Digs", "Total Blocks"],
  format: (line) => {
    const s = line.stats ?? {};
    const player = playerNameWithYear(line);
    const kls = asNum(s.KLS);
    const ast = asNum(s.AST);
    const dig = asNum(s.DIG);
    const blk = asNum(s.BLK);
    switch (line.category) {
      case "Kills": {
        if (!Number.isFinite(kls) || kls < 10) return null;
        const eff = s.PCT ? ` (${s.PCT})` : "";
        return `${player} pounded ${Math.round(kls)} kills${eff}.`;
      }
      case "Assists": {
        if (!Number.isFinite(ast) || ast < 20) return null;
        return `${player} set ${Math.round(ast)} assists.`;
      }
      case "Digs": {
        if (!Number.isFinite(dig) || dig < 15) return null;
        return `${player} dug up ${Math.round(dig)} balls.`;
      }
      case "Total Blocks": {
        if (!Number.isFinite(blk) || blk < 5) return null;
        return `${player} stuffed ${Math.round(blk)} blocks at the net.`;
      }
      default:
        return null;
    }
  },
};

/* ---------------- basketball ---------------- */

function basketballStandout({ ppgKey, rpgKey, apgKey, ppgLabel = "PPG", rpgLabel = "RPG", apgLabel = "APG" }) {
  return {
    weights: {
      Basketball: (s) =>
        (asNum(s[ppgKey]) || 0) * 1.2
        + (asNum(s[rpgKey]) || 0) * 1
        + (asNum(s[apgKey]) || 0) * 1.5,
    },
    minScore: (scale) => 18 * scale, // works for both per-game (e.g. 15+ PPG) and totals
    format: (row, { seasonComplete }) => {
      const s = row.stats || {};
      const player = playerTag(row);
      const ppg = asNum(s[ppgKey]);
      const rpg = asNum(s[rpgKey]);
      const apg = asNum(s[apgKey]);
      if (!Number.isFinite(ppg) || ppg <= 0) return null;
      const ppgFmt = (key, val) => (val < 50 ? val.toFixed(1) : Math.round(val).toLocaleString());
      const parts = [`${ppgFmt(ppgKey, ppg)} ${ppgLabel}`];
      if (Number.isFinite(rpg) && rpg > 0) parts.push(`${ppgFmt(rpgKey, rpg)} ${rpgLabel}`);
      if (Number.isFinite(apg) && apg > 0) parts.push(`${ppgFmt(apgKey, apg)} ${apgLabel}`);
      const stats = parts.join(", ");
      return seasonComplete
        ? `${player} led the team with ${stats}.`
        : `${player} is leading the team with ${stats}.`;
    },
    nominalSeasonGames: 24,
  };
}

/* ---------------- volleyball ---------------- */

const VOLLEYBALL_STANDOUT_WEIGHTS = {
  "Volleyball Offense": (s) =>
    (asNum(s.KLS) || 0) * 1.2 + (asNum(s.AST) || 0) * 0.8,
  "Volleyball Defense": (s) => (asNum(s.DIG) || 0) + 2 * (asNum(s.BLK) || 0),
  "Volleyball Serving": (s) => 3 * (asNum(s.ACE) || 0),
};

const VOLLEYBALL_STANDOUT = {
  weights: VOLLEYBALL_STANDOUT_WEIGHTS,
  minScore: (scale) => 80 * scale,
  format: (row, { seasonComplete }) => {
    const s = row.stats || {};
    const player = playerTag(row);
    if (row.category === "Volleyball Offense") {
      const kls = asNum(s.KLS);
      const ast = asNum(s.AST);
      if (Number.isFinite(kls) && kls >= 100) {
        const eff = s.EFF ? ` (${s.EFF} EFF)` : "";
        return seasonComplete
          ? `${player} paced the offense with ${Math.round(kls)} kills${eff} on the season.`
          : `${player} is pacing the offense with ${Math.round(kls)} kills${eff} so far.`;
      }
      if (Number.isFinite(ast) && ast >= 100) {
        return seasonComplete
          ? `${player} dished ${Math.round(ast)} assists on the season.`
          : `${player} has dished ${Math.round(ast)} assists so far.`;
      }
      return null;
    }
    if (row.category === "Volleyball Defense") {
      const dig = asNum(s.DIG);
      const blk = asNum(s.BLK);
      const blkClause = Number.isFinite(blk) && blk >= 20 ? ` and ${Math.round(blk)} blocks` : "";
      if (!Number.isFinite(dig) || dig < 50) return null;
      return seasonComplete
        ? `${player} anchored the back row with ${Math.round(dig)} digs${blkClause}.`
        : `${player} has anchored the back row with ${Math.round(dig)} digs${blkClause}.`;
    }
    if (row.category === "Volleyball Serving") {
      const ace = asNum(s.ACE);
      if (!Number.isFinite(ace) || ace < 20) return null;
      return seasonComplete
        ? `${player} served up ${Math.round(ace)} aces on the season.`
        : `${player} has served up ${Math.round(ace)} aces so far.`;
    }
    return null;
  },
  nominalSeasonGames: 30,
};

/** Lookup of every sport the frontend knows about. */
export const SPORTS = {
  football: {
    id: "football",
    /** Display label used in section headers and the sport switcher. */
    label: "Football",
    /** Short label for tight UI like the mobile sport switcher. */
    shortLabel: "Football",
    /** Season string used in headers — kept editable in case WIAA changes format. */
    season: "2025–26",
    /**
     * Calendar months (0-indexed: Jan=0) during which this sport's data is
     * expected to refresh frequently. StaleBanner uses this to decide
     * whether a "data is N hours old" warning is appropriate.
     */
    activeMonths: [7, 8, 9, 10], // Aug–Nov
    /** Whether scraper writes a season_stats.json for this sport. */
    hasSeasonStats: true,
    /** Accent color emitted as --accent on the SportShell wrapper. */
    accentColor: "#f59e0b", // amber — Friday night lights
    accentDarkColor: "#b45309",
    /** Approximate next-season opener — used for off-season countdowns. */
    nextSeasonStart: "2026-08-21",
    stats: {
      categories: FOOTBALL_STAT_CATEGORIES,
      standout: FOOTBALL_STANDOUT,
      gameLine: FOOTBALL_GAME_LINE,
    },
  },
  boys_basketball: {
    id: "boys_basketball",
    label: "Boys Basketball",
    shortLabel: "Boys Hoops",
    season: "2025–26",
    activeMonths: [10, 11, 0, 1, 2], // Nov–Mar
    hasSeasonStats: true,
    accentColor: "#dc2626", // basketball red
    accentDarkColor: "#991b1b",
    nextSeasonStart: "2026-11-17",
    stats: {
      categories: BOYS_BASKETBALL_STAT_CATEGORIES,
      standout: basketballStandout({
        ppgKey: "PPG", rpgKey: "RPG", apgKey: "APG",
      }),
      gameLine: BASKETBALL_GAME_LINE,
    },
  },
  girls_basketball: {
    id: "girls_basketball",
    label: "Girls Basketball",
    shortLabel: "Girls Hoops",
    season: "2025–26",
    activeMonths: [10, 11, 0, 1, 2], // Nov–Mar
    hasSeasonStats: true,
    accentColor: "#dc2626", // basketball red (shared with boys — same sport family)
    accentDarkColor: "#991b1b",
    nextSeasonStart: "2026-11-10",
    stats: {
      categories: GIRLS_BASKETBALL_STAT_CATEGORIES,
      standout: basketballStandout({
        // Girls basketball uses totals (PTS/RBD/AST) where boys uses PPG/RPG/APG.
        ppgKey: "PTS", rpgKey: "RBD", apgKey: "AST",
        ppgLabel: "PTS", rpgLabel: "RBD", apgLabel: "AST",
      }),
      gameLine: BASKETBALL_GAME_LINE,
    },
  },
  boys_hockey: {
    id: "boys_hockey",
    label: "Boys Hockey",
    shortLabel: "Boys Hockey",
    season: "2025–26",
    activeMonths: [10, 11, 0, 1, 2], // Nov–Mar
    hasSeasonStats: true,
    accentColor: "#0284c7", // ice blue
    accentDarkColor: "#075985",
    nextSeasonStart: "2026-11-14",
    stats: {
      categories: HOCKEY_STAT_CATEGORIES,
      standout: HOCKEY_STANDOUT,
      gameLine: HOCKEY_GAME_LINE,
    },
  },
  girls_hockey: {
    id: "girls_hockey",
    label: "Girls Hockey",
    shortLabel: "Girls Hockey",
    season: "2025–26",
    activeMonths: [10, 11, 0, 1, 2], // Nov–Mar
    // Girls hockey on WPH is heavily co-op'd into entities that don't map
    // 1:1 to our manifest schools — stats not wired yet.
    hasSeasonStats: false,
    accentColor: "#0284c7", // ice blue
    accentDarkColor: "#075985",
    nextSeasonStart: "2026-11-14",
    stats: {
      categories: HOCKEY_STAT_CATEGORIES,
      standout: HOCKEY_STANDOUT,
      gameLine: HOCKEY_GAME_LINE,
    },
  },
  volleyball: {
    id: "volleyball",
    label: "Volleyball",
    shortLabel: "Volleyball",
    season: "2025–26",
    // Aug–Nov: regular season ends mid-Oct, state tournament early Nov.
    activeMonths: [7, 8, 9, 10],
    hasSeasonStats: true,
    // Scores are sets won/lost, not points — note this in the team page hero
    // so PF/PA don't read as points. See TeamPage record block.
    scoreLabel: "set",
    accentColor: "#c026d3", // vivid magenta
    accentDarkColor: "#86198f",
    nextSeasonStart: "2026-08-19",
    stats: {
      categories: VOLLEYBALL_STAT_CATEGORIES,
      standout: VOLLEYBALL_STANDOUT,
      gameLine: VOLLEYBALL_GAME_LINE,
    },
  },
};

/** All sport ids the registry knows about, in display order. */
export const SPORT_IDS = Object.keys(SPORTS);

/** Look up a sport config. Unknown ids fall back to the default sport. */
export function configFor(sportId) {
  return SPORTS[sportId] ?? SPORTS[DEFAULT_SPORT];
}

/** True if `id` is a known sport. */
export function isKnownSport(id) {
  return Object.prototype.hasOwnProperty.call(SPORTS, id);
}

/**
 * Labels for the for/against columns in records and standings. Defaults
 * to "Points For" / "Points Against" (abbreviated PF/PA) for sports
 * scored in points; volleyball's `scoreLabel: "set"` swaps it to
 * Sets W / Sets L since the numbers are set counts, not points.
 */
export function recordLabels(sportConfig) {
  if (sportConfig?.scoreLabel === "set") {
    return { for: "Sets W", against: "Sets L", diff: "Set diff." };
  }
  return { for: "PF", against: "PA", diff: "Point diff." };
}
