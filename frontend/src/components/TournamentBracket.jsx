import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
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
export default function TournamentBracket({ games, schoolIndex, sportConfig }) {
  const allJourneys = useMemo(
    () => buildTeamJourneys(games, schoolIndex),
    [games, schoolIndex],
  );
  const sportId = sportConfig?.id;

  // Conferences sourced from each tracked team's per-sport conference
  // membership in the manifest. Deduped + sorted alphabetically; "All"
  // is the implicit default.
  const conferences = useMemo(() => {
    const set = new Set();
    for (const j of allJourneys) {
      const conf = (j.school?.conferences ?? []).find(
        (c) => c.sport === sportId,
      )?.conference;
      if (conf) set.add(conf);
    }
    return [...set].sort();
  }, [allJourneys, sportId]);

  const [activeConf, setActiveConf] = useState("ALL");
  // Reset to All whenever the sport changes (parent remount).
  // (The component itself is keyed on sport via sportConfig.id-driven
  // remount in DashboardPage's parent, but the state survives the
  // games change in-place — defensive guard.)

  const journeys = useMemo(() => {
    if (activeConf === "ALL") return allJourneys;
    return allJourneys.filter((j) => {
      const conf = (j.school?.conferences ?? []).find(
        (c) => c.sport === sportId,
      )?.conference;
      return conf === activeConf;
    });
  }, [allJourneys, activeConf, sportId]);

  // Only show rounds where at least one filtered team played — keeps
  // the grid from rendering an empty "Level 4" column when nobody in
  // the selected conference advanced that far.
  const rounds = useMemo(() => {
    const allRounds = playoffRoundsInOrder(games);
    if (activeConf === "ALL") return allRounds;
    const seen = new Set();
    for (const j of journeys) {
      for (const g of j.games) seen.add(g.round);
    }
    return allRounds.filter((r) => seen.has(r));
  }, [games, journeys, activeConf]);

  const lastRound = rounds[rounds.length - 1];

  if (allJourneys.length === 0 || rounds.length === 0) return null;

  return (
    <div className="bracket">
      <div className="bracket__toolbar">
        <span className="bracket__meta">
          {journeys.length} of {allJourneys.length}{" "}
          {allJourneys.length === 1 ? "team" : "teams"} in the tournament
        </span>
        {conferences.length > 1 && (
          <div
            className="bracket__filter"
            role="group"
            aria-label="Filter by conference"
          >
            <FilterChip
              label="All"
              active={activeConf === "ALL"}
              onClick={() => setActiveConf("ALL")}
            />
            {conferences.map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={activeConf === c}
                onClick={() => setActiveConf(c)}
              />
            ))}
          </div>
        )}
      </div>

      {journeys.length === 0 ? (
        <p className="bracket__empty">
          No tracked teams from {activeConf} reached the tournament this season.
        </p>
      ) : (
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
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      className={`bracket__filter-chip ${active ? "bracket__filter-chip--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
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
        <div className="bracket__journey-team-row">
          <TeamLogo
            team={{
              school_id: journey.schoolId,
              name: journey.school?.name ?? journey.schoolId,
              logo_url: journey.school?.logo_url ?? null,
            }}
            school={journey.school}
            size="sm"
          />
          <Link
            to={`${sportPrefix}/team/${journey.schoolId}`}
            className="bracket__journey-team"
          >
            {stateChamp && (
              <span className="bracket__journey-trophy" aria-label="State champion" title="State champion">
                🏆
              </span>
            )}
            {journey.school?.name ?? journey.schoolId}
          </Link>
        </div>
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
