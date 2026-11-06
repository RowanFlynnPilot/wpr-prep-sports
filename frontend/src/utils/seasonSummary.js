/**
 * Build a 1–2 sentence "Season Summary" lede for a team page.
 *
 * Same news-org rule as the per-game recap (utils/recap.js): every claim
 * has to be backed by data we scraped. No invented stats, no embellishment.
 *
 * Auto-detects mid-season vs end-of-season:
 *   - mid-season while any game is still to be played (upcoming, live, or
 *     score pending), or while the team is alive in the playoffs — then
 *     the playoff run leads and the record counts playoff games
 *   - end-of-season once nothing is left to play
 *
 * Returns null when we have nothing scoreable to summarize (no finals
 * yet, or no parseable scores).
 */

import { isForfeitScore, isStaleScheduled } from "./games.js";
import { teamPostseason, isTbdSide, isTitleRound } from "./postseason.js";
import { buildTeamJourneys, resolveShootout } from "./bracket.js";
import { localDate } from "./dates.js";

const DAY_MS = 86_400_000;

/** A game that still counts as ahead of the team: upcoming, live, or played with the score pending. */
function stillToPlay(g, now) {
  return g.status !== "final" && !isStaleScheduled(g, now);
}

/** "a 55-0" / "an 8-0" / "an 11-7": the article follows the spoken number. */
function aScore(own) {
  return /^(8|11$|18$|11\d\d$|18\d\d$)/.test(String(own)) ? "an" : "a";
}

/**
 * Where one team's season stands, for the team page's banner and the
 * summary's lead. Pure: pass `now` to pin it.
 *
 *   { kind: "alive", round, game, isHome, opponent|null (TBD), live }
 *   { kind: "alive-tba", lastEntry }   won its last round, next one not scheduled yet
 *   { kind: "champion", lastEntry }    won a state title round
 *   { kind: "eliminated", lastEntry }  lost its last playoff game
 *   { kind: "complete" }               regular season done, no playoff games
 *   null                               still in the regular season (or nothing played)
 *
 * The postseason helper's window closes a week after the sport's last
 * final, so outside it the team's own bracket journey stands in; an
 * eliminated team keeps its banner after the state finals are a week old.
 */
export function seasonState({
  teamGames,
  allGames,
  schoolId,
  schoolsById,
  sportConfig,
  now = Date.now(),
}) {
  if (!schoolId || !teamGames || teamGames.length === 0) return null;
  const finals = teamGames.filter((g) => g.status === "final");
  if (finals.length === 0) return null;
  const end = sportConfig?.seasonEnd ? localDate(sportConfig.seasonEnd) : null;
  const seasonEnded = !!end && now >= end.getTime();

  let entry = teamPostseason(allGames ?? teamGames, schoolId, schoolsById, now);
  if (!entry && teamGames.some((g) => g.playoff)) {
    const j = buildTeamJourneys(teamGames, schoolsById).find((x) => x.schoolId === schoolId);
    if (j) {
      const next = j.games.find((e) => e.game.status !== "final") ?? null;
      const last = j.games[j.games.length - 1] ?? null;
      // Same rule as postseasonState: a final win in a title round is a
      // championship, not "alive" and not an elimination.
      const champion = !!last && last.isFinal && last.won && isTitleRound(last.round);
      entry = {
        alive: j.alive && !champion,
        champion,
        nextGame: next?.game ?? null,
        nextRound: next?.round ?? null,
        nextIsHome: next ? next.isHome : null,
        nextOpponent: next?.opponent ?? null,
        lastEntry: last,
      };
    }
  }

  if (entry) {
    // Champions come first: the helper marks them alive: false, so the
    // elimination check alone called a state title "Season over".
    if (entry.champion) return { kind: "champion", lastEntry: entry.lastEntry };
    if (!entry.alive) return { kind: "eliminated", lastEntry: entry.lastEntry };
    if (entry.nextGame) {
      return {
        kind: "alive",
        round: entry.nextRound,
        game: entry.nextGame,
        isHome: entry.nextIsHome,
        opponent: isTbdSide(entry.nextOpponent) ? null : entry.nextOpponent,
        live: entry.nextGame.status === "in_progress",
      };
    }
    if (isTitleRound(entry.lastEntry?.round) && entry.lastEntry?.won) {
      return { kind: "champion", lastEntry: entry.lastEntry };
    }
    // Won its last round with nothing scheduled: alive until the sport's
    // season is over; after that it's a data gap, not a title.
    if (!seasonEnded) return { kind: "alive-tba", lastEntry: entry.lastEntry };
    return { kind: "complete" };
  }

  // No playoff games: the season is over once the last game on the
  // schedule is final, nothing is left to play, and either the sport has
  // wrapped or that last game is more than a week old.
  if (teamGames[teamGames.length - 1].status !== "final") return null;
  if (teamGames.some((g) => stillToPlay(g, now))) return null;
  const lastFinalMs = Math.max(...finals.map((g) => new Date(g.date).getTime()));
  if (seasonEnded || now - lastFinalMs > 7 * DAY_MS) return { kind: "complete" };
  return null;
}

/**
 * Walk a list of finals chronologically and compute W-L-T plus the last
 * game. The record is the official one (a playoff game decided on penalty
 * kicks is a tie in WIAA's books); `pkWins` / `pkLosses` count those
 * shootouts separately, and `last.won` / `last.shootout` follow the
 * bracket so the prose never says a team "fell" in a game it advanced
 * from. `playoffs` is the sport's playoff list used to resolve shootouts.
 */
function arcFromFinals(finals, schoolId, playoffs = finals) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pkWins = 0;
  let pkLosses = 0;
  let last = null;
  for (const g of finals) {
    const isHome = g.home.school_id === schoolId;
    const own = isHome ? g.home.score : g.away.score;
    const opp = isHome ? g.away.score : g.home.score;
    if (own == null || opp == null) continue;
    const shootout = own === opp ? resolveShootout(g, isHome, playoffs) : null;
    if (own > opp) wins++;
    else if (own < opp) losses++;
    else ties++;
    if (shootout && !shootout.undecided) {
      if (shootout.won) pkWins++;
      else pkLosses++;
    }
    last = { game: g, isHome, own, opp, won: shootout ? shootout.won : own > opp, shootout };
  }
  return { wins, losses, ties, pkWins, pkLosses, last };
}

/**
 * How a tied playoff game ended, for prose: "advanced on penalty kicks
 * after a 4-4 draw with De Pere" / "lost a penalty-kick shootout to De
 * Pere after a 4-4 draw" / "played De Pere to a 4-4 draw, with the
 * shootout result still to come". Never "beat" or "fell to" for a tie.
 */
function shootoutPhrase(last, oppName) {
  const draw = `${aScore(last.own)} ${last.own}-${last.opp} draw`;
  if (last.shootout.undecided) {
    return `played ${oppName} to ${draw}, with the shootout result still to come`;
  }
  return last.won
    ? `advanced on penalty kicks after ${draw} with ${oppName}`
    : `lost a penalty-kick shootout to ${oppName} after ${draw}`;
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

/**
 * Adjective describing the overall arc, given the W-L-T and season state.
 * Exported for tests.
 */
export function arcTone(wins, losses, seasonComplete, ties = 0) {
  const played = wins + losses + ties;
  if (played === 0) return seasonComplete ? "quiet" : "early";
  // A 3-0-2 soccer side is unbeaten, not "perfect" — draws break perfection.
  if (losses === 0 && ties > 0) return "unbeaten";
  if (losses === 0) return seasonComplete ? "undefeated" : "perfect";
  if (wins === 0) return seasonComplete ? "winless" : "rough";
  if (wins > losses && wins - losses >= 3) return seasonComplete ? "strong" : "strong";
  if (wins > losses) return seasonComplete ? "winning" : "promising";
  if (wins === losses) return "up-and-down";
  if (losses - wins >= 3) return seasonComplete ? "tough" : "rough";
  return "up-and-down";
}

const SMALL_NUMBERS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
];

/** Newspaper style: spell out one through nine, digits from 10 up. */
function numberWord(n) {
  return SMALL_NUMBERS[n] ?? String(n);
}

/** "8-1", or "4-0-2" once a draw is on the books. */
function recordString(wins, losses, ties = 0) {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/**
 * Phrase that introduces the season arc. Varies by mid- vs end-of-season
 * and, mid-season, by how deep into the season the team is — "rolled to
 * a strong start" was still printing for an 8-1 team in week 9 and a
 * 23-7 volleyball side. Three mid-season stages, by games played:
 *
 *   1–3   "start" wording       — stayed perfect / is off to a 2-1 start
 *   4–6   neutral through-N     — has won five of six games / is 4-2 through six games
 *   7+    season wording        — is having a strong season at 8-1
 *
 * Returns { phrase, statesRecord }. When the phrase already carries the
 * record, the caller's last-game clause must not repeat it ("...at 8-1
 * with a 28-7 win, improving to 8-1"). Exported for tests.
 */
export function arcPhrase(tone, seasonComplete, played, wins = 0, losses = 0, ties = 0) {
  const say = (phrase, statesRecord = false) => ({ phrase, statesRecord });
  if (seasonComplete) {
    const article = startsWithVowelSound(tone) ? "an" : "a";
    return say(`finished ${article} ${tone} season`);
  }
  // Mid-season — only one game played reads weirdly with "continues"
  if (played <= 1) {
    if (tone === "perfect") return say("opened the season with a win");
    if (tone === "rough") return say("opened the season with a loss");
    return say("opened the season");
  }

  const rec = recordString(wins, losses, ties);
  const n = numberWord(played);
  const games = `${n} games`;

  // Stage 1 — the first three games are still a "start".
  if (played <= 3) {
    if (tone === "perfect") return say("stayed perfect");
    if (tone === "unbeaten") return say(`is unbeaten through ${games}`);
    if (tone === "rough") return say("continues a rough start to the season");
    if (tone === "winless") return say("is still searching for its first win");
    if (tone === "strong") return say("rolled to a strong start");
    if (tone === "winning" || tone === "promising") return say(`is off to a ${rec} start`, true);
    if (tone === "up-and-down") return say(`is ${rec} to start the season`, true);
    return say("extended a mixed start to the season");
  }

  // Stage 2 — four to six games: neutral, record-through-N wording.
  if (played <= 6) {
    if (tone === "perfect") return say(`is a perfect ${rec} through ${games}`, true);
    if (tone === "unbeaten") return say(`is unbeaten at ${rec} through ${games}`, true);
    if (tone === "strong") return say(`has won ${numberWord(wins)} of ${games}`, true);
    if (wins === 0) return say(`is still looking for a first win through ${games}`);
    return say(`is ${rec} through ${games}`, true);
  }

  // Stage 3 — seven or more: this is a season now, not a start.
  if (tone === "perfect") return say(`is still perfect at ${rec}`, true);
  if (tone === "unbeaten") return say(`is still unbeaten at ${rec}`, true);
  if (wins === 0) return say("is still searching for a first win");
  if (tone === "rough" || tone === "tough") return say(`is having a tough season at ${rec}`, true);
  if (tone === "strong") return say(`is having a strong season at ${rec}`, true);
  if (tone === "winning" || tone === "promising") {
    return say(`has kept a winning record at ${rec}`, true);
  }
  return say(`is ${rec} on the season`, true);
}

function startsWithVowelSound(word) {
  return /^[aeiou]/i.test(word);
}

/** Sentence describing the most-recent regular-season game. */
function lastGameClause({ last, oppName, seasonComplete, wins, losses, ties = 0, recordStated = false }) {
  if (!last) return "";
  const { own, opp } = last;
  const tied = own === opp;
  const won = own > opp;
  // WIAA's 1-0 / 2-0 forfeit codes aren't scores; the game page already
  // says "forfeit", and the summary said "a 2-0 win" under it.
  const forfeit = isForfeitScore(last.game);
  // A tied playoff game was a penalty-kick shootout; say which way it went.
  const pk = tied && last.shootout;
  const result = forfeit
    ? won
      ? `a forfeit win over ${oppName}`
      : `a forfeit loss to ${oppName}`
    : pk
      ? last.shootout.undecided
        ? `${aScore(own)} ${own}-${opp} draw against ${oppName}, shootout result pending`
        : last.won
          ? `a penalty-kick win over ${oppName} after ${aScore(own)} ${own}-${opp} draw`
          : `a penalty-kick shootout loss to ${oppName} after ${aScore(own)} ${own}-${opp} draw`
      : tied
        ? `${aScore(own)} ${own}-${opp} draw against ${oppName}`
        : won
          ? `${aScore(own)} ${own}-${opp} win over ${oppName}`
          : `${aScore(opp)} ${opp}-${own} loss to ${oppName}`; // winner's score first

  // Mid-season — anchor the running record because the hero record is "now"
  // and the recap is naturally about trajectory. When the arc phrase has
  // already stated the record ("is having a strong season at 8-1"), hang
  // the last game off it with "after" instead of restating the record.
  if (!seasonComplete) {
    if (recordStated) return `after ${result}`;
    if (tied) return `with ${result} (${recordString(wins, losses, ties)})`;
    return `with ${result}, ${won ? "improving" : "falling"} to ${wins}-${losses}`;
  }

  // End-of-season — the hero shows the final record, so don't restate it.
  return `with ${result}`;
}

/**
 * Sentence describing the team's playoff run (end-of-season only).
 * - 0 playoff games → null
 * - 1 game, lost   → "before falling to X in the WIAA Level 1 playoffs"
 * - >=2 games, all wins → "and ran the table in the WIAA playoffs, ..."
 * - >=2 games, last lost → "before winning N playoff games and falling to X in the {round}"
 */
function playoffClause({ playoffGames, schoolId, schoolsById, playoffs = playoffGames }) {
  if (!playoffGames || playoffGames.length === 0) return null;

  const { wins, losses, ties, pkWins, pkLosses, last } = arcFromFinals(
    playoffGames,
    schoolId,
    playoffs,
  );
  if (!last) return null;

  const lastGame = last.game;
  const oppSide = last.isHome ? lastGame.away : lastGame.home;
  const oppName =
    schoolsById?.get(oppSide?.school_id)?.name ?? oppSide?.name ?? "their opponent";

  const lastRound = lastGame.playoff_round || "playoffs";
  const lastWon = last.won;
  const roundPhrase = roundDisplay(lastRound);
  // Games the team came through, shootouts included; the record itself
  // still counts a shootout as the tie WIAA records.
  const advanced = wins + pkWins;
  const unbeaten = losses === 0 && pkLosses === 0;
  const pk = last.shootout;

  // Champions: never beaten in the playoffs AND won the title round.
  if (unbeaten && lastWon && isTitleRound(lastRound)) {
    return pk
      ? `and captured the WIAA state championship on penalty kicks after ${aScore(last.own)} ${last.own}-${last.opp} draw with ${oppName}`
      : `and captured the WIAA state championship with ${aScore(last.own)} ${last.own}-${last.opp} win over ${oppName}`;
  }

  // Unbeaten in playoffs but didn't reach championship (data gap / state run still in progress).
  if (unbeaten && advanced > 0) {
    const n = wins + ties;
    const games = `${numberWord(n)} WIAA playoff game${n === 1 ? "" : "s"}`;
    if (pk) {
      return `and ran through ${games} unbeaten, last ${pk.undecided ? `playing ${oppName} to ${aScore(last.own)} ${last.own}-${last.opp} draw in ${roundPhrase}, with the shootout result still to come` : `advancing past ${oppName} on penalty kicks after ${aScore(last.own)} ${last.own}-${last.opp} draw in ${roundPhrase}`}`;
    }
    return `and ran through ${games} unbeaten, last beating ${oppName} ${last.own}-${last.opp} in ${roundPhrase}`;
  }

  // Played at least one playoff game and lost the last one.
  if (!lastWon) {
    const exit = pk
      ? `${shootoutPhrase(last, oppName)} in ${roundPhrase}`
      : `falling to ${oppName} ${last.opp}-${last.own} in ${roundPhrase}`;
    if (pk?.undecided) return `and ${exit}`;
    if (advanced === 0) return `before ${exit}`;
    return `before winning ${numberWord(advanced)} WIAA playoff game${advanced === 1 ? "" : "s"} and ${exit}`;
  }

  // Last playoff game was a win but earlier ones weren't — uncommon, but
  // describe truthfully.
  const lastResult = pk
    ? `last advancing past ${oppName} on penalty kicks after ${aScore(last.own)} ${last.own}-${last.opp} draw in ${lastRound}`
    : `last beating ${oppName} ${last.own}-${last.opp} in ${lastRound}`;
  return `and went ${recordString(wins, losses, ties)} in the WIAA playoffs, ${lastResult}`;
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
 * Lead sentence for a team still alive in the playoffs, or null to fall
 * back to the running-arc wording:
 *   "Gilman is 12-0 and still alive after a 55-0 Level 3 win over Athens."
 *   "Athens is 7-2 heading into the Level 1 playoffs after a 28-7 win over Colby."
 */
function aliveOpener({ finals, playoffFinals, schoolId, schoolName, nameOf, state, playoffs }) {
  const all = arcFromFinals(finals, schoolId, playoffs);
  if (!all.last) return null;
  const rec = recordString(all.wins, all.losses, all.ties);
  const lastPlayoff = arcFromFinals(playoffFinals, schoolId, playoffs).last;
  if (lastPlayoff?.shootout) {
    // Decided on penalty kicks (or not yet): the score alone says "draw".
    const g = lastPlayoff.game;
    const opp = nameOf(lastPlayoff.isHome ? g.away : g.home);
    const round = g.playoff_round && g.playoff_round !== "Playoff" ? g.playoff_round : "playoff";
    const draw = `${aScore(lastPlayoff.own)} ${lastPlayoff.own}-${lastPlayoff.opp} ${round} draw with ${opp}`;
    if (lastPlayoff.shootout.undecided) {
      return `${schoolName} is ${rec} and still alive after ${draw}, with the penalty-kick result still to come.`;
    }
    if (lastPlayoff.won) {
      return `${schoolName} is ${rec} and still alive, advancing on penalty kicks after ${draw}.`;
    }
  }
  if (lastPlayoff && lastPlayoff.won) {
    const g = lastPlayoff.game;
    const opp = nameOf(lastPlayoff.isHome ? g.away : g.home);
    const round = g.playoff_round && g.playoff_round !== "Playoff" ? g.playoff_round : "playoff";
    const win = isForfeitScore(g)
      ? `a ${round} forfeit win over ${opp}`
      : `${aScore(lastPlayoff.own)} ${lastPlayoff.own}-${lastPlayoff.opp} ${round} win over ${opp}`;
    return `${schoolName} is ${rec} and still alive after ${win}.`;
  }
  if (!lastPlayoff && state.kind === "alive") {
    const l = all.last;
    const tail = lastGameClause({
      last: l,
      oppName: nameOf(l.isHome ? l.game.away : l.game.home),
      seasonComplete: false,
      wins: all.wins,
      losses: all.losses,
      ties: all.ties,
      recordStated: true,
    });
    return `${schoolName} is ${rec} heading into ${roundDisplay(state.round)} ${tail}.`;
  }
  return null;
}

/**
 * Build the full season summary string for one team, or null.
 *
 * `allGames` (the sport's full list) lets a tied playoff game be read as
 * the penalty-kick shootout it was — whichever side plays on advanced.
 * Without it only the team's own advancement can be seen.
 */
export function seasonSummary({
  teamGames,
  allGames = null,
  schoolId,
  school,
  schoolsById,
  seasonStatsForSchool,
  sportConfig,
}) {
  if (!teamGames || teamGames.length === 0) return null;

  const finals = teamGames.filter((g) => g.status === "final");
  if (finals.length === 0) return null;
  const playoffs = (allGames ?? teamGames).filter((g) => g.playoff);

  // The season is "complete" when no games remain to be played. We can't
  // require `finals.length === teamGames.length` because WIAA sometimes
  // leaves cancelled/postponed games on the schedule with
  // status="scheduled" forever, which would otherwise pin the prose into
  // mid-season tone months after the actual season ended. A game played
  // with its score still pending counts as still to play.
  const now = Date.now();
  const state = seasonState({ teamGames, allGames, schoolId, schoolsById, sportConfig, now });
  const playoffAlive = state?.kind === "alive" || state?.kind === "alive-tba";
  const seasonComplete = !playoffAlive && !teamGames.some((g) => stillToPlay(g, now));
  const { regular: regularFinals, playoff: playoffFinals } = splitByPhase(finals);
  const schoolName = school?.name ?? "The team";
  const nameOf = (side) =>
    (side?.school_id ? schoolsById?.get(side.school_id)?.name : null) ?? side?.name ?? "opponent";

  // Still alive in the playoffs: the record counts every final, playoffs
  // included, and the playoff run leads. "Still perfect at 9-0 after a
  // 40-0 win over Shell Lake" was printing for a 12-0 Gilman three
  // playoff wins later.
  if (playoffAlive) {
    const opener = aliveOpener({
      finals,
      playoffFinals,
      schoolId,
      schoolName,
      nameOf,
      state,
      playoffs,
    });
    if (opener) {
      const all = arcFromFinals(finals, schoolId, playoffs);
      const played = all.wins + all.losses + all.ties;
      const standout = pickStandout(seasonStatsForSchool ?? [], sportConfig, false, played);
      const player = standoutClause(standout, sportConfig, false);
      return player ? `${opener} ${player}` : opener;
    }
  }

  // Once the season is over, tone is driven by the regular-season arc —
  // that's how a coach or beat writer would describe a 5-4 team that lost
  // in Level 1. Mid-season the record is the running one, every final.
  // Fall back to all finals if no regular-season games are present.
  const arcSource = seasonComplete && regularFinals.length > 0 ? regularFinals : finals;
  const { wins, losses, ties, last } = arcFromFinals(arcSource, schoolId, playoffs);
  if (!last) return null;

  const oppName = nameOf(last.isHome ? last.game.away : last.game.home);
  const played = wins + losses + ties;
  const tone = arcTone(wins, losses, seasonComplete, ties);
  const { phrase: arc, statesRecord } = arcPhrase(
    tone,
    seasonComplete,
    played,
    wins,
    losses,
    ties,
  );
  const tail = lastGameClause({
    last,
    oppName,
    seasonComplete,
    wins,
    losses,
    ties,
    recordStated: statesRecord,
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
      playoffs,
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
