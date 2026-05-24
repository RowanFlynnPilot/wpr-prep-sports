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

    // Basketball — both rendered categories
    case "Points":
      return (Number.isFinite(pts) ? pts : 0) * 4;
    case "Rebounds":
      return (Number.isFinite(rbd) ? rbd : 0) * 5;
    case "Assists":
      return (Number.isFinite(ast) ? ast : 0) * 6;

    // Volleyball
    case "Kills":
      return (Number.isFinite(kls) ? kls : 0) * 4;
    case "Digs":
      return (Number.isFinite(dig) ? dig : 0) * 2.5;
    case "Total Blocks":
      return (Number.isFinite(asNum(s.BLK)) ? asNum(s.BLK) : 0) * 8;

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

export function pickPlayerOfWeek(games, { minScore = 80, anchor = null } = {}) {
  if (!games || games.length === 0) return null;

  const finals = games.filter(
    (g) => g.status === "final" && (g.stat_leaders ?? []).length > 0,
  );
  if (finals.length === 0) return null;

  // Anchor to the most-recent game; window is 7 days back from there.
  const lastTs = anchor
    ? new Date(anchor).getTime()
    : finals.reduce(
        (acc, g) => Math.max(acc, new Date(g.date).getTime()),
        0,
      );
  const windowStart = lastTs - SEVEN_DAYS;

  let best = null;
  for (const game of finals) {
    const gameTs = new Date(game.date).getTime();
    if (gameTs < windowStart || gameTs > lastTs + DAY_MS) continue;
    for (const line of game.stat_leaders) {
      if (!line.team_school_id) continue; // editorial focus: tracked schools only
      const score = scoreStatLine(line);
      if (score < minScore) continue;
      if (!best || score > best.score) {
        best = { line, game, schoolId: line.team_school_id, score, source: "algorithm" };
      }
    }
  }
  return best;
}
