import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import { schoolFor } from "../utils/schools.js";
import { groupByDay, splitPlayoffRounds } from "../utils/weeks.js";
import { formatGameDay, formatGameDate, formatGameTime } from "../utils/dates.js";
import { gameSummaryLine, playerLineForGame } from "../utils/recap.js";
import {
  humanizeVenue,
  isForfeitScore,
  isScorePending,
  isStaleScheduled,
  isUnderway,
  isUnreportedFinal,
} from "../utils/games.js";
import { useSportPrefix } from "../utils/links.js";
import { SITE } from "../config/site.js";
import { isNeutralSite, isTbdSide, roundLabel } from "../utils/postseason.js";

const OTHER_GROUP = "Other games";

// Row chip for a playoff round: short enough to sit beside the kickoff
// time on a 375px row. The full round name is in the group heading and
// in the drill-in link's accessible name, so the chip is aria-hidden.
// Keyed by the reader-facing name (utils/postseason.js roundLabel), so
// football's Level 4 — a state semifinal — is chipped as one.
const ROUND_CHIP = {
  Regional: "Regional",
  "Regional Semifinal": "Reg. Semi",
  "Regional Final": "Reg. Final",
  Sectional: "Sectional",
  "Sectional Semifinal": "Sect. Semi",
  "Sectional Final": "Sect. Final",
  "State Quarterfinal": "State QF",
  "State Semifinal": "State Semi",
  "State semifinal (Level 4)": "State Semi (L4)",
  "State Final": "State Final",
  "State Championship": "State Final",
};

function roundChip(round, sport) {
  if (!round) return "Playoff";
  const label = roundLabel(round, sport);
  if (ROUND_CHIP[label]) return ROUND_CHIP[label];
  const level = /^level\s*(\d+)$/i.exec(label);
  if (level) return `L${level[1]}`;
  return label;
}

function conferenceOf(school, sport) {
  return school?.conferences?.find?.((c) => c.sport === sport)?.conference ?? null;
}

/**
 * The conference a game files under. Conference games have one answer;
 * crossovers file under the home-region side (that's whose readers are
 * looking), else the home team's conference; a tracked team against an
 * untracked opponent files under the tracked team's conference.
 */
function gameConference(game, schoolIndex, sport, homeRegionIds) {
  const homeConf = conferenceOf(schoolIndex?.get?.(game.home.school_id), sport);
  const awayConf = conferenceOf(schoolIndex?.get?.(game.away.school_id), sport);
  if (homeConf && awayConf && homeConf !== awayConf && homeRegionIds) {
    if (homeRegionIds.has(game.home.school_id) && !homeRegionIds.has(game.away.school_id)) {
      return homeConf;
    }
    if (homeRegionIds.has(game.away.school_id) && !homeRegionIds.has(game.home.school_id)) {
      return awayConf;
    }
  }
  return homeConf ?? awayConf ?? OTHER_GROUP;
}

/**
 * A day-by-day schedule for the featured week, with each day's games
 * grouped by conference — home-region conferences first, the rest
 * collapsed behind one "show more" control. A 35-game Friday used to be
 * one undivided list in schedule-file order; a Wausau reader scrolled
 * past twenty rows of other people's games to find their own.
 *
 * Playoff games group by round instead ("Level 3 · 4 games"), in bracket
 * order, ahead of any regular-season conference groups that day and
 * never behind the "show more" fold (utils/weeks.js splitPlayoffRounds).
 */
export default function ThisWeekGrid({
  week,
  schoolIndex,
  allGames = [],
  sportConfig = null,
  homeRegionIds = null,
}) {
  // Days whose non-home conferences the reader expanded.
  const [expandedDays, setExpandedDays] = useState(() => new Set());

  const sport = week?.games?.[0]?.sport ?? sportConfig?.id ?? null;

  // Home-region weight per conference, from SITE.homeRegionCities — which
  // is ordered by proximity (Wausau metro first). A conference ranks by
  // its NEAREST home-region school, member count as tiebreak, so the
  // Wausau schools' conference leads and no list is hardcoded here.
  // Weight 0 = no home-region school = starts collapsed.
  const confWeight = useMemo(() => {
    const weight = new Map();
    if (!homeRegionIds || !schoolIndex?.get) return weight;
    const cities = SITE.homeRegionCities ?? [];
    const best = new Map(); // conference -> { rank, count }
    for (const id of homeRegionIds) {
      const school = schoolIndex.get(id);
      const conf = conferenceOf(school, sport);
      if (!conf) continue;
      let rank = cities.indexOf(school?.city);
      if (rank < 0) rank = cities.length; // in-region by other means: last tier
      const cur = best.get(conf);
      best.set(conf, {
        rank: cur ? Math.min(cur.rank, rank) : rank,
        count: (cur?.count ?? 0) + 1,
      });
    }
    for (const [conf, { rank, count }] of best) {
      weight.set(conf, (cities.length + 1 - rank) * 1000 + count);
    }
    return weight;
  }, [homeRegionIds, schoolIndex, sport]);

  // Hooks above; the empty-week return below (a live refresh can shrink
  // the week on a mounted instance — see StandingsTable).
  if (!week || week.games.length === 0) {
    return (
      <div className="week week--empty">
        <p>No games this week.</p>
      </div>
    );
  }

  const days = groupByDay(week.games);
  const grouping = confWeight.size > 0;

  const toggleDay = (day) =>
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  return (
    <div className="week">
      {days.map(([day, games]) => {
        // Playoff games by round, bracket order; they always show.
        const { rounds, regular } = splitPlayoffRounds(games, homeRegionIds);
        const roundGroups = rounds.map(({ round, games: list }) => ({
          key: `round:${round}`,
          label: roundLabel(round, sport) || round,
          round: true,
          games: list,
        }));
        // Bucket the day's regular-season games by conference, then order:
        // home-region weight desc, then name; "Other games" last.
        const buckets = new Map();
        for (const g of regular) {
          const conf = grouping
            ? gameConference(g, schoolIndex, sport, homeRegionIds)
            : OTHER_GROUP;
          if (!buckets.has(conf)) buckets.set(conf, []);
          buckets.get(conf).push(g);
        }
        const groups = [...buckets.entries()]
          .map(([conference, list]) => ({
            key: `conf:${conference}`,
            label: conference,
            conference,
            games: list,
            weight: conference === OTHER_GROUP ? -1 : (confWeight.get(conference) ?? 0),
          }))
          .sort(
            (a, b) =>
              b.weight - a.weight || a.conference.localeCompare(b.conference),
          );
        const homeGroups = groups.filter((gr) => gr.weight > 0);
        const restGroups = groups.filter((gr) => gr.weight <= 0);
        // Only collapse when there is a section to lead with: a round or a
        // home-region conference.
        const collapsible =
          roundGroups.length + homeGroups.length > 0 && restGroups.length > 0;
        const expanded = !collapsible || expandedDays.has(day);
        const visible = [...roundGroups, ...(expanded ? groups : homeGroups)];
        const hiddenCount = restGroups.reduce((n, gr) => n + gr.games.length, 0);
        // A round heading always shows: on an all-playoff Friday it is the
        // only place the round is spelled out.
        const showHeads = roundGroups.length > 0 || groups.length > 1;

        return (
          <section key={day} className="week-day">
            <header className="week-day__header">
              <h3 className="week-day__name">{formatGameDay(games[0].date)}</h3>
              <span className="week-day__date">{formatGameDate(games[0].date)}</span>
              <span className="week-day__count">
                {games.length} game{games.length === 1 ? "" : "s"}
              </span>
            </header>

            <ul className="week-day__games">
              {visible.map((group) => (
                <li
                  key={group.key}
                  className={`week-conf${group.round ? " week-conf--round" : ""}`}
                >
                  {showHeads && (
                    <h4 className="week-conf__head">
                      <span>{group.label}</span>
                      {group.round && (
                        <span className="week-conf__sep" aria-hidden="true">
                          ·
                        </span>
                      )}
                      <span className="week-conf__count">
                        {group.games.length} game{group.games.length === 1 ? "" : "s"}
                      </span>
                    </h4>
                  )}
                  <ul className="week-conf__games">
                    {group.games.map((g) => (
                      <GameRow
                        key={g.id}
                        game={g}
                        schoolIndex={schoolIndex}
                        allGames={allGames}
                        sportConfig={sportConfig}
                        sport={sport}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>

            {collapsible && (
              <button
                type="button"
                className="week-more"
                aria-expanded={expanded}
                onClick={() => toggleDay(day)}
              >
                {expanded
                  ? "Hide other conferences"
                  : `Show ${hiddenCount} more game${hiddenCount === 1 ? "" : "s"} from other conferences`}
                <span aria-hidden="true">{expanded ? " ▴" : " ▾"}</span>
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GameRow({ game, schoolIndex, allGames, sportConfig, sport = null }) {
  const sportPrefix = useSportPrefix();
  const homeSchool = schoolFor(game.home, schoolIndex);
  const awaySchool = schoolFor(game.away, schoolIndex);
  const isFinal = game.status === "final";
  // State and sectional games are played at arenas: WIAA's "home" side is
  // only listing order, so the row says "vs" and names the venue instead
  // of "at" (utils/postseason.js isNeutralSite).
  const neutral = isNeutralSite(game, schoolIndex);
  const venue = neutral ? humanizeVenue(game.venue) : "";
  // The dataset's live status is "in_progress" (models/schema.py) — the
  // ticker shows these LIVE with scores; this grid must match or a
  // Friday-night reader sees a hidden score next to a stale kickoff time.
  const isLive = game.status === "in_progress";
  // A scheduled game whose kickoff is well past with no result is
  // postponed or unreported (shared 36h rule in utils/games.js, so the
  // ticker says the same thing). Live games keep their treatment.
  // "Not reported" covers both a stale-scheduled row (kickoff 36h gone,
  // no result) and a final WIAA marked without posting a score. Every
  // status word and every screen-reader label agrees on that.
  const stale = isStaleScheduled(game);
  const unreportedFinal = isUnreportedFinal(game);
  const notReported = stale || unreportedFinal;
  // Kickoff a few hours gone, no score yet: the row says "Score pending"
  // instead of a tip time that reads like tonight (critique run 18).
  // Kickoff passed within the last three hours: "Underway", no clock.
  const pending = isScorePending(game);
  const underway = isUnderway(game);
  // WIAA records a forfeit as a 1-0 final. Printed at score size that
  // reads as a data error, so the score slot says FORFEIT instead and the
  // winner keeps its bold. An unreported final is neither a forfeit nor
  // a real result — it takes the notReported path below.
  const forfeit = isFinal && !unreportedFinal && isForfeitScore(game);

  const homeWon = isFinal && !unreportedFinal && (game.home.score ?? -1) > (game.away.score ?? -1);
  const awayWon = isFinal && !unreportedFinal && (game.away.score ?? -1) > (game.home.score ?? -1);
  // Numerals sit beside the names, so the sentence skips the scoreline.
  const summary = gameSummaryLine(game, { sportConfig, omitScore: true, allGames });
  const player = playerLineForGame(game, { contextGames: allGames, sportConfig });
  const playerSchool = player ? schoolIndex.get(player.schoolId) : null;
  const showScore = (isFinal || isLive) && !forfeit && !unreportedFinal;
  // The drill-in's visible text is only its status word, so 41 rows read
  // "Final, Final, Not reported…" to a screen reader. Name each link by
  // its matchup and score, the way the team page's schedule already does.
  // Unreported finals fall through to the matchup form — "TeamA 0,
  // TeamB 0" would announce a fake 0-0 tie.
  // Playoff rows name the round in the label too ("Lomira at Edgar,
  // Level 3 playoff, 7:00 PM"), since the visible chip is aria-hidden.
  const roundName = roundLabel(game.playoff_round, sport) || game.playoff_round;
  const roundBit = game.playoff ? `, ${roundName ? `${roundName} playoff` : "playoff"}` : "";
  const venueBit = venue ? ` at ${venue}` : "";
  const awayName = isTbdSide(game.away) ? "Opponent TBD" : game.away.name;
  const homeName = isTbdSide(game.home) ? "Opponent TBD" : game.home.name;
  const matchup = `${awayName} ${neutral ? "vs" : "at"} ${homeName}${venueBit}${roundBit}`;
  const scoreline = `${game.away.name} ${game.away.score}, ${game.home.name} ${game.home.score}${roundBit}`;
  const linkLabel = forfeit
    ? `${matchup}, forfeit, game details`
    : notReported
      ? `${matchup}, not reported, game details`
      : underway
        ? `${matchup}, underway, game details`
        : pending
          ? `${matchup}, played, score pending, game details`
          : isFinal
            ? `${scoreline}, final, game details`
            : isLive
              ? `${scoreline}, live, game details`
              : `${matchup}, ${formatGameTime(game.date)}, game details`;

  return (
    <li className="game-row">
      <Side
        team={game.away}
        school={awaySchool}
        score={game.away.score}
        won={awayWon}
        showScore={showScore}
      />
      <span className="game-row__at">{neutral ? "vs" : "at"}</span>
      <Side
        team={game.home}
        school={homeSchool}
        score={game.home.score}
        won={homeWon}
        showScore={showScore}
      />
      {/* Status cell: the round chip (playoff rows) and the drill-in.
          One grid item either way, so the phone layout's auto-placement
          is the same for every row. */}
      <span className="game-row__end">
      {game.playoff && (
        <span className="game-row__round" aria-hidden="true">
          {roundChip(game.playoff_round, sport)}
        </span>
      )}
      {/* Neutral-site venue, in the status cell (never its own grid row:
          the phone layout's row heights are guarded). Named in the
          drill-in's label, so decorative here. */}
      {venue && (
        <span className="game-row__venue" aria-hidden="true" title={venue}>
          {venue}
        </span>
      )}
      <Link
        to={`${sportPrefix}/game/${game.id}`}
        className={`game-row__status game-row__details${
          isLive ? " game-row__status--live" : underway ? " game-row__status--underway" : ""
        }`}
        aria-label={linkLabel}
      >
        {forfeit
          ? "Forfeit"
          : notReported
            ? "Not reported"
            : isFinal
              ? "Final"
              : isLive
                ? "LIVE"
                : underway
                  ? "Underway"
                  : pending
                    ? "Score pending"
                    : formatGameTime(game.date)}
        <span aria-hidden="true"> ›</span>
      </Link>
      </span>
      {summary && <p className="game-row__summary">{summary}</p>}
      {notReported && (
        <p className="game-row__summary game-row__summary--note">
          No score has been posted for this game yet — it may have been postponed, or
          the result not reported.
        </p>
      )}
      {player && (
        <p className="game-row__recap">
          <span className="game-row__recap-team">
            {playerSchool?.name ?? player.schoolId}
          </span>
          {" · "}
          {player.text}
        </p>
      )}
    </li>
  );
}

function Side({ team, school, score, won, showScore }) {
  // Bracket placeholder: say so, with no logo (WIAA's no_logo.jpg) and
  // no team link.
  if (isTbdSide(team)) {
    return (
      <span className="game-side game-side--tbd">
        <span className="game-side__name">Opponent TBD</span>
      </span>
    );
  }
  return (
    <span className={`game-side ${won ? "game-side--won" : ""}`}>
      <TeamLogo team={team} school={school} size="sm" />
      <TeamLink team={team} className="game-side__name">
        {team.name}
      </TeamLink>
      {showScore && (
        <span className="game-side__score">{score ?? "—"}</span>
      )}
    </span>
  );
}
