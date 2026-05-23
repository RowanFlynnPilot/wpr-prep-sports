/**
 * Build a 1–2 sentence "Season Summary" lede for a team page.
 *
 * Same news-org rule as the per-game recap (utils/recap.js): every claim
 * has to be backed by data we scraped. No invented stats, no embellishment.
 *
 * Auto-detects mid-season vs end-of-season:
 *   - mid-season if any game on the schedule isn't yet `final`
 *   - end-of-season once every game is final
 *
 * Returns null when we have nothing scoreable to summarize (no finals
 * yet, or no parseable scores).
 */

const SEASON_LABEL = "2025–26";

/** Numeric parse that strips commas/percent and returns NaN otherwise. */
function toNum(value) {
  if (value == null) return NaN;
  const n = parseFloat(String(value).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Round a yardage total down to the nearest 100 for "over X yards" phrasing. */
function roundDownToHundred(n) {
  if (!Number.isFinite(n)) return null;
  return Math.floor(n / 100) * 100;
}

/** Format an integer with thousands separators. */
function withCommas(n) {
  return Math.round(n).toLocaleString("en-US");
}

/** Walk a list of finals chronologically and compute W-L plus the last game. */
function arcFromFinals(finals, schoolId) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let last = null;
  for (const g of finals) {
    const isHome = g.home.school_id === schoolId;
    const own = isHome ? g.home.score : g.away.score;
    const opp = isHome ? g.away.score : g.home.score;
    if (own == null || opp == null) continue;
    if (own > opp) wins++;
    else if (own < opp) losses++;
    else ties++;
    last = { game: g, isHome, own, opp };
  }
  return { wins, losses, ties, last };
}

/** Split a list of games into regular-season and playoff buckets. */
function splitByPhase(games) {
  const regular = [];
  const playoff = [];
  for (const g of games) {
    if (g.playoff) playoff.push(g);
    else regular.push(g);
  }
  return { regular, playoff };
}

/** Adjective describing the overall arc, given the W-L and season state. */
function arcTone(wins, losses, seasonComplete) {
  const played = wins + losses;
  if (played === 0) return seasonComplete ? "quiet" : "early";
  if (losses === 0) return seasonComplete ? "undefeated" : "perfect";
  if (wins === 0) return seasonComplete ? "winless" : "rough";
  if (wins > losses && wins - losses >= 3) return seasonComplete ? "strong" : "strong";
  if (wins > losses) return seasonComplete ? "winning" : "promising";
  if (wins === losses) return "up-and-down";
  if (losses - wins >= 3) return seasonComplete ? "tough" : "rough";
  return "up-and-down";
}

/** Phrase that introduces the season arc (varies by mid- vs end-of-season). */
function arcPhrase(tone, seasonComplete, played) {
  if (seasonComplete) {
    const article = startsWithVowelSound(tone) ? "an" : "a";
    return `finished ${article} ${tone} season`;
  }
  // Mid-season — only one game played reads weirdly with "continues"
  if (played <= 1) {
    if (tone === "perfect") return "opened the season with a win";
    if (tone === "rough") return "opened the season with a loss";
    return "opened the season";
  }
  if (tone === "perfect") return "stayed perfect";
  if (tone === "rough") return "continues a rough start to the season";
  if (tone === "winless") return "is still searching for its first win";
  if (tone === "strong") return "rolled to a strong start";
  if (tone === "winning") return "kept a winning record going";
  if (tone === "up-and-down") return "stayed up and down on the season";
  return "extended a mixed start to the season";
}

function startsWithVowelSound(word) {
  return /^[aeiou]/i.test(word);
}

/** Sentence describing the most-recent regular-season game. */
function lastGameClause({ last, oppName, seasonComplete, wins, losses }) {
  if (!last) return "";
  const { own, opp } = last;
  const tied = own === opp;
  const won = own > opp;

  // Mid-season — anchor the running record because the hero record is "now"
  // and the recap is naturally about trajectory.
  if (!seasonComplete) {
    if (tied) {
      return `with a ${own}-${opp} draw against ${oppName} (${wins}-${losses})`;
    }
    if (won) {
      return `with a ${own}-${opp} win over ${oppName}, improving to ${wins}-${losses}`;
    }
    return `with a ${own}-${opp} loss to ${oppName}, falling to ${wins}-${losses}`;
  }

  // End-of-season — the hero shows the final record, so don't restate it.
  if (tied) return `with a ${own}-${opp} draw against ${oppName}`;
  if (won) return `with a ${own}-${opp} win over ${oppName}`;
  return `with a ${own}-${opp} loss to ${oppName}`;
}

/**
 * Sentence describing the team's playoff run (end-of-season only).
 * - 0 playoff games → null
 * - 1 game, lost   → "before falling to X in the WIAA Level 1 playoffs"
 * - >=2 games, all wins → "and ran the table in the WIAA playoffs, ..."
 * - >=2 games, last lost → "before winning N playoff games and falling to X in the {round}"
 */
function playoffClause({ playoffGames, schoolId, schoolsById }) {
  if (!playoffGames || playoffGames.length === 0) return null;

  const { wins, losses, last } = arcFromFinals(playoffGames, schoolId);
  if (!last) return null;

  const lastGame = last.game;
  const oppSide = last.isHome ? lastGame.away : lastGame.home;
  const oppName =
    schoolsById?.get(oppSide?.school_id)?.name ?? oppSide?.name ?? "their opponent";

  const lastRound = lastGame.playoff_round || "playoffs";
  const lastWon = last.own > last.opp;

  // Champions: every playoff game a win AND last round is championship.
  if (losses === 0 && /championship/i.test(lastRound)) {
    return `and captured the WIAA state championship with a ${last.own}-${last.opp} win over ${oppName}`;
  }

  // Unbeaten in playoffs but didn't reach championship (data gap / state run still in progress).
  if (losses === 0 && wins > 0) {
    const roundPhrase = roundDisplay(lastRound);
    return `and ran through ${wins} WIAA playoff game${wins === 1 ? "" : "s"} unbeaten, last beating ${oppName} ${last.own}-${last.opp} in ${roundPhrase}`;
  }

  // Played at least one playoff game and lost the last one.
  if (!lastWon) {
    const roundPhrase = roundDisplay(lastRound);
    if (wins === 0) {
      return `before falling to ${oppName} ${last.opp}-${last.own} in ${roundPhrase}`;
    }
    return `before winning ${wins} WIAA playoff game${wins === 1 ? "" : "s"} and falling to ${oppName} ${last.opp}-${last.own} in ${roundPhrase}`;
  }

  // Last playoff game was a win but earlier ones weren't — uncommon, but
  // describe truthfully.
  return `and went ${wins}-${losses} in the WIAA playoffs, last beating ${oppName} ${last.own}-${last.opp} in ${lastRound}`;
}

/** Format a round label for prose. Tuned for both football and basketball round names. */
function roundDisplay(round) {
  if (!round) return "the playoffs";
  // Football: "Level 1" reads more naturally with "the … playoffs" article.
  if (/^level\s*1$/i.test(round)) return "the Level 1 playoffs";
  if (/^level/i.test(round)) return round; // "Level 2", "Level 3", "Level 4"
  // State rounds (football's final week, basketball's Kohl Center weekend).
  if (/^state\s+championship/i.test(round)) return "the WIAA state championship";
  if (/^state\s+semifinal/i.test(round)) return "the WIAA state semifinal";
  if (/^state\s+final/i.test(round)) return "the WIAA state final";
  // Basketball: "Regional" alone is WIAA's term for the regional quarterfinal /
  // first round; treat it as such so the prose reads naturally.
  if (/^regional$/i.test(round)) return "the regional opener";
  // Everything else (Regional Semifinal, Regional Final, Sectional Semifinal,
  // Sectional Final, etc.) reads cleanly as "the <round>".
  return `the ${round}`;
}

/**
 * Pick the most narratively notable player on this team using the
 * sport's standout-weights config. Returns the row + score or null
 * when no one clears the "worth mentioning" threshold.
 */
function pickStandout(rows, sportConfig, seasonComplete, gamesPlayed) {
  const standout = sportConfig?.stats?.standout;
  if (!standout || !rows || rows.length === 0) return null;
  const players = rows.filter(
    (r) => r.player_name && r.player_name !== "Team",
  );
  if (players.length === 0) return null;

  let best = null;
  for (const row of players) {
    const weightFn = standout.weights?.[row.category];
    if (!weightFn) continue;
    const score = weightFn(row.stats || {});
    if (!Number.isFinite(score)) continue;
    if (!best || score > best.score) {
      best = { row, score };
    }
  }
  if (!best) return null;

  const nominal = standout.nominalSeasonGames || 1;
  const scale = Math.max(1, gamesPlayed) / nominal;
  const min = standout.minScore?.(scale, best.row.category) ?? 0;
  if (best.score < min) return null;
  return best;
}

/** Format the standout's line of prose via the sport's standout.format. */
function standoutClause(standout, sportConfig, seasonComplete) {
  if (!standout) return null;
  const fn = sportConfig?.stats?.standout?.format;
  if (!fn) return null;
  try {
    return fn(standout.row, { seasonComplete }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the full season summary string for one team, or null.
 */
export function seasonSummary({
  teamGames,
  schoolId,
  school,
  schoolsById,
  seasonStatsForSchool,
  sportConfig,
}) {
  if (!teamGames || teamGames.length === 0) return null;

  const finals = teamGames.filter((g) => g.status === "final");
  if (finals.length === 0) return null;

  // The season is "complete" when no scheduled games remain in the future.
  // We can't require `finals.length === teamGames.length` because WIAA
  // sometimes leaves cancelled/postponed games on the schedule with
  // status="scheduled" forever, which would otherwise pin the prose into
  // mid-season tone months after the actual season ended.
  const now = Date.now();
  const seasonComplete = !teamGames.some(
    (g) => g.status !== "final" && new Date(g.date).getTime() > now,
  );
  const { regular: regularFinals, playoff: playoffFinals } = splitByPhase(finals);

  // Tone is driven by the regular-season arc — that's how a coach or beat
  // writer would describe a 5-4 team that lost in Level 1. Fall back to all
  // finals only if no regular-season games are present (data oddity).
  const arcSource = regularFinals.length > 0 ? regularFinals : finals;
  const { wins, losses, last } = arcFromFinals(arcSource, schoolId);
  if (!last) return null;

  const oppSide = last.isHome ? last.game.away : last.game.home;
  const oppSchool = oppSide?.school_id ? schoolsById?.get(oppSide.school_id) : null;
  const oppName = oppSchool?.name ?? oppSide?.name ?? "opponent";

  const schoolName = school?.name ?? "The team";
  const played = wins + losses;
  const tone = arcTone(wins, losses, seasonComplete);
  const arc = arcPhrase(tone, seasonComplete, played);
  const tail = lastGameClause({
    last,
    oppName,
    seasonComplete,
    wins,
    losses,
  });

  // Phrase "finished a {tone} regular season" instead of "season" when the
  // team also played in the playoffs — clarifies what the W-L describes.
  const hasPlayoffRun = seasonComplete && playoffFinals.length > 0;
  const arcAdjusted = hasPlayoffRun
    ? arc.replace(/\bseason\b/g, "regular season")
    : arc;

  // Build the opener. End-of-season teams with a playoff run get the
  // playoff clause inlined so it reads as one continuous sentence.
  let opener;
  if (hasPlayoffRun) {
    const playoff = playoffClause({
      playoffGames: playoffFinals,
      schoolId,
      schoolsById,
    });
    opener = playoff
      ? `${schoolName} ${arcAdjusted} ${playoff}.`
      : `${schoolName} ${arcAdjusted} ${tail}.`;
  } else {
    opener = tail ? `${schoolName} ${arcAdjusted} ${tail}.` : `${schoolName} ${arcAdjusted}.`;
  }

  const standout = pickStandout(
    seasonStatsForSchool ?? [],
    sportConfig,
    seasonComplete,
    played,
  );
  const player = standoutClause(standout, sportConfig, seasonComplete);

  return player ? `${opener} ${player}` : opener;
}

export const SEASON_SUMMARY_LABEL = SEASON_LABEL;
