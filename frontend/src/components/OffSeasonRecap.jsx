import { useMemo } from "react";
import TeamLink from "./TeamLink.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { buildTeamJourneys } from "../utils/bracket.js";
import { SITE } from "../config/site.js";
import "../styles/OffSeasonRecap.css";

/**
 * Off-season Scores tab lead: how the finished season ended.
 *
 * Between a sport's last final and WIAA posting the next schedule, the
 * dataset still holds last season. The Scores tab used to lead with
 * "This Week · 9 games" over March fixtures under a countdown to
 * November, which read as broken. This replaces that section with what a
 * reader in the gap actually wants: who won each conference, who went
 * deepest in the tournament, and when the new schedule shows up.
 *
 * Props:
 *   seasonLabel      "2025–26" (the dataset's own season)
 *   nextSeasonLabel  "2026–27"
 *   nextSeasonStart  local Date of the opener (config nextSeasonStart via
 *                    utils/dates localDate), or null
 *   standings        meaningful conference tables, already in display order
 *   games            the season's games (playoff / playoff_round read here)
 */

/** Rounds that, when won, send a team to the state tournament. */
const STATE_QUALIFYING_ROUNDS = new Set(["Sectional Final", "Level 4"]);
const STATE_FINAL_ROUNDS = new Set(["State Final", "State Championship"]);

const OPENER_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function fmtRecord(w, l, t) {
  const ties = t ?? 0;
  return ties > 0 ? `${w ?? 0}-${l ?? 0}-${ties}` : `${w ?? 0}-${l ?? 0}`;
}

function confKey(r) {
  return fmtRecord(r.conference_wins, r.conference_losses, r.conference_ties);
}

/** "beat Turtle Lake 60–58" / "lost to West Salem 54–61". */
function resultPhrase(entry) {
  if (!entry?.isFinal || entry.ownScore == null || entry.oppScore == null) return null;
  const opp = entry.opponent?.name ?? "opponent";
  const score = `${entry.ownScore}–${entry.oppScore}`;
  if (entry.ownScore === entry.oppScore) return `tied ${opp} ${score}`;
  return entry.won ? `beat ${opp} ${score}` : `lost to ${opp} ${score}`;
}

/** Sentence-case a round name for prose: "Sectional Final" → "sectional final". */
function roundProse(round) {
  return String(round ?? "playoffs").toLowerCase();
}

/**
 * Classify how a tracked team's tournament ended. `stateLabel` is set for
 * any team that reached state (a state-round game, or a win in the round
 * that qualifies for state), null otherwise.
 */
function classifyJourney(journey) {
  const last = journey.games[journey.games.length - 1];
  const round = last?.round ?? "";
  if (/^State/i.test(round)) {
    if (STATE_FINAL_ROUNDS.has(round)) {
      return { stateLabel: last.won ? "State champion" : "State runner-up", depth: last.won ? 3 : 2, last };
    }
    // Lost in (or still alive past) an earlier state round.
    return { stateLabel: `State ${round.replace(/^State\s+/i, "").toLowerCase()}`, depth: 1, last };
  }
  if (STATE_QUALIFYING_ROUNDS.has(round) && last.won) {
    return { stateLabel: "Reached state", depth: 0, last, qualifierOnly: true };
  }
  return { stateLabel: null, depth: -1, last };
}

export default function OffSeasonRecap({
  seasonLabel,
  nextSeasonLabel,
  nextSeasonStart,
  standings = [],
  games = [],
  schoolIndex,
}) {
  const tournament = useMemo(() => {
    const journeys = buildTeamJourneys(games, schoolIndex);
    if (journeys.length === 0) return null;
    const classified = journeys.map((j) => ({ journey: j, ...classifyJourney(j) }));
    const stateTeams = classified
      .filter((c) => c.stateLabel)
      .sort(
        (a, b) =>
          b.depth - a.depth ||
          (a.journey.school?.name ?? a.journey.schoolId).localeCompare(
            b.journey.school?.name ?? b.journey.schoolId,
          ),
      );
    // No tracked team at state: show who went deepest instead.
    const deepestIdx = Math.max(...classified.map((c) => c.last?.roundIndex ?? -1));
    const deepest = classified
      .filter((c) => (c.last?.roundIndex ?? -1) === deepestIdx)
      .slice(0, 4);
    return { stateTeams, deepest, deepestRound: deepest[0]?.last?.round ?? null };
  }, [games, schoolIndex]);

  const anyStateRoundGame = useMemo(
    () => games.some((g) => g.playoff && /^State/i.test(g.playoff_round ?? "")),
    [games],
  );

  const tables = useMemo(
    () =>
      standings.map((s) => {
        const rows = s.rows ?? [];
        const started = rows.some(
          (r) => (r.conference_wins ?? 0) + (r.conference_losses ?? 0) + (r.conference_ties ?? 0) > 0,
        );
        const topKey = rows[0] ? confKey(rows[0]) : null;
        const champs = started ? rows.filter((r) => confKey(r) === topKey) : [];
        // Top three, stretched to include every co-champion.
        const shown = rows.slice(0, Math.max(3, champs.length));
        return { standing: s, shown, champIds: new Set(champs.map((r) => r.school_id || r.name)), coChamps: champs.length > 1 };
      }),
    [standings],
  );

  const governing = SITE.governingBody ?? "the state association";
  const openerPassed = nextSeasonStart ? nextSeasonStart.getTime() <= Date.now() : false;

  const teamFor = (schoolId, fallbackName) => {
    const school = schoolId ? schoolIndex?.get?.(schoolId) : null;
    return {
      stub: { school_id: schoolId || "", name: school?.name ?? fallbackName, logo_url: school?.logo_url ?? null },
      school,
    };
  };

  return (
    <section className="offseason-recap" aria-labelledby="offseason-recap-title">
      <div className="section-header">
        <h2 id="offseason-recap-title">How {seasonLabel} ended</h2>
        <span className="section-header__hint">Final standings</span>
      </div>

      {tournament && (
        <div className="offseason-recap__state">
          <h3 className="offseason-recap__kicker">{governing} tournament</h3>
          {tournament.stateTeams.length > 0 ? (
            <ul className="offseason-recap__state-list">
              {tournament.stateTeams.map((c) => {
                const { stub, school } = teamFor(c.journey.schoolId, c.journey.school?.name ?? c.journey.schoolId);
                const phrase = resultPhrase(c.last);
                return (
                  <li key={c.journey.schoolId} className="offseason-recap__state-row">
                    <TeamLogo team={stub} school={school} size="sm" />
                    <span className="offseason-recap__state-team">
                      <TeamLink team={stub}>{stub.name}</TeamLink>
                    </span>
                    <span
                      className={
                        "offseason-recap__state-result" +
                        (c.depth === 3 ? " offseason-recap__state-result--champ" : "")
                      }
                    >
                      {c.stateLabel}
                    </span>
                    {phrase && (
                      <span className="offseason-recap__state-detail">
                        {c.qualifierOnly ? `Won the ${roundProse(c.last.round)}: ` : `${c.last.round}: `}
                        {phrase}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <p className="offseason-recap__none">No tracked team reached state.</p>
              {tournament.deepest.length > 0 && (
                <ul className="offseason-recap__state-list">
                  {tournament.deepest.map((c) => {
                    const { stub, school } = teamFor(c.journey.schoolId, c.journey.school?.name ?? c.journey.schoolId);
                    const phrase = resultPhrase(c.last);
                    return (
                      <li key={c.journey.schoolId} className="offseason-recap__state-row">
                        <TeamLogo team={stub} school={school} size="sm" />
                        <span className="offseason-recap__state-team">
                          <TeamLink team={stub}>{stub.name}</TeamLink>
                        </span>
                        <span className="offseason-recap__state-result">{c.last.round}</span>
                        {phrase && <span className="offseason-recap__state-detail">{phrase}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
          {tournament.stateTeams.length > 0 && !anyStateRoundGame && (
            <p className="offseason-recap__note">
              State-tournament games aren&rsquo;t in this season&rsquo;s schedule data, so
              results stop at the sectional round.
            </p>
          )}
        </div>
      )}

      {tables.length > 0 && (
        <div className="offseason-recap__grid">
          {tables.map(({ standing, shown, champIds, coChamps }) => (
            <section
              key={`${standing.conference}-${standing.division ?? ""}`}
              className="offseason-recap__conf"
              aria-label={`${standing.conference} final standings`}
            >
              <h3 className="offseason-recap__conf-name">
                {standing.conference}
                {standing.division ? ` · ${standing.division}` : ""}
              </h3>
              <table className="offseason-recap__table">
                <thead>
                  <tr>
                    <th scope="col" className="offseason-recap__rank">
                      <span className="sr-only">Finish</span>
                    </th>
                    <th scope="col">Team</th>
                    <th scope="col" className="num">Conf</th>
                    <th scope="col" className="num">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => {
                    const { stub } = teamFor(r.school_id, r.name);
                    const isChamp = champIds.has(r.school_id || r.name);
                    return (
                      <tr key={r.school_id || r.name}>
                        <td className="offseason-recap__rank">{i + 1}</td>
                        <td className="offseason-recap__team">
                          <TeamLink team={{ ...stub, name: r.name }}>{r.name}</TeamLink>
                          {isChamp && (
                            <span className="offseason-recap__champ">
                              {coChamps ? "Co-champion" : "Champion"}
                            </span>
                          )}
                        </td>
                        <td className="num">
                          {fmtRecord(r.conference_wins, r.conference_losses, r.conference_ties)}
                        </td>
                        <td className="num offseason-recap__overall">
                          {fmtRecord(r.overall_wins, r.overall_losses, r.overall_ties)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      <p className="offseason-recap__next">
        {nextSeasonLabel ? `${nextSeasonLabel} schedules` : "Next season's schedules"} appear here
        the day {governing} posts them
        {nextSeasonStart && (
          <>
            {" · "}
            {openerPassed ? "season opened " : "first games "}
            {OPENER_FMT.format(nextSeasonStart)}
          </>
        )}
      </p>
    </section>
  );
}
