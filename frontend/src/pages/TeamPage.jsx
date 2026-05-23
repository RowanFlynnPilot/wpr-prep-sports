import { useMemo } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TeamLink from "../components/TeamLink.jsx";
import Sponsor from "../components/Sponsor.jsx";
import SeasonLeaders from "../components/SeasonLeaders.jsx";
import { formatGameDay, formatGameDate, formatGameTime } from "../utils/dates.js";
import { recapForGame } from "../utils/recap.js";

export default function TeamPage({ dataset, schoolIndex, sponsors }) {
  const { schoolId } = useParams();
  const school = schoolIndex.get(schoolId);

  if (!school) {
    return <Navigate to="/" replace />;
  }

  const teamGames = useMemo(
    () =>
      dataset.games
        .filter(
          (g) =>
            g.home.school_id === schoolId || g.away.school_id === schoolId,
        )
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [dataset.games, schoolId],
  );

  const record = useMemo(() => computeRecord(teamGames, schoolId), [teamGames, schoolId]);

  const seasonStatsForSchool = useMemo(
    () => (dataset.seasonStats ?? []).filter((r) => r.school_id === schoolId),
    [dataset.seasonStats, schoolId],
  );

  // Try to find this school's logo from any of their home games (where the
  // home team's logo is theirs). Falls back to the colored monogram.
  const logoUrl = useMemo(() => {
    const homeGame = teamGames.find(
      (g) => g.home.school_id === schoolId && g.home.logo_url,
    );
    if (homeGame) return homeGame.home.logo_url;
    const awayGame = teamGames.find(
      (g) => g.away.school_id === schoolId && g.away.logo_url,
    );
    return awayGame?.away.logo_url ?? null;
  }, [teamGames, schoolId]);

  const heroTeam = {
    school_id: schoolId,
    name: school.name,
    logo_url: logoUrl,
  };

  const breadcrumb = (
    <>
      <Link to="/">All Teams</Link>
      <span aria-hidden="true"> › </span>
      <span>{school.name}</span>
    </>
  );

  return (
    <Layout breadcrumb={breadcrumb} sponsors={sponsors}>
      <section className="team-hero">
        <TeamLogo team={heroTeam} school={school} size="xl" />
        <div className="team-hero__meta">
          <span className="eyebrow">{school.full_name}</span>
          <h1 className="team-hero__name">{school.name}</h1>
          <p className="team-hero__mascot">
            {school.mascot} · {school.city}
          </p>
        </div>
        <div className="team-hero__record">
          <div className="record-stat">
            <span className="record-stat__num">{record.wins}-{record.losses}</span>
            <span className="record-stat__label">Overall</span>
          </div>
          {record.pointsFor > 0 && (
            <>
              <div className="record-stat">
                <span className="record-stat__num">{record.pointsFor}</span>
                <span className="record-stat__label">PF</span>
              </div>
              <div className="record-stat">
                <span className="record-stat__num">{record.pointsAgainst}</span>
                <span className="record-stat__label">PA</span>
              </div>
            </>
          )}
        </div>
      </section>

      <section>
        <div className="section-header">
          <h2>2025–26 Schedule</h2>
          <span className="section-header__hint">Football · {teamGames.length} games</span>
        </div>

        {teamGames.length === 0 ? (
          <div className="team-empty">No games scheduled.</div>
        ) : (
          <ol className="team-schedule">
            {teamGames.map((g, idx) => (
              <ScheduleRow
                key={g.id}
                game={g}
                index={idx + 1}
                schoolId={schoolId}
                schoolIndex={schoolIndex}
                allTeamGames={teamGames}
              />
            ))}
          </ol>
        )}
      </section>

      <SeasonLeaders rows={seasonStatsForSchool} />

      <Sponsor slot={`school:${schoolId}`} sponsors={sponsors} variant="card" />
    </Layout>
  );
}

function computeRecord(games, schoolId) {
  let wins = 0, losses = 0, pf = 0, pa = 0;
  for (const g of games) {
    if (g.status !== "final") continue;
    const isHome = g.home.school_id === schoolId;
    const own = isHome ? g.home.score : g.away.score;
    const opp = isHome ? g.away.score : g.home.score;
    if (own == null || opp == null) continue;
    pf += own;
    pa += opp;
    if (own > opp) wins++;
    else losses++;
  }
  return { wins, losses, pointsFor: pf, pointsAgainst: pa };
}

function ScheduleRow({ game, index, schoolId, schoolIndex, allTeamGames }) {
  const isHome = game.home.school_id === schoolId;
  const opponent = isHome ? game.away : game.home;
  const opponentSchool = schoolIndex.get(opponent.school_id);
  const own = isHome ? game.home.score : game.away.score;
  const opp = isHome ? game.away.score : game.home.score;
  const isFinal = game.status === "final";
  const won = isFinal && own != null && opp != null && own > opp;
  const lost = isFinal && own != null && opp != null && own < opp;
  const recap = recapForGame(game, {
    schoolsById: schoolIndex,
    teamGames: allTeamGames,
    perspectiveSchoolId: schoolId,
  });

  return (
    <li className="schedule-row">
      <span className="schedule-row__index">{index}</span>
      <div className="schedule-row__date">
        <span className="schedule-row__day">{formatGameDay(game.date)}</span>
        <span className="schedule-row__datelabel">{formatGameDate(game.date)}</span>
      </div>
      <div className="schedule-row__matchup">
        <span className="schedule-row__location">{isHome ? "vs" : "@"}</span>
        <TeamLogo team={opponent} school={opponentSchool} size="sm" />
        <TeamLink team={opponent} className="schedule-row__opponent">
          {opponent.name}
        </TeamLink>
      </div>
      <div
        className={
          "schedule-row__result " +
          (won ? "schedule-row__result--win" : lost ? "schedule-row__result--loss" : "")
        }
      >
        {isFinal ? (
          <>
            <span className="schedule-row__outcome">
              {won ? "W" : lost ? "L" : "·"}
            </span>
            <span className="schedule-row__score">
              {own}-{opp}
            </span>
          </>
        ) : (
          <span className="schedule-row__time">{formatGameTime(game.date)}</span>
        )}
      </div>
      {recap && <p className="schedule-row__recap">{recap}</p>}
    </li>
  );
}
