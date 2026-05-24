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

import { SPORTS } from "../config/sports.js";

const BLOWOUT_MARGIN = 21;
const CLOSE_MARGIN = 7;

/** Returns a single sentence describing the game's result, or null if not final. */
export function recapForGame(
  game,
  {
    schoolsById,
    teamGames = null,
    perspectiveSchoolId = null,
    seasonStatsForSchool = null,
    enrichWithSeasonTotals = false,
    contextGames = null,
    sportConfig = null,
  } = {},
) {
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

  // Editorial framing for season-bookend games (last reg-season,
  // playoff exit, state title) — these override the standard opener
  // because they're the story, not just another game.
  const bookend = buildBookendOpener({
    teamGames, game, subject, oppLabel, own, opp, margin, won, tied, dateLabel,
  });
  const opener = bookend
    ?? `${subject} ${resultPhrase}${recordPhrase}${conferencePhrase} on ${dateLabel}.`;
  const headline = headlineStatLine(game, perspective, sportConfig);
  if (!headline) return opener;

  const priorAppearance = contextGames
    ? findPriorAppearance(contextGames ?? teamGames, headline, perspective, game)
    : null;
  const statSentence = formatStatLine(headline, priorAppearance, sportConfig);
  // Season-totals enrichment is opt-in (Hero only) because Bound's
  // season-stats reflect the moment of the scrape, not the moment of
  // each historical game — applying them to a Week 2 recap would
  // misrepresent the running record.
  const seasonClause =
    enrichWithSeasonTotals && seasonStatsForSchool
      ? seasonClauseFor(headline, seasonStatsForSchool)
      : null;
  return statSentence
    ? seasonClause
      ? `${opener} ${statSentence} ${seasonClause}`
      : `${opener} ${statSentence}`
    : opener;
}

/**
 * Standalone player line: returns just the headline stat sentence for
 * whoever won the game, with no score-summary prefix. Used by the
 * dashboard ticker cards and the This Week grid where the score is
 * already visible elsewhere in the row.
 */
export function playerLineForGame(game, { contextGames = null, sportConfig = null } = {}) {
  if (!game || game.status !== "final") return null;
  const home = game.home;
  const away = game.away;
  if (home.score == null || away.score == null) return null;
  const homeWon = home.score > away.score;
  const awayWon = away.score > home.score;
  // For ties we can't pick a winner — try home then away.
  // For decided games, prefer the winner's perspective; fall back to the
  // loser if the winner isn't a school we track (e.g., out-of-area
  // opponent), so a tracked team in a loss still gets its headline shown.
  let perspective = null;
  if (homeWon) {
    perspective = home.school_id || away.school_id;
  } else if (awayWon) {
    perspective = away.school_id || home.school_id;
  } else {
    perspective = home.school_id || away.school_id;
  }
  if (!perspective) return null;
  const headline = headlineStatLine(game, perspective, sportConfig);
  if (!headline) return null;
  const prior = contextGames
    ? findPriorAppearance(contextGames, headline, perspective, game)
    : null;
  return formatStatLine(headline, prior, sportConfig);
}

/**
 * Return the StatLine object (not the formatted string) that wins the
 * narrative-weight contest. Driven by sportConfig.stats.gameLine.order
 * — the first category whose formatter returns non-null wins.
 *
 * Falls back to the legacy football order when sportConfig isn't
 * supplied, so existing callers that haven't been updated still work.
 */
function headlineStatLine(game, schoolId, sportConfig = null) {
  const leaders = (game.stat_leaders ?? []).filter(
    (l) => l.team_school_id === schoolId,
  );
  if (leaders.length === 0) return null;
  const order = sportConfig?.stats?.gameLine?.order
    ?? ["Passing Yards", "Rushing Yards", "Receiving Yards", "Total Tackles"];
  for (const cat of order) {
    const line = leaders.find((l) => l.category === cat);
    if (line && formatStatLine(line, null, sportConfig)) return line;
  }
  return null;
}

/**
 * Match the headline player to their season-stats row, then format a
 * short follow-up clause. Mapping is by case-insensitive player name
 * (Bound is the source for both, so names line up modulo whitespace).
 */
function seasonClauseFor(statLine, seasonStatsForSchool) {
  if (!seasonStatsForSchool || seasonStatsForSchool.length === 0) return null;
  const normLineName = (statLine.player_name || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normLineName) return null;

  const matchCat = {
    "Passing Yards": "Passing",
    "Rushing Yards": "Rushing",
    "Receiving Yards": "Receiving",
    "Total Tackles": "Defense",
  }[statLine.category];
  if (!matchCat) return null;

  const seasonRow = seasonStatsForSchool.find(
    (r) =>
      r.category === matchCat &&
      (r.player_name || "").replace(/\s+/g, " ").trim().toLowerCase() === normLineName,
  );
  if (!seasonRow) return null;

  const s = seasonRow.stats ?? {};
  if (matchCat === "Passing") {
    const yds = parseInt(s.YDS, 10);
    const tds = parseInt(s.TDS, 10);
    if (!Number.isFinite(yds)) return null;
    const tdClause = Number.isFinite(tds) && tds > 0
      ? ` and ${tds} TD${tds === 1 ? "" : "s"}`
      : "";
    return `He now has ${yds.toLocaleString()} passing yards${tdClause} on the season.`;
  }
  if (matchCat === "Rushing") {
    const yds = parseInt(s.YDS, 10);
    const tds = parseInt(s.TDS, 10);
    if (!Number.isFinite(yds)) return null;
    const tdClause = Number.isFinite(tds) && tds > 0
      ? ` and ${tds} rushing TD${tds === 1 ? "" : "s"}`
      : "";
    return `He's up to ${yds.toLocaleString()} rushing yards${tdClause} on the season.`;
  }
  if (matchCat === "Receiving") {
    const yds = parseInt(s.YDS, 10);
    const tds = parseInt(s.TDS, 10);
    if (!Number.isFinite(yds)) return null;
    const tdClause = Number.isFinite(tds) && tds > 0
      ? ` and ${tds} TD${tds === 1 ? "" : "s"}`
      : "";
    return `He's at ${yds.toLocaleString()} receiving yards${tdClause} on the season.`;
  }
  if (matchCat === "Defense") {
    const tkl = parseFloat(s.TOT);
    if (!Number.isFinite(tkl)) return null;
    return `He's racked up ${tkl.toFixed(0)} tackles on the season.`;
  }
  return null;
}

/**
 * Sport-aware game-line formatter. Delegates to the sport's
 * `stats.gameLine.format(line, ctx)`; passes a `tone` if the sport
 * provides a `computeTone` (football only today).
 *
 * Returns null when the line isn't worth mentioning (below the sport's
 * threshold). Falls back to football's formatter when sportConfig
 * isn't supplied (preserves behavior for callers not yet updated).
 */
function formatStatLine(line, prior = null, sportConfig = null) {
  const cfg = sportConfig?.stats?.gameLine ?? SPORTS.football.stats.gameLine;
  const tone = cfg.computeTone ? cfg.computeTone(line, prior) : "default";
  try {
    return cfg.format(line, { tone }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Walk back through the team's prior games to find the most recent one
 * where the same player was the leader in the same category. Returns
 * the prior StatLine + game date, or null if this is their first
 * appearance in our data (or contextGames isn't provided).
 */
function findPriorAppearance(contextGames, headline, schoolId, currentGame) {
  if (!contextGames || !headline) return null;
  const playerKey = (headline.player_name || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!playerKey) return null;
  const currentTs = new Date(currentGame.date).getTime();

  // Sort prior games descending by date — most recent first
  const candidates = contextGames
    .filter(
      (g) =>
        g.status === "final" &&
        new Date(g.date).getTime() < currentTs &&
        (g.home.school_id === schoolId || g.away.school_id === schoolId),
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  for (const g of candidates) {
    const match = (g.stat_leaders ?? []).find(
      (l) =>
        l.team_school_id === schoolId &&
        l.category === headline.category &&
        (l.player_name || "").replace(/\s+/g, " ").trim().toLowerCase() === playerKey,
    );
    if (match) return { line: match, date: g.date };
  }
  return null;
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

/* ------------------------------------------------------------------
 * Editorial bookend framing — replaces the standard opener for games
 * that mark the end of the regular season or the playoff run. These
 * games carry narrative weight, not just box-score weight.
 * ------------------------------------------------------------------ */

// Rounds that end the playoff run for a winner (= state champion).
const STATE_TITLE_ROUNDS = new Set([
  "Level 4", "State Final", "State Championship",
]);

function buildBookendOpener({
  teamGames, game, subject, oppLabel, own, opp, margin, won, tied, dateLabel,
}) {
  if (!teamGames || teamGames.length === 0) return null;
  if (tied) return null; // tied games keep the default framing

  // Find the latest regular-season game and latest overall game for
  // this team — used to classify the current game.
  let lastReg = null;
  let lastOverall = null;
  for (const g of teamGames) {
    if (g.status !== "final") continue;
    if (!lastOverall || new Date(g.date) > new Date(lastOverall.date)) lastOverall = g;
    if (!g.playoff && (!lastReg || new Date(g.date) > new Date(lastReg.date))) {
      lastReg = g;
    }
  }

  const isLastReg = !game.playoff && lastReg && game.id === lastReg.id;
  const isPlayoffExit = game.playoff && !won && lastOverall && game.id === lastOverall.id;
  const isStateTitle = game.playoff && won && STATE_TITLE_ROUNDS.has(game.playoff_round ?? "");
  const isPlayoffAdvance = game.playoff && won && !isStateTitle;

  // 1. State champion — top priority. The Tigers brought home the title.
  if (isStateTitle) {
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      return `${subject} captured the state title with a ${own}-${opp} win over ${oppLabel} on ${dateLabel}.`;
    }
    if (Math.abs(margin) <= CLOSE_MARGIN) {
      return `${subject} survived ${oppLabel} ${own}-${opp} on ${dateLabel} to claim the state title.`;
    }
    return `${subject} beat ${oppLabel} ${own}-${opp} on ${dateLabel} to claim the state title.`;
  }

  // 2. Playoff exit — season ends.
  if (isPlayoffExit) {
    const roundLabel = playoffRoundLabel(game);
    if (Math.abs(margin) <= CLOSE_MARGIN) {
      return `${subject}' season ended in heartbreak — a ${opp}-${own} ${roundLabel} loss to ${oppLabel} on ${dateLabel}.`;
    }
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      return `${subject}' season ended with a ${opp}-${own} ${roundLabel} loss to ${oppLabel} on ${dateLabel}.`;
    }
    return `${subject}' season came to a close with a ${opp}-${own} loss to ${oppLabel} in the ${roundLabel} on ${dateLabel}.`;
  }

  // 3. Last regular-season game — sets up the playoff or ends the year.
  if (isLastReg) {
    if (won) {
      if (Math.abs(margin) >= BLOWOUT_MARGIN) {
        return `${subject} closed out the regular season strong with a ${own}-${opp} drubbing of ${oppLabel} on ${dateLabel}.`;
      }
      if (Math.abs(margin) <= CLOSE_MARGIN) {
        return `${subject} edged ${oppLabel} ${own}-${opp} on ${dateLabel} to cap the regular season.`;
      }
      return `${subject} closed the regular season with a ${own}-${opp} win over ${oppLabel} on ${dateLabel}.`;
    }
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      return `${subject} stumbled into the postseason with a ${opp}-${own} loss to ${oppLabel} on ${dateLabel}.`;
    }
    return `${subject} closed the regular season with a ${opp}-${own} loss to ${oppLabel} on ${dateLabel}.`;
  }

  // 4. Playoff advancement (won, not the state title) — adds drive.
  if (isPlayoffAdvance) {
    const roundLabel = playoffRoundLabel(game);
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      return `${subject} rolled past ${oppLabel} ${own}-${opp} in the ${roundLabel} on ${dateLabel}.`;
    }
    if (Math.abs(margin) <= CLOSE_MARGIN) {
      return `${subject} survived ${oppLabel} ${own}-${opp} in the ${roundLabel} on ${dateLabel} to advance.`;
    }
    return `${subject} beat ${oppLabel} ${own}-${opp} in the ${roundLabel} on ${dateLabel} to advance.`;
  }

  return null;
}

function playoffRoundLabel(game) {
  const r = game.playoff_round;
  if (!r) return "playoff";
  // Football: "Level 1" reads better as "first round" / "Level 4" → "state championship game"
  if (r === "Level 1") return "first round";
  if (r === "Level 2") return "second round";
  if (r === "Level 3") return "third round";
  if (r === "Level 4") return "state championship game";
  // basketball/volleyball/hockey — round name reads cleanly as-is
  return r;
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
