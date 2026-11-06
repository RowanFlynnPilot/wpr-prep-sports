import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import {
  buildTeamJourneys,
  playoffResultLabel,
  playoffRoundsInOrder,
} from "../utils/bracket.js";
import { isNeutralSite, isTitleRound, roundLabel } from "../utils/postseason.js";
import { humanizeVenue } from "../utils/games.js";
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

  // WIAA tournament divisions present among the journeying teams
  // (manifest wiaa_division, backfilled per season). Playoff matchups
  // are always intra-division, so filtering on the tracked side is
  // exact. 8-player football ("8P-D1") sorts after the 11-player list.
  const divisions = useMemo(() => {
    const set = new Set();
    for (const j of allJourneys) {
      const div = j.school?.wiaa_division?.[sportId];
      if (div) set.add(div);
    }
    return [...set].sort(
      (a, b) =>
        (a.startsWith("8P") ? 1 : 0) - (b.startsWith("8P") ? 1 : 0) ||
        a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [allJourneys, sportId]);
  const [activeDiv, setActiveDiv] = useState("ALL");

  const journeys = useMemo(() => {
    return allJourneys.filter((j) => {
      if (activeConf !== "ALL") {
        const conf = (j.school?.conferences ?? []).find(
          (c) => c.sport === sportId,
        )?.conference;
        if (conf !== activeConf) return false;
      }
      if (activeDiv !== "ALL") {
        if (j.school?.wiaa_division?.[sportId] !== activeDiv) return false;
      }
      return true;
    });
  }, [allJourneys, activeConf, activeDiv, sportId]);

  // Only show rounds where at least one filtered team played — keeps
  // the grid from rendering an empty "Level 4" column when nobody in
  // the selected conference/division advanced that far.
  const rounds = useMemo(() => {
    const allRounds = playoffRoundsInOrder(games);
    if (activeConf === "ALL" && activeDiv === "ALL") return allRounds;
    const seen = new Set();
    for (const j of journeys) {
      for (const g of j.games) seen.add(g.round);
    }
    return allRounds.filter((r) => seen.has(r));
  }, [games, journeys, activeConf, activeDiv]);

  const lastRound = rounds[rounds.length - 1];

  if (allJourneys.length === 0 || rounds.length === 0) return null;

  // Champions are not "alive" (nothing left to play) and not out either;
  // the count line names them so a title week never reads "none still
  // alive" above a row wearing the trophy.
  const champCount = journeys.filter((j) => journeyIsChampion(j)).length;
  const aliveCount = journeys.filter((j) => j.alive && !journeyIsChampion(j)).length;
  const tally = [
    champCount > 0 ? `${champCount} state champion${champCount === 1 ? "" : "s"}` : null,
    aliveCount > 0 ? `${aliveCount} still alive` : champCount > 0 ? null : "none still alive",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="bracket">
      <div className="bracket__toolbar">
        <span className="bracket__meta">
          {journeys.length === allJourneys.length
            ? `${allJourneys.length} tracked ${allJourneys.length === 1 ? "team" : "teams"} made the playoffs`
            : `${journeys.length} of ${allJourneys.length} playoff teams shown`}
          {" · "}
          {tally}
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
        {divisions.length > 1 && (
          <div
            className="bracket__filter"
            role="group"
            aria-label="Filter by division"
          >
            <FilterChip
              label="All divisions"
              active={activeDiv === "ALL"}
              onClick={() => setActiveDiv("ALL")}
            />
            {divisions.map((d) => (
              <FilterChip
                key={d}
                label={d}
                active={activeDiv === d}
                onClick={() => setActiveDiv(d)}
              />
            ))}
          </div>
        )}
      </div>

      {journeys.length === 0 ? (
        <p className="bracket__empty">
          No tracked teams match this filter in the tournament this season.
        </p>
      ) : (
        /* A real table: the grid used to be divs carrying role="row" and
           role="columnheader" with no role="table" above them, so axe
           reported every row as an orphan (aria-required-parent) and the
           table-less rows as missing their cells. The CSS keeps each row
           as a CSS grid, and because changing `display` on table elements
           drops their implicit roles in Chrome and Safari, the roles are
           restated explicitly on the real elements. */
        /* The wrapper owns the sideways scroll. overflow-x on the block-displayed
           <table> itself let its 660px of rounds leak into the document width
           (609px at a 375px viewport, so the whole page panned). */
        <div className="bracket__journey-wrap">
        <table
          className="bracket__journey"
          role="table"
          aria-label={`Tournament results by round, ${journeys.length} ${journeys.length === 1 ? "team" : "teams"}`}
          style={{ "--round-count": rounds.length }}
        >
          <thead role="rowgroup">
            <tr className="bracket__journey-header" role="row">
              <th
                scope="col"
                role="columnheader"
                className="bracket__journey-cell bracket__journey-cell--team"
              >
                Team
              </th>
              {rounds.map((r) => (
                <th
                  key={r}
                  scope="col"
                  role="columnheader"
                  className="bracket__journey-cell bracket__journey-cell--round"
                >
                  {roundLabel(r, sportId)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody role="rowgroup">
            {journeys.map((j) => (
              <JourneyRow
                key={j.schoolId}
                journey={j}
                rounds={rounds}
                lastRound={lastRound}
                schoolIndex={schoolIndex}
              />
            ))}
          </tbody>
        </table>
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

// Only a final win in a state title round (utils/postseason.js
// isTitleRound) gets the champion gold treatment. Football's Level 4 is a
// state semifinal for 11- and 8-player alike; Sectional Final winners are
// "advancing to state", not champions. A scheduled title game is not a
// title: the trophy waits for a final win.
function journeyIsChampion(journey) {
  const last = journey.games[journey.games.length - 1];
  return !!last?.isFinal && !!last?.won && isTitleRound(last?.round ?? "");
}

function JourneyRow({ journey, rounds, lastRound, schoolIndex }) {
  void lastRound;
  const sportPrefix = useSportPrefix();
  const byRound = new Map(journey.games.map((g) => [g.round, g]));
  const finalGame = journey.games[journey.games.length - 1];
  const stillAlive = journey.alive;
  const stateChamp = journeyIsChampion(journey);
  // Rounds past an alive team's last game are still to come, not "did not
  // play": the bracket fills them in as WIAA schedules them.
  const lastRoundPos = rounds.indexOf(finalGame?.round);

  return (
    <tr
      className={
        "bracket__journey-row" +
        (stateChamp ? " bracket__journey-row--champ" : "") +
        (stillAlive ? " bracket__journey-row--alive" : "")
      }
      role="row"
    >
      <th scope="row" role="rowheader" className="bracket__journey-cell bracket__journey-cell--team">
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
      </th>
      {rounds.map((r, pos) => {
        const entry = byRound.get(r);
        if (!entry) {
          // Later column than the team's last game while it is still in
          // the bracket: the game exists, WIAA just hasn't posted it.
          const future = stillAlive && !stateChamp && lastRoundPos >= 0 && pos > lastRoundPos;
          return (
            <td
              key={r}
              role="cell"
              className={
                "bracket__journey-cell bracket__journey-cell--empty" +
                (future ? " bracket__journey-cell--tbd" : "")
              }
            >
              {future ? (
                <>
                  <span aria-hidden="true">TBD</span>
                  <span className="sr-only">Not yet scheduled</span>
                </>
              ) : (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">Did not play</span>
                </>
              )}
            </td>
          );
        }
        // State and sectional games are at neutral arenas: WIAA's "home"
        // is listing order, so the cell says "vs" and names the venue.
        const neutral = isNeutralSite(entry.game, schoolIndex);
        const venue = neutral && entry.game.venue ? humanizeVenue(entry.game.venue) : null;
        const result = playoffResultLabel(entry);
        return (
          <td
            key={r}
            role="cell"
            className={
              "bracket__journey-cell bracket__journey-cell--game" +
              (entry.won ? " bracket__journey-cell--won" : "") +
              (entry.isFinal && !entry.won && !entry.undecided ? " bracket__journey-cell--lost" : "") +
              (entry.shootout ? " bracket__journey-cell--shootout" : "")
            }
          >
            <Link
              to={`${sportPrefix}/game/${entry.game.id}`}
              className="bracket__journey-game"
              title={venue ?? undefined}
            >
              <span className="bracket__journey-result">
                {result ?? "Upcoming"}
                {entry.shootout && (
                  <span className="sr-only">
                    {entry.undecided
                      ? ", penalty-kick shootout, result pending"
                      : `, ${entry.won ? "won" : "lost"} on penalty kicks`}
                  </span>
                )}
              </span>
              <span className="bracket__journey-opponent">
                {/* WIAA lists the next round's opponent as "TBD" until the
                    other game ends; "vs TBD" read like a team name. */}
                {/^tbd$/i.test(entry.opponent.name ?? "")
                  ? "opponent TBD"
                  : `${entry.isHome || neutral ? "vs" : "@"} ${entry.opponent.name}`}
              </span>
              {venue && <span className="bracket__journey-venue">{venue}</span>}
            </Link>
          </td>
        );
      })}
    </tr>
  );
}
