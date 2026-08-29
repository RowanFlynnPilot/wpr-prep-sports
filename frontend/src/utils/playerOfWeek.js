/**
 * Player of the Week selection.
 *
 * Scans finalized games in the most recent week with games (so the
 * section still shows something at the start of a new week before
 * Friday's games land), scores each game's stat_leaders by a per-
 * category heuristic, and returns the standout.
 *
 * Eligibility: stat_leaders with a non-empty team_school_id only —
 * keeps the editorial focus on central-WI schools rather than
 * elevating an opponent's box score.
 */

import { topStatLines } from "./games.js";
import { startOfSchoolWeek } from "./weeks.js";

function asNum(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Score a per-game StatLine. Higher = more newsworthy. Categories that
 * don't map to a known sport return 0 so they never beat a real line.
 *
 * Calibration: a "great" performance lands around 100; an MVP-tier
 * one around 200. Stays consistent across sports so the same threshold
 * gates "show / don't show".
 */
function scoreStatLine(line) {
  const s = line.stats ?? {};
  const yds = asNum(s.YDS);
  const tds = asNum(s.TDS);
  const tkl = asNum(s.TKL);
  const sks = asNum(s.SKS);
  const pts = asNum(s.PTS);
  const rbd = asNum(s.RBD);
  const ast = asNum(s.AST);
  const kls = asNum(s.KLS);
  const dig = asNum(s.DIG);
  const ace = asNum(s.ACE);
  const sv = asNum(s.SV);
  const ga = asNum(s.GA);
  const g = asNum(s.G);
  const a = asNum(s.A);

  switch (line.category) {
    // Football
    case "Passing Yards":
      return (Number.isFinite(yds) ? yds : 0) * 0.5
        + (Number.isFinite(tds) ? tds : 0) * 30;
    case "Rushing Yards":
      return (Number.isFinite(yds) ? yds : 0)
        + (Number.isFinite(tds) ? tds : 0) * 30;
    case "Receiving Yards":
      return (Number.isFinite(yds) ? yds : 0)
        + (Number.isFinite(tds) ? tds : 0) * 30;
    case "Total Tackles":
      return (Number.isFinite(tkl) ? tkl : 0) * 8
        + (Number.isFinite(sks) ? sks : 0) * 25;

    // Basketball
    case "Points":
      return (Number.isFinite(pts) ? pts : 0) * 4;
    case "Rebounds":
      return (Number.isFinite(rbd) ? rbd : 0) * 5;
    // "Assists" is shared between basketball and volleyball (Bound emits
    // the same label for both). Sport-disambiguate via the team-game
    // context isn't worth wiring here; a 10-assist basketball game and a
    // 30-assist volleyball setter line both land around the same scale
    // (60 vs 90) with this single coefficient.
    case "Assists":
      return (Number.isFinite(ast) ? ast : 0) * 6;

    // Volleyball
    case "Kills":
      return (Number.isFinite(kls) ? kls : 0) * 5;
    case "Digs":
      return (Number.isFinite(dig) ? dig : 0) * 2.5;
    case "Total Blocks":
      return (Number.isFinite(asNum(s.BLK)) ? asNum(s.BLK) : 0) * 8;
    case "Serve Aces":
      return (Number.isFinite(ace) ? ace : 0) * 10;

    // Hockey
    case "Hockey Points":
      return (Number.isFinite(pts) ? pts : 0) * 25
        + (Number.isFinite(g) ? g : 0) * 10
        + (Number.isFinite(a) ? a : 0) * 5;
    case "Hockey Goals":
      return (Number.isFinite(g) ? g : 0) * 30;
    case "Hockey Saves": {
      const base = Number.isFinite(sv) ? sv * 2 : 0;
      const shutoutBonus = Number.isFinite(ga) && ga === 0 && Number.isFinite(sv) && sv >= 15 ? 40 : 0;
      return base + shutoutBonus;
    }

    default:
      return 0;
  }
}

const DAY_MS = 86_400_000;
const SEVEN_DAYS = 7 * DAY_MS;

/**
 * Pick the standout player + line + game from the most recent week
 * of finalized play. Returns null when nothing qualifies.
 *
 *   minScore — minimum heuristic score to be shown (default 80 = a
 *              high-impact performance). Prevents quiet weeks from
 *              fielding an underwhelming highlight.
 */
/**
 * Resolve an editor's override against the dataset. Returns a pick
 * shaped like the algorithmic result so the renderer doesn't branch.
 * Returns null if the override can't be resolved (unknown game, etc.) —
 * caller should fall back to the algorithm.
 */
export function resolveOverridePotw(override, games) {
  if (!override) return null;
  // Expiry is part of the override contract (see data/potw.json's
  // _comment). fetchDataset filters expired overrides at fetch time,
  // but a dashboard left open across the boundary — or any future
  // caller passing the raw file — must not render one forever.
  if (override.expires_at) {
    const exp = new Date(override.expires_at).getTime();
    if (Number.isFinite(exp) && exp <= Date.now()) return null;
  }
  const { school_id, game_id, player_name } = override;
  if (!school_id || !game_id || !player_name) return null;
  const game = (games ?? []).find((g) => g.id === game_id);
  if (!game) return null;

  // Build a StatLine-shaped object so PlayerOfWeek.jsx renders the same
  // way it does for an algorithmic pick. `headline` is rendered in
  // place of the formatted stat line when present.
  const line = {
    player_name,
    player_year: override.player_year ?? null,
    position: override.position ?? null,
    team_school_id: school_id,
    category: override.category ?? null,
    stats: override.stats ?? {},
    headline: override.headline ?? null,
  };
  return { line, game, schoolId: school_id, source: "editor" };
}

// Minimum games with stat coverage (season-wide) before the algorithm
// crowns anyone. Stats arrive as coaches upload to MaxPreps over the
// days after a game, so early in a week the pool is "whoever's coach
// filed first" — opening week 2026 had exactly one box score for two
// days, which would have made Player of the Week a default judgment,
// not a comparison. Season-wide on purpose: a finished season's final
// week may hold under 10 stat games, but its pick was made against a
// full season of coverage. The editor override in data/potw.json
// bypasses this entirely — an explicit editorial pick always shows.
const MIN_STAT_GAMES_FOR_AUTO_PICK = 10;

export function pickPlayerOfWeek(
  games,
  { minScore = 80, anchor = null, eligibleSchoolIds = null } = {},
) {
  if (!games || games.length === 0) return null;

  const finals = games.filter(
    (g) => g.status === "final" && topStatLines(g).length > 0,
  );
  if (finals.length < MIN_STAT_GAMES_FOR_AUTO_PICK) return null;

  // Candidate pool = one SCHOOL WEEK (Mon-Sun), not a rolling 7 days.
  // A rolling window anchored to the single newest box score produced a
  // hybrid pool the day one week-2 upload landed (2026-08-29: 17 of 35
  // week-1 games plus the lone week-2 game — and the excluded 18
  // included the strongest week-1 lines). The newest week only takes
  // over once it has enough coverage to be a real comparison; until
  // then the previous, fully-covered week keeps the crown.
  let pool;
  if (anchor) {
    // Explicit anchor (tests, archive renders): classic 7-day window.
    const lastTs = new Date(anchor).getTime();
    const windowStart = lastTs - SEVEN_DAYS;
    pool = finals.filter((g) => {
      const t = new Date(g.date).getTime();
      return t >= windowStart && t <= lastTs + DAY_MS;
    });
  } else {
    const MIN_WEEK_STAT_GAMES = 3;
    const byWeek = new Map();
    for (const g of finals) {
      const key = startOfSchoolWeek(new Date(g.date)).getTime();
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key).push(g);
    }
    // Editorial cadence (Rowan/Shereen, 2026-08): a week's Player of
    // the Week is only DECLARED once the school week has ENDED — Monday
    // morning at the earliest — so coach uploads through the weekend
    // are in the pool before anyone is crowned. Saturday's early box
    // scores must not crown a premature winner; the previous completed
    // week keeps the card until then. The editor override in
    // data/potw.json remains the way to feature someone sooner.
    const weekKeys = [...byWeek.keys()]
      .filter((k) => k + 7 * DAY_MS <= Date.now())
      .sort((a, b) => b - a);
    if (weekKeys.length === 0) return null; // season's first week still open
    let chosen = weekKeys.find((k) => byWeek.get(k).length >= MIN_WEEK_STAT_GAMES);
    if (chosen == null) {
      // No completed week has real coverage — take the fullest (newest
      // on ties).
      chosen = weekKeys.reduce((best_, k) =>
        byWeek.get(k).length > byWeek.get(best_).length ? k : best_,
      weekKeys[0]);
    }
    pool = byWeek.get(chosen);
  }

  let best = null;
  for (const game of pool) {
    for (const line of topStatLines(game)) {
      if (!line.team_school_id) continue; // editorial focus: tracked schools only
      // Editorial radius (Shereen, 2026-08): Player of the Week features
      // athletes within ~60 miles of Wausau. SITE.homeRegionCities is
      // that radius as a city list — the same one the hero uses — so a
      // Superior or Eau Claire line can lead the scoreboard without
      // being crowned. null = no restriction (white-label tenants
      // without a configured home region keep the whole-coverage pick).
      if (eligibleSchoolIds && !eligibleSchoolIds.has(line.team_school_id)) continue;
      const score = scoreStatLine(line);
      if (score < minScore) continue;
      if (!best || score > best.score) {
        best = { line, game, schoolId: line.team_school_id, score, source: "algorithm" };
      }
    }
  }
  return best;
}
