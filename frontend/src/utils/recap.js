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
 * Standalone player line: returns the headline stat sentence for
 * whoever won the game plus the school_id the player belongs to, so
 * the renderer can show team context next to the highlight. Used by
 * the dashboard ticker cards and the This Week grid where the score
 * is already visible elsewhere in the row.
 *
 * Returns `{text, schoolId}` or null. Callers that need just the
 * sentence string can read `.text`.
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
  const text = formatStatLine(headline, prior, sportConfig);
  if (!text) return null;
  return { text, schoolId: perspective };
}

/**
 * One-sentence summary of how the game went, written in the voice of
 * a sports column ("Edgar outlasted Mondovi 21-14"). Verb pool is
 * selected from a deterministic hash of the game id so the same game
 * reads the same on every refresh but neighboring games rotate.
 *
 * Returns a string ready to render, or null when the game isn't final
 * or the score is missing.
 */
export function gameSummaryLine(game, { sportConfig = null } = {}) {
  if (!game || game.status !== "final") return null;
  const homeScore = game.home?.score;
  const awayScore = game.away?.score;
  if (homeScore == null || awayScore == null) return null;
  const winner = homeScore > awayScore ? game.home : awayScore > homeScore ? game.away : null;
  const loser = winner === game.home ? game.away : winner === game.away ? game.home : null;
  const winScore = Math.max(homeScore, awayScore);
  const lossScore = Math.min(homeScore, awayScore);
  const seed = _seed(game.id ?? `${winner?.name}-${loser?.name}`);

  // Tied — rare in our sports, but the schema allows it.
  if (!winner) {
    return `${game.home.name} and ${game.away.name} tied ${homeScore}-${awayScore}.`;
  }

  const margin = winScore - lossScore;
  // Margin "scale" depends on the sport — a 5-set diff means nothing
  // in football but a 3-set sweep is decisive in volleyball.
  const scoreLabel = sportConfig?.scoreLabel; // "set" for volleyball
  const isSetSport = scoreLabel === "set";

  let verb;
  if (isSetSport) {
    if (margin >= 3 || lossScore === 0) {
      verb = _pick(seed, ["swept", "rolled past", "dispatched", "ran past"]);
    } else if (margin === 2) {
      verb = _pick(seed, ["dispatched", "took down", "topped"]);
    } else {
      verb = _pick(seed, ["edged", "outlasted", "held off", "survived"]);
    }
  } else {
    // Football/basketball/hockey — margin in points/goals.
    const blowout = sportConfig?.id === "football"
      ? margin >= 28
      : sportConfig?.id?.includes("basketball")
        ? margin >= 25
        : margin >= 5; // hockey
    const close = sportConfig?.id === "football"
      ? margin <= 7
      : sportConfig?.id?.includes("basketball")
        ? margin <= 6
        : margin <= 1;
    if (blowout) {
      verb = _pick(seed, ["rolled past", "buried", "ran past", "blew out", "throttled"]);
    } else if (close) {
      verb = _pick(seed, ["edged", "outlasted", "held off", "survived", "squeaked past"]);
    } else {
      verb = _pick(seed, ["defeated", "beat", "took down", "topped", "downed"]);
    }
  }

  return `${winner.name} ${verb} ${loser.name} ${winScore}-${lossScore}.`;
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

// Tiny deterministic 0..1 hash — same key always picks the same
// variant so a refresh doesn't shuffle the recap text under the user.
function _seed(s) {
  let h = 2166136261;
  for (let i = 0; i < (s ?? "").length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h / 0xffffffff;
}
function _pick(seed, choices) {
  return choices[Math.floor(seed * choices.length) % choices.length];
}

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

  const seed = _seed(game.id ?? `${dateLabel}-${oppLabel}`);
  const score = `${own}-${opp}`;
  const lossScore = `${opp}-${own}`;

  // 1. State champion — top priority. The Tigers brought home the title.
  if (isStateTitle) {
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      return _pick(seed, [
        `${subject} captured the state title with a ${score} win over ${oppLabel} on ${dateLabel}.`,
        `${subject} ran away with the state title, ${score} over ${oppLabel} on ${dateLabel}.`,
        `${subject} lifted the state title trophy after handling ${oppLabel} ${score} on ${dateLabel}.`,
        `${subject} cruised to the state title, beating ${oppLabel} ${score} on ${dateLabel}.`,
      ]);
    }
    if (Math.abs(margin) <= CLOSE_MARGIN) {
      return _pick(seed, [
        `${subject} survived ${oppLabel} ${score} on ${dateLabel} to claim the state title.`,
        `${subject} outlasted ${oppLabel} ${score} on ${dateLabel} to win the state title.`,
        `${subject} edged ${oppLabel} ${score} on ${dateLabel} for the state title.`,
        `${subject} held off ${oppLabel} ${score} on ${dateLabel} to lift the state title.`,
        `${subject} won the state title in a thriller, ${score} over ${oppLabel} on ${dateLabel}.`,
      ]);
    }
    return _pick(seed, [
      `${subject} beat ${oppLabel} ${score} on ${dateLabel} to claim the state title.`,
      `${subject} took down ${oppLabel} ${score} on ${dateLabel} for the state title.`,
      `${subject} captured the state title with a ${score} win over ${oppLabel} on ${dateLabel}.`,
    ]);
  }

  // 2. Playoff exit — season ends.
  if (isPlayoffExit) {
    const roundLabel = playoffRoundLabel(game);
    if (Math.abs(margin) <= CLOSE_MARGIN) {
      return _pick(seed, [
        `${subject}' season ended in heartbreak — a ${lossScore} ${roundLabel} loss to ${oppLabel} on ${dateLabel}.`,
        `${subject}' run ended with a gut-punch ${lossScore} loss to ${oppLabel} in the ${roundLabel} on ${dateLabel}.`,
        `${subject} came up just short, falling ${lossScore} to ${oppLabel} in the ${roundLabel} on ${dateLabel}.`,
        `${subject}' season closed with a ${lossScore} ${roundLabel} loss to ${oppLabel} on ${dateLabel}, decided by the final possession.`,
      ]);
    }
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      return _pick(seed, [
        `${subject}' season ended with a ${lossScore} ${roundLabel} loss to ${oppLabel} on ${dateLabel}.`,
        `${subject}' run came to an end at the hands of ${oppLabel}, ${lossScore} in the ${roundLabel} on ${dateLabel}.`,
        `${subject} bowed out of the postseason with a ${lossScore} loss to ${oppLabel} in the ${roundLabel} on ${dateLabel}.`,
      ]);
    }
    return _pick(seed, [
      `${subject}' season came to a close with a ${lossScore} loss to ${oppLabel} in the ${roundLabel} on ${dateLabel}.`,
      `${subject}' postseason ended in the ${roundLabel} on ${dateLabel}, ${lossScore} to ${oppLabel}.`,
      `${subject} fell to ${oppLabel} ${lossScore} in the ${roundLabel} on ${dateLabel}, ending the season.`,
    ]);
  }

  // 3. Last regular-season game — sets up the playoff or ends the year.
  if (isLastReg) {
    if (won) {
      if (Math.abs(margin) >= BLOWOUT_MARGIN) {
        return _pick(seed, [
          `${subject} closed out the regular season strong with a ${score} drubbing of ${oppLabel} on ${dateLabel}.`,
          `${subject} put a bow on the regular season by routing ${oppLabel} ${score} on ${dateLabel}.`,
          `${subject} wrapped the regular season with a ${score} blowout of ${oppLabel} on ${dateLabel}.`,
          `${subject} ended the regular season on a high note, blasting ${oppLabel} ${score} on ${dateLabel}.`,
        ]);
      }
      if (Math.abs(margin) <= CLOSE_MARGIN) {
        return _pick(seed, [
          `${subject} edged ${oppLabel} ${score} on ${dateLabel} to cap the regular season.`,
          `${subject} held off ${oppLabel} ${score} on ${dateLabel} to close the regular season.`,
          `${subject} squeaked past ${oppLabel} ${score} in the regular-season finale on ${dateLabel}.`,
        ]);
      }
      return _pick(seed, [
        `${subject} closed the regular season with a ${score} win over ${oppLabel} on ${dateLabel}.`,
        `${subject} finished the regular season by beating ${oppLabel} ${score} on ${dateLabel}.`,
        `${subject} capped the regular season with a ${score} win over ${oppLabel} on ${dateLabel}.`,
      ]);
    }
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      return _pick(seed, [
        `${subject} stumbled into the postseason with a ${lossScore} loss to ${oppLabel} on ${dateLabel}.`,
        `${subject} limped to the playoffs after a ${lossScore} loss to ${oppLabel} on ${dateLabel}.`,
        `${subject} closed the regular season on a sour note, falling ${lossScore} to ${oppLabel} on ${dateLabel}.`,
      ]);
    }
    return _pick(seed, [
      `${subject} closed the regular season with a ${lossScore} loss to ${oppLabel} on ${dateLabel}.`,
      `${subject} finished the regular season with a ${lossScore} setback to ${oppLabel} on ${dateLabel}.`,
      `${subject} dropped the regular-season finale to ${oppLabel} ${lossScore} on ${dateLabel}.`,
    ]);
  }

  // 4. Playoff advancement (won, not the state title) — adds drive.
  if (isPlayoffAdvance) {
    const roundLabel = playoffRoundLabel(game);
    // Wins in a "Final" round (Regional Final, Sectional Final, etc.)
    // ARE wins for that round's title — frame as winning a championship,
    // not just advancing.
    const titleName = roundTitleName(game);
    if (titleName) {
      if (Math.abs(margin) >= BLOWOUT_MARGIN) {
        return _pick(seed, [
          `${subject} won the ${titleName} with a ${score} rout of ${oppLabel} on ${dateLabel}.`,
          `${subject} captured the ${titleName}, running away from ${oppLabel} ${score} on ${dateLabel}.`,
          `${subject} took the ${titleName} with a dominant ${score} win over ${oppLabel} on ${dateLabel}.`,
        ]);
      }
      if (Math.abs(margin) <= CLOSE_MARGIN) {
        return _pick(seed, [
          `${subject} captured the ${titleName} with a ${score} thriller over ${oppLabel} on ${dateLabel}.`,
          `${subject} won the ${titleName} in a nail-biter, ${score} over ${oppLabel} on ${dateLabel}.`,
          `${subject} edged ${oppLabel} ${score} on ${dateLabel} to claim the ${titleName}.`,
          `${subject} held off ${oppLabel} ${score} on ${dateLabel} for the ${titleName}.`,
          `${subject} outlasted ${oppLabel} ${score} on ${dateLabel} to take the ${titleName}.`,
        ]);
      }
      return _pick(seed, [
        `${subject} won the ${titleName} with a ${score} win over ${oppLabel} on ${dateLabel}.`,
        `${subject} captured the ${titleName}, beating ${oppLabel} ${score} on ${dateLabel}.`,
        `${subject} took home the ${titleName} after a ${score} win over ${oppLabel} on ${dateLabel}.`,
      ]);
    }

    // Non-final rounds (Regional, Sectional Semifinal, Level 1-3, etc.)
    // — just advancement.
    if (Math.abs(margin) >= BLOWOUT_MARGIN) {
      return _pick(seed, [
        `${subject} rolled past ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
        `${subject} steamrolled ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
        `${subject} ran away from ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
        `${subject} blew past ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
        `${subject} buried ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
      ]);
    }
    if (Math.abs(margin) <= CLOSE_MARGIN) {
      return _pick(seed, [
        `${subject} survived ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel} to advance.`,
        `${subject} held off ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel} to advance.`,
        `${subject} outlasted ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
        `${subject} escaped ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel} to advance.`,
        `${subject} got past ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
        `${subject} edged ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel} to keep the season alive.`,
      ]);
    }
    return _pick(seed, [
      `${subject} beat ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel} to advance.`,
      `${subject} took down ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
      `${subject} knocked off ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel} to move on.`,
      `${subject} ousted ${oppLabel} ${score} in the ${roundLabel} on ${dateLabel}.`,
    ]);
  }

  return null;
}

/**
 * For wins in a "Final" round (Regional Final, Sectional Final, etc.),
 * return the championship label they just won ("Regional title",
 * "Sectional title"). null for non-final rounds + for State Final /
 * Level 4 which are handled by the isStateTitle branch.
 */
function roundTitleName(game) {
  const r = (game.playoff_round || "").trim();
  if (STATE_TITLE_ROUNDS.has(r)) return null;
  // "Regional Final" → "Regional title". Same shape: "Sectional Final" →
  // "Sectional title". Only matches when the round name ends in "Final".
  const m = /^(.*?)\s+Final$/.exec(r);
  if (!m) return null;
  const stage = m[1];
  if (!stage) return null;
  return `${stage} title`;
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
