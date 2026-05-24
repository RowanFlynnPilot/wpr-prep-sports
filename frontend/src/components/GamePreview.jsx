import { useMemo } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import { schoolFor } from "../utils/schools.js";
import { formatGameDate } from "../utils/dates.js";
import { useSportPrefix } from "../utils/links.js";

/**
 * Pre-game preview. Renders for `scheduled` games only — shows each
 * team's record-to-date, conference standings position, recent form,
 * and the last meeting between these two teams. Drives pre-game traffic
 * the same way a newspaper preview column does.
 */
export default function GamePreview({ game, dataset, schoolIndex }) {
  const sportPrefix = useSportPrefix();
  const gameTime = new Date(game.date).getTime();

  const awaySchool = schoolFor(game.away, schoolIndex);
  const homeSchool = schoolFor(game.home, schoolIndex);

  const awaySummary = useMemo(
    () => buildTeamSummary(game.away, awaySchool, gameTime, dataset.games, dataset.standings, game),
    [game, awaySchool, gameTime, dataset.games, dataset.standings],
  );
  const homeSummary = useMemo(
    () => buildTeamSummary(game.home, homeSchool, gameTime, dataset.games, dataset.standings, game),
    [game, homeSchool, gameTime, dataset.games, dataset.standings],
  );
  const lastMeeting = useMemo(
    () => findLastMeeting(game, gameTime, dataset.games),
    [game, gameTime, dataset.games],
  );

  if (game.status !== "scheduled") return null;

  return (
    <section className="game-preview">
      <div className="section-header">
        <h2>Preview</h2>
        <span className="section-header__hint">
          Headed into {game.conference_game ? "this conference matchup" : "tonight's matchup"}
        </span>
      </div>

      <div className="game-preview__teams">
        <PreviewTeamCard
          side={game.away}
          school={awaySchool}
          summary={awaySummary}
        />
        <PreviewTeamCard
          side={game.home}
          school={homeSchool}
          summary={homeSummary}
        />
      </div>

      {lastMeeting && (
        <LastMeetingCard
          game={game}
          meeting={lastMeeting}
          sportPrefix={sportPrefix}
        />
      )}

      {!lastMeeting && hasAnyTrackedSide(game) && (
        <p className="game-preview__no-meeting">
          No prior meeting between these teams on record.
        </p>
      )}
    </section>
  );
}

function hasAnyTrackedSide(game) {
  return Boolean(game.home.school_id || game.away.school_id);
}

function PreviewTeamCard({ side, school, summary }) {
  const schoolColor = school?.colors?.[0] ?? null;
  const isTracked = Boolean(side.school_id);

  return (
    <article
      className="game-preview__team"
      style={schoolColor ? { "--school-color": schoolColor } : undefined}
    >
      <header className="game-preview__team-header">
        <TeamLogo team={side} school={school} size="md" />
        <div className="game-preview__team-text">
          <h3>{side.name}</h3>
          {school?.mascot && <p>{school.mascot}</p>}
        </div>
        {summary && (
          <span className="game-preview__record">
            {summary.wins}-{summary.losses}
          </span>
        )}
      </header>

      {!isTracked && (
        <p className="game-preview__untracked-note">
          Opponent outside coverage — record and form unavailable.
        </p>
      )}

      {summary && (
        <dl className="game-preview__stats">
          {summary.confName && (
            <div className="game-preview__stat">
              <dt>{summary.confName}</dt>
              <dd>
                {summary.confRank
                  ? `#${summary.confRank} of ${summary.confSize}`
                  : "Unranked"}
              </dd>
            </div>
          )}
          {summary.recentForm.length > 0 && (
            <div className="game-preview__stat">
              <dt>Last {summary.recentForm.length}</dt>
              <dd className="game-preview__form">
                {summary.recentForm.map((r, i) => (
                  <span
                    key={i}
                    className={`game-preview__form-mark game-preview__form-mark--${r.toLowerCase()}`}
                    title={r === "W" ? "Win" : "Loss"}
                  >
                    {r}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {summary.pointsFor != null && summary.pointsAgainst != null && (
            <div className="game-preview__stat">
              <dt>Avg margin</dt>
              <dd>
                {formatMargin(summary.pointsFor, summary.pointsAgainst, summary.wins + summary.losses)}
              </dd>
            </div>
          )}
        </dl>
      )}
    </article>
  );
}

function LastMeetingCard({ game, meeting, sportPrefix }) {
  const isHomeNow = (g, schoolId) => g.home.school_id === schoolId;
  // Frame the score from the home-now team's POV: "Wausau East won 28-21
  // when these teams met on Sep 19, 2024."
  const awayInMeeting = isHomeNow(meeting, game.away.school_id)
    ? meeting.home
    : meeting.away;
  const homeInMeeting = isHomeNow(meeting, game.home.school_id)
    ? meeting.home
    : meeting.away;
  const awayWon =
    (awayInMeeting.score ?? -1) > (homeInMeeting.score ?? -1);
  const homeWon =
    (homeInMeeting.score ?? -1) > (awayInMeeting.score ?? -1);

  const winnerName = awayWon
    ? game.away.name
    : homeWon
      ? game.home.name
      : null;
  const loserName = awayWon
    ? game.home.name
    : homeWon
      ? game.away.name
      : null;
  const winScore = Math.max(awayInMeeting.score ?? 0, homeInMeeting.score ?? 0);
  const lossScore = Math.min(awayInMeeting.score ?? 0, homeInMeeting.score ?? 0);

  return (
    <Link
      to={`${sportPrefix}/game/${meeting.id}`}
      className="game-preview__last-meeting"
    >
      <span className="game-preview__last-meeting-label">Last meeting</span>
      <span className="game-preview__last-meeting-detail">
        {winnerName ? (
          <>
            <strong>{winnerName}</strong> defeated {loserName} {winScore}-{lossScore}
          </>
        ) : (
          <>
            {awayInMeeting.name} {awayInMeeting.score ?? "—"}, {homeInMeeting.name} {homeInMeeting.score ?? "—"}
          </>
        )}
        <span className="game-preview__last-meeting-date">
          {" · "}
          {formatGameDate(meeting.date)}
        </span>
      </span>
    </Link>
  );
}

function buildTeamSummary(side, school, gameTime, allGames, standings, currentGame) {
  const schoolId = side.school_id;
  if (!schoolId) return null;

  const priorGames = allGames
    .filter(
      (g) =>
        g.id !== currentGame.id &&
        g.status === "final" &&
        (g.home.school_id === schoolId || g.away.school_id === schoolId) &&
        new Date(g.date).getTime() < gameTime,
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let wins = 0;
  let losses = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  for (const g of priorGames) {
    const isHome = g.home.school_id === schoolId;
    const ours = isHome ? g.home.score : g.away.score;
    const theirs = isHome ? g.away.score : g.home.score;
    if (ours == null || theirs == null) continue;
    pointsFor += ours;
    pointsAgainst += theirs;
    if (ours > theirs) wins++;
    else if (theirs > ours) losses++;
  }

  const recentForm = priorGames
    .slice(-5)
    .map((g) => {
      const isHome = g.home.school_id === schoolId;
      const ours = isHome ? g.home.score : g.away.score;
      const theirs = isHome ? g.away.score : g.home.score;
      if (ours == null || theirs == null) return null;
      return ours > theirs ? "W" : "L";
    })
    .filter(Boolean);

  // Conference from the current game's metadata first (most specific to
  // this sport), else fall back to the school manifest's per-sport entry.
  const manifestConf = school?.conferences?.find?.(
    (c) => c.sport === currentGame.sport,
  )?.conference;
  const confName = currentGame.conference ?? manifestConf ?? null;
  let confRank = null;
  let confSize = null;
  if (confName && standings) {
    const confRow = standings.find((s) => s.conference === confName);
    if (confRow) {
      const idx = confRow.rows.findIndex((r) => r.school_id === schoolId);
      if (idx >= 0) {
        confRank = idx + 1;
        confSize = confRow.rows.length;
      }
    }
  }

  return {
    wins,
    losses,
    pointsFor: priorGames.length > 0 ? pointsFor : null,
    pointsAgainst: priorGames.length > 0 ? pointsAgainst : null,
    recentForm,
    confName,
    confRank,
    confSize,
  };
}

function findLastMeeting(game, gameTime, allGames) {
  const a = game.home.school_id;
  const b = game.away.school_id;
  if (!a || !b) return null;
  const meetings = allGames
    .filter(
      (g) =>
        g.id !== game.id &&
        g.status === "final" &&
        new Date(g.date).getTime() < gameTime &&
        ((g.home.school_id === a && g.away.school_id === b) ||
          (g.home.school_id === b && g.away.school_id === a)),
    )
    .sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
  return meetings[0] ?? null;
}

function formatMargin(pf, pa, gamesPlayed) {
  if (!gamesPlayed) return "—";
  const diff = (pf - pa) / gamesPlayed;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}`;
}
