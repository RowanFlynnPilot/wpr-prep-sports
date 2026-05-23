/**
 * Deterministic recap generator.
 *
 * News-org rule: every word that appears in the recap must come from
 * verifiable data we scraped. No LLM, no embellishment, no invented
 * stats. The output is intentionally template-y and a little dry —
 * accuracy matters more than flair.
 *
 * Inputs:
 *   game         — a Game record from games.json
 *   schoolsById  — Map<schoolId, school>, from indexSchools()
 *   teamGames?   — optional list of completed games for the school whose
 *                  perspective drives the recap. When supplied, the recap
 *                  knows the team's record going into the game and can
 *                  say "improved to 5-0" instead of "won."
 *   perspectiveSchoolId? — which side the recap is written from. Defaults
 *                  to the home team when both sides are tracked.
 */

const BLOWOUT_MARGIN = 21;
const CLOSE_MARGIN = 7;

/** Returns a single sentence describing the game's result, or null if not final. */
export function recapForGame(game, { schoolsById, teamGames = null, perspectiveSchoolId = null } = {}) {
  if (!game || game.status !== "final") return null;
  if (game.home.score == null || game.away.score == null) return null;

  const homeId = game.home.school_id;
  const awayId = game.away.school_id;

  // Pick perspective: explicit > whichever side is tracked > home.
  let perspective = perspectiveSchoolId;
  if (!perspective) {
    if (homeId) perspective = homeId;
    else if (awayId) perspective = awayId;
    else return null;
  }

  const isHome = perspective === homeId;
  const isAway = perspective === awayId;
  if (!isHome && !isAway) return null;

  const own = isHome ? game.home.score : game.away.score;
  const opp = isHome ? game.away.score : game.home.score;
  const margin = own - opp;
  const won = margin > 0;
  const tied = margin === 0;

  const ownSchool = schoolsById?.get(perspective);
  const oppId = isHome ? awayId : homeId;
  const oppSchool = oppId ? schoolsById?.get(oppId) : null;

  const ownLabel = ownSchool?.mascot
    ? `the ${ownSchool.mascot}`
    : ownSchool?.name ?? (isHome ? game.home.name : game.away.name);
  const oppLabel =
    oppSchool?.name ?? (isHome ? game.away.name : game.home.name);

  const location = isHome ? "at home" : `on the road in ${oppLabel}`;
  const venue = !isHome && game.venue && !/^@/.test(oppLabel) ? "" : "";
  void venue; // reserved for future use when we have stadium names

  // Result + margin descriptor
  let resultPhrase;
  if (tied) {
    resultPhrase = `played to a ${own}-${opp} draw with ${oppLabel}`;
  } else if (won) {
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      resultPhrase = `routed ${oppLabel} ${own}-${opp}`;
    } else if (Math.abs(margin) <= CLOSE_MARGIN) {
      resultPhrase = `edged ${oppLabel} ${own}-${opp}`;
    } else {
      resultPhrase = `beat ${oppLabel} ${own}-${opp}`;
    }
  } else {
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      resultPhrase = `fell to ${oppLabel} ${opp}-${own}`;
    } else if (Math.abs(margin) <= CLOSE_MARGIN) {
      resultPhrase = `dropped a tight one to ${oppLabel} ${opp}-${own}`;
    } else {
      resultPhrase = `lost to ${oppLabel} ${opp}-${own}`;
    }
  }

  // Record context — only when teamGames is supplied so we know the
  // running record up to (and including) this game.
  let recordPhrase = "";
  if (teamGames) {
    const record = recordThrough(teamGames, perspective, game.id);
    if (record) {
      if (won) {
        recordPhrase = ` to improve to ${record.wins}-${record.losses}`;
      } else if (tied) {
        recordPhrase = ` (now ${record.wins}-${record.losses})`;
      } else {
        recordPhrase = ` and slipped to ${record.wins}-${record.losses}`;
      }
    }
  }

  // Conference flavor — only if recorded on the game and (for derived
  // standings) the opponent is also tracked.
  let conferencePhrase = "";
  if (game.conference || (ownSchool && oppSchool)) {
    const ownConf = confFor(ownSchool, game.sport);
    const oppConf = confFor(oppSchool, game.sport);
    if (ownConf && ownConf === oppConf) {
      conferencePhrase = ` in ${ownConf} action`;
    }
  }

  const dateLabel = formatRecapDate(game.date);

  // Capitalize the start. Use mascot-leading sentence ("The Lumberjacks…")
  // when possible because it reads more sportsly than "Wausau East…"
  const subject = ownSchool?.mascot ? `The ${ownSchool.mascot}` : ownSchool?.name ?? ownLabel;

  const opener = `${subject} ${resultPhrase}${recordPhrase}${conferencePhrase} on ${dateLabel}.`;
  const statSentence = headlineStatSentence(game, perspective);
  return statSentence ? `${opener} ${statSentence}` : opener;
}

/**
 * Standalone player line: returns just the headline stat sentence for
 * whoever won the game, with no score-summary prefix. Used by the
 * dashboard ticker cards and the This Week grid where the score is
 * already visible elsewhere in the row.
 */
export function playerLineForGame(game) {
  if (!game || game.status !== "final") return null;
  const home = game.home;
  const away = game.away;
  if (home.score == null || away.score == null) return null;
  const homeWon = home.score > away.score;
  const awayWon = away.score > home.score;
  // For ties we can't pick a "winner perspective" — skip.
  if (!homeWon && !awayWon) return null;
  const perspective = homeWon ? home.school_id : away.school_id;
  if (!perspective) return null;
  return headlineStatSentence(game, perspective);
}

/**
 * Pick the most narrative-worthy stat line for the perspective team and
 * format it as a short follow-up sentence. Returns null when no line
 * crosses the threshold for being interesting (low-output day or no
 * Bound coverage).
 *
 * Thresholds are conservative so we never tout a forgettable line —
 * better silent than embarrassing.
 */
function headlineStatSentence(game, schoolId) {
  const leaders = (game.stat_leaders ?? []).filter(
    (l) => l.team_school_id === schoolId,
  );
  if (leaders.length === 0) return null;

  // Categories ordered by narrative weight. The first leader that meets
  // its threshold wins.
  const order = ["Passing Yards", "Rushing Yards", "Receiving Yards", "Total Tackles"];
  for (const cat of order) {
    const line = leaders.find((l) => l.category === cat);
    if (!line) continue;
    const sentence = formatStatLine(line);
    if (sentence) return sentence;
  }
  return null;
}

function formatStatLine(line) {
  const stats = line.stats ?? {};
  const yds = parseFloat(stats.YDS);
  const tds = parseInt(stats.TDS, 10);
  const tkl = parseFloat(stats.TKL);

  const player = playerNameWithClass(line);

  switch (line.category) {
    case "Passing Yards": {
      if (!isFiniteNum(yds) || (yds < 150 && (!isFiniteNum(tds) || tds < 2))) {
        return null;
      }
      const ca = stats["C/A"];
      const completionsClause = ca ? ` (${ca})` : "";
      const tdClause = tdsToClause(tds);
      return `QB ${player} threw for ${yds.toFixed(0)} yards${completionsClause}${tdClause}.`;
    }
    case "Rushing Yards": {
      if (!isFiniteNum(yds) || (yds < 75 && (!isFiniteNum(tds) || tds < 2))) {
        return null;
      }
      const attClause = stats.ATT ? ` on ${stats.ATT} carries` : "";
      const tdClause = tdsToClause(tds);
      return `RB ${player} rushed for ${yds.toFixed(0)} yards${attClause}${tdClause}.`;
    }
    case "Receiving Yards": {
      if (!isFiniteNum(yds) || (yds < 75 && (!isFiniteNum(tds) || tds < 2))) {
        return null;
      }
      const recClause = stats.REC ? ` on ${stats.REC} catches` : "";
      const tdClause = tdsToClause(tds);
      return `WR ${player} caught ${yds.toFixed(0)} yards${recClause}${tdClause}.`;
    }
    case "Total Tackles": {
      if (!isFiniteNum(tkl) || tkl < 10) return null;
      const sks = parseFloat(stats.SKS);
      const sksClause = isFiniteNum(sks) && sks >= 1 ? ` and ${sks.toFixed(1)} sacks` : "";
      return `LB ${player} led the defense with ${tkl.toFixed(1)} tackles${sksClause}.`;
    }
    default:
      return null;
  }
}

function tdsToClause(tds) {
  if (!isFiniteNum(tds) || tds <= 0) return "";
  if (tds === 1) return " and a TD";
  return ` and ${tds} TDs`;
}

function playerNameWithClass(line) {
  const name = (line.player_name || "").replace(/\s+/g, " ").trim();
  if (!line.player_year) return name;
  return `${name} (${line.player_year})`;
}

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function recordThrough(games, schoolId, includeGameId) {
  let wins = 0,
    losses = 0,
    found = false;
  // Games are sorted ascending by date in the source; we count finals up
  // to and including `includeGameId`.
  for (const g of games) {
    if (g.status !== "final") continue;
    if (g.home.score == null || g.away.score == null) continue;
    const isHome = g.home.school_id === schoolId;
    const isAway = g.away.school_id === schoolId;
    if (!isHome && !isAway) continue;
    const own = isHome ? g.home.score : g.away.score;
    const opp = isHome ? g.away.score : g.home.score;
    if (own > opp) wins++;
    else if (own < opp) losses++;
    if (g.id === includeGameId) {
      found = true;
      break;
    }
  }
  return found ? { wins, losses } : null;
}

function confFor(school, sport) {
  if (!school || !sport) return null;
  return (
    (school.conferences ?? []).find((c) => c.sport === sport)?.conference ?? null
  );
}

const DATE_LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "America/Chicago",
});

function formatRecapDate(iso) {
  return DATE_LONG.format(new Date(iso));
}
