import { useMemo } from "react";
import { useParams, Navigate, Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TeamLink from "../components/TeamLink.jsx";
import { schoolFor } from "../utils/schools.js";
import { formatGameDay, formatGameDate, formatGameTime } from "../utils/dates.js";
import { recapForGame } from "../utils/recap.js";

/**
 * Full game detail. Shows the matchup header, the recap line, and every
 * Bound-sourced stat leader split by team. Lives at /game/:gameId.
 */
export default function GamePage({ dataset, schoolIndex }) {
  const { gameId } = useParams();
  const game = useMemo(
    () => (dataset.games ?? []).find((g) => g.id === gameId),
    [dataset.games, gameId],
  );

  if (!game) {
    return <Navigate to="/" replace />;
  }

  const isFinal = game.status === "final";
  const homeScore = game.home.score;
  const awayScore = game.away.score;
  const homeWon = isFinal && (homeScore ?? -1) > (awayScore ?? -1);
  const awayWon = isFinal && (awayScore ?? -1) > (homeScore ?? -1);

  const homeSchool = schoolFor(game.home, schoolIndex);
  const awaySchool = schoolFor(game.away, schoolIndex);

  // Recap voice from the winning side (or tracked side if winner isn't tracked)
  const perspectiveSchoolId = homeWon
    ? game.home.school_id || game.away.school_id
    : awayWon
    ? game.away.school_id || game.home.school_id
    : game.home.school_id || game.away.school_id;
  const teamGames = perspectiveSchoolId
    ? dataset.games
        .filter(
          (g) =>
            g.home.school_id === perspectiveSchoolId ||
            g.away.school_id === perspectiveSchoolId,
        )
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    : null;
  const recap = recapForGame(game, {
    schoolsById: schoolIndex,
    teamGames,
    perspectiveSchoolId,
  });

  // Group stat lines by team
  const statsByTeamId = useMemo(() => {
    const m = new Map();
    for (const line of game.stat_leaders ?? []) {
      const key = line.team_school_id || `__raw:${line.team_name}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(line);
    }
    return m;
  }, [game.stat_leaders]);

  const breadcrumb = (
    <>
      <Link to="/">All Games</Link>
      <span aria-hidden="true"> › </span>
      <span>
        {game.away.name} {isFinal ? `${awayScore}-${homeScore}` : "vs"} {game.home.name}
      </span>
    </>
  );

  return (
    <Layout breadcrumb={breadcrumb}>
      <section className="game-page__hero">
        <div className="game-page__meta">
          <span className="eyebrow eyebrow--accent">
            {isFinal ? "Final" : game.status === "in_progress" ? "Live" : "Up Next"}
          </span>
          <span className="game-page__date">
            {formatGameDay(game.date)} · {formatGameDate(game.date)}
            {!isFinal && <> · {formatGameTime(game.date)}</>}
          </span>
          {game.venue && <span className="game-page__venue">{game.venue}</span>}
        </div>

        <div className="game-page__matchup">
          <Side
            team={game.away}
            school={awaySchool}
            score={awayScore}
            won={awayWon}
            showScore={isFinal}
          />
          <div className="game-page__divider" aria-hidden="true">
            <span>vs</span>
          </div>
          <Side
            team={game.home}
            school={homeSchool}
            score={homeScore}
            won={homeWon}
            showScore={isFinal}
          />
        </div>

        {recap && <p className="game-page__recap">{recap}</p>}
      </section>

      <section>
        <div className="section-header">
          <h2>Game Stats</h2>
          <span className="section-header__hint">
            {game.stat_leaders?.length
              ? `${game.stat_leaders.length} stat leaders · via Bound`
              : "No stats available for this game"}
          </span>
        </div>

        {game.stat_leaders?.length > 0 ? (
          <div className="game-stats">
            <TeamStatsCard
              label={game.away.name}
              team={game.away}
              school={awaySchool}
              won={awayWon}
              lines={statsByTeamId.get(game.away.school_id) ?? []}
              score={awayScore}
              showScore={isFinal}
            />
            <TeamStatsCard
              label={game.home.name}
              team={game.home}
              school={homeSchool}
              won={homeWon}
              lines={statsByTeamId.get(game.home.school_id) ?? []}
              score={homeScore}
              showScore={isFinal}
            />
          </div>
        ) : (
          <div className="game-stats__empty">
            <p>
              Stats for this game haven't been reported to Bound yet, or this
              matchup is outside the coverage area. The final score above is
              authoritative.
            </p>
          </div>
        )}
      </section>
    </Layout>
  );
}

function Side({ team, school, score, won, showScore }) {
  return (
    <div className={`game-page__team ${won ? "game-page__team--won" : ""}`}>
      <TeamLogo team={team} school={school} size="xl" />
      <div className="game-page__team-text">
        <h3 className="game-page__team-name">
          <TeamLink team={team}>{team.name}</TeamLink>
        </h3>
        {school?.mascot && (
          <p className="game-page__team-mascot">{school.mascot}</p>
        )}
      </div>
      <div className="game-page__score-wrap">
        {showScore && (
          <span className="game-page__score">{score ?? "—"}</span>
        )}
      </div>
    </div>
  );
}

function TeamStatsCard({ label, team, school, won, lines, score, showScore }) {
  if (lines.length === 0 && !team.school_id) {
    // Opponent we don't track and no stats — render a minimal placeholder
    return (
      <article className="team-stats team-stats--empty">
        <header className="team-stats__header">
          <TeamLogo team={team} school={school} size="md" />
          <div>
            <h3>{label}</h3>
          </div>
          {showScore && (
            <span className="team-stats__score">{score ?? "—"}</span>
          )}
        </header>
        <p className="team-stats__empty-note">No stats reported.</p>
      </article>
    );
  }

  return (
    <article className={`team-stats ${won ? "team-stats--won" : ""}`}>
      <header className="team-stats__header">
        <TeamLogo team={team} school={school} size="md" />
        <div className="team-stats__title">
          <h3>
            <TeamLink team={team}>{label}</TeamLink>
          </h3>
          {school?.mascot && <p>{school.mascot}</p>}
        </div>
        {showScore && (
          <span className="team-stats__score">{score ?? "—"}</span>
        )}
      </header>
      {lines.length === 0 ? (
        <p className="team-stats__empty-note">No stats reported for this team.</p>
      ) : (
        <ul className="team-stats__list">
          {lines.map((line, idx) => (
            <StatRow key={`${line.category}-${idx}`} line={line} />
          ))}
        </ul>
      )}
    </article>
  );
}

const CATEGORY_POS = {
  "Passing Yards": "QB",
  "Rushing Yards": "RB",
  "Receiving Yards": "WR",
  "Total Tackles": "DEF",
};

function StatRow({ line }) {
  const stats = line.stats ?? {};
  return (
    <li className="stat-row">
      <span className="stat-row__pos">{CATEGORY_POS[line.category] ?? "—"}</span>
      <div className="stat-row__player">
        <span className="stat-row__name">
          {line.player_name}
          {line.player_year && (
            <span className="stat-row__year"> ({line.player_year})</span>
          )}
        </span>
        <span className="stat-row__category">{line.category}</span>
      </div>
      <div className="stat-row__stats">
        {Object.entries(stats).map(([k, v]) => (
          <span key={k} className="stat-row__stat">
            <span className="stat-row__stat-label">{k}</span>
            <span className="stat-row__stat-value">{v}</span>
          </span>
        ))}
      </div>
    </li>
  );
}
