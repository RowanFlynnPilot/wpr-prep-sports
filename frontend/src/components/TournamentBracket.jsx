import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  buildTeamJourneys,
  playoffRoundsInOrder,
} from "../utils/bracket.js";
import { useSportPrefix } from "../utils/links.js";

/**
 * Team-journey bracket — one row per tracked school that played a
 * playoff game. Each row shows their path through the rounds, with
 * the round their season ended marked. Much more legible than a wall
 * of round-grouped game cards when the area has 30+ playoff games.
 *
 * State champs (still alive at the latest round) sort to the top;
 * Round 1 exits to the bottom.
 */
export default function TournamentBracket({ games, schoolIndex }) {
  const journeys = useMemo(
    () => buildTeamJourneys(games, schoolIndex),
    [games, schoolIndex],
  );
  const rounds = useMemo(() => playoffRoundsInOrder(games), [games]);
  const lastRound = rounds[rounds.length - 1];

  if (journeys.length === 0 || rounds.length === 0) return null;

  return (
    <div className="bracket">
      <div className="bracket__toolbar">
        <span className="bracket__meta">
          {journeys.length} tracked {journeys.length === 1 ? "team" : "teams"} in the tournament
        </span>
      </div>

      <div
        className="bracket__journey"
        style={{ "--round-count": rounds.length }}
      >
        <div className="bracket__journey-header" role="row">
          <div className="bracket__journey-cell bracket__journey-cell--team" role="columnheader">
            Team
          </div>
          {rounds.map((r) => (
            <div key={r} className="bracket__journey-cell bracket__journey-cell--round" role="columnheader">
              {r}
            </div>
          ))}
        </div>

        {journeys.map((j) => (
          <JourneyRow
            key={j.schoolId}
            journey={j}
            rounds={rounds}
            lastRound={lastRound}
          />
        ))}
      </div>
    </div>
  );
}

// Rounds that mean "won the state title" — only these get the
// champion gold treatment. Football tops out at Level 4 (Camp Randall);
// other sports use explicitly state-named rounds. Sectional Final
// winners are "advancing to state" but not champions.
const STATE_TITLE_ROUNDS = new Set([
  "Level 4",
  "State Final",
  "State Championship",
]);

function JourneyRow({ journey, rounds, lastRound }) {
  void lastRound;
  const sportPrefix = useSportPrefix();
  const byRound = new Map(journey.games.map((g) => [g.round, g]));
  const finalGame = journey.games[journey.games.length - 1];
  const stillAlive = finalGame?.won && finalGame?.isFinal;
  const stateChamp = stillAlive && STATE_TITLE_ROUNDS.has(finalGame?.round ?? "");

  return (
    <div
      className={
        "bracket__journey-row" +
        (stateChamp ? " bracket__journey-row--champ" : "") +
        (stillAlive ? " bracket__journey-row--alive" : "")
      }
      role="row"
    >
      <div className="bracket__journey-cell bracket__journey-cell--team">
        <Link
          to={`${sportPrefix}/team/${journey.schoolId}`}
          className="bracket__journey-team"
        >
          {journey.school?.name ?? journey.schoolId}
        </Link>
        {journey.school?.mascot && (
          <span className="bracket__journey-mascot">{journey.school.mascot}</span>
        )}
      </div>
      {rounds.map((r) => {
        const entry = byRound.get(r);
        if (!entry) {
          return (
            <div
              key={r}
              className="bracket__journey-cell bracket__journey-cell--empty"
              aria-label={`${r}: did not play`}
            >
              <span aria-hidden="true">—</span>
            </div>
          );
        }
        return (
          <div
            key={r}
            className={
              "bracket__journey-cell bracket__journey-cell--game" +
              (entry.won ? " bracket__journey-cell--won" : "") +
              (entry.isFinal && !entry.won ? " bracket__journey-cell--lost" : "")
            }
          >
            <Link
              to={`${sportPrefix}/game/${entry.game.id}`}
              className="bracket__journey-game"
            >
              <span className="bracket__journey-result">
                {entry.isFinal
                  ? `${entry.won ? "W" : "L"} ${entry.ownScore}-${entry.oppScore}`
                  : "Upcoming"}
              </span>
              <span className="bracket__journey-opponent">
                {entry.isHome ? "vs" : "@"} {entry.opponent.name}
              </span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
