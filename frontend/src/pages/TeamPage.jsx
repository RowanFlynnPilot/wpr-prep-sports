import { useMemo } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TeamLink from "../components/TeamLink.jsx";
import Sponsor from "../components/Sponsor.jsx";
import SeasonLeaders from "../components/SeasonLeaders.jsx";
import { formatGameDay, formatGameDate, formatGameTime } from "../utils/dates.js";
import { recapForGame } from "../utils/recap.js";
import { seasonSummary } from "../utils/seasonSummary.js";
import { useSportPrefix } from "../utils/links.js";
import { recordLabels } from "../config/sports.js";

export default function TeamPage({ dataset, schoolIndex, sponsors, sportConfig }) {
  const { schoolId } = useParams();
  const sportPrefix = useSportPrefix();
  const school = schoolIndex.get(schoolId);

  if (!school) {
    return <Navigate to={sportPrefix} replace />;
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

  const summary = useMemo(
    () =>
      seasonSummary({
        teamGames,
        schoolId,
        school,
        schoolsById: schoolIndex,
        seasonStatsForSchool,
        sportConfig,
      }),
    [teamGames, schoolId, school, schoolIndex, seasonStatsForSchool, sportConfig],
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
      <Link to={sportPrefix}>All Teams</Link>
      <span aria-hidden="true"> › </span>
      <span>{school.name}</span>
    </>
  );

  // School color emitted as a CSS variable so the hero rail picks up
  // each team's primary color, falling back gracefully to muted gray
  // when the manifest doesn't have one.
  const schoolColor = school?.colors?.[0] ?? null;
  const heroStyle = schoolColor ? { "--school-color": schoolColor } : undefined;

  return (
    <Layout breadcrumb={breadcrumb} sponsors={sponsors}>
      <section
        className={"team-hero" + (schoolColor ? " team-hero--colored" : "")}
        style={heroStyle}
      >
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
            <span className="record-stat__num">
              {record.regWins}-{record.regLosses}
            </span>
            <span className="record-stat__label">
              {record.playedPlayoffs ? "Regular" : "Overall"}
            </span>
          </div>
          {record.playedPlayoffs && (
            <div className="record-stat">
              <span className="record-stat__num">
                {record.postWins}-{record.postLosses}
              </span>
              <span className="record-stat__label">Playoffs</span>
            </div>
          )}
          {record.pointsFor > 0 && (() => {
            const labels = recordLabels(sportConfig);
            return (
              <>
                <div className="record-stat">
                  <span className="record-stat__num">{record.pointsFor.toLocaleString("en-US")}</span>
                  <span className="record-stat__label">{labels.for}</span>
                </div>
                <div className="record-stat">
                  <span className="record-stat__num">{record.pointsAgainst.toLocaleString("en-US")}</span>
                  <span className="record-stat__label">{labels.against}</span>
                </div>
              </>
            );
          })()}
        </div>
      </section>

      {summary && (
        <section className="season-summary" aria-label="Season summary">
          <span className="season-summary__label">Season Summary</span>
          <p className="season-summary__body">{summary}</p>
        </section>
      )}

      <section>
        <div className="section-header">
          <h2>{sportConfig.season} Schedule</h2>
          <span className="section-header__hint">
            {sportConfig.label} · {teamGames.length} games
          </span>
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
                sportPrefix={sportPrefix}
                sportConfig={sportConfig}
              />
            ))}
          </ol>
        )}
      </section>

      <SeasonLeaders rows={seasonStatsForSchool} sportConfig={sportConfig} />

      <Sponsor slot={`school:${schoolId}`} sponsors={sponsors} variant="card" />
    </Layout>
  );
}

function computeRecord(games, schoolId) {
  let wins = 0, losses = 0, pf = 0, pa = 0;
  let regWins = 0, regLosses = 0;
  let postWins = 0, postLosses = 0;
  for (const g of games) {
    if (g.status !== "final") continue;
    const isHome = g.home.school_id === schoolId;
    const own = isHome ? g.home.score : g.away.score;
    const opp = isHome ? g.away.score : g.home.score;
    if (own == null || opp == null) continue;
    pf += own;
    pa += opp;
    const won = own > opp;
    if (won) wins++;
    else losses++;
    if (g.playoff) {
      if (won) postWins++;
      else postLosses++;
    } else {
      if (won) regWins++;
      else regLosses++;
    }
  }
  const playedPlayoffs = postWins + postLosses > 0;
  return {
    wins,
    losses,
    regWins,
    regLosses,
    postWins,
    postLosses,
    playedPlayoffs,
    pointsFor: pf,
    pointsAgainst: pa,
  };
}

function ScheduleRow({ game, index, schoolId, schoolIndex, allTeamGames, sportPrefix, sportConfig }) {
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
    contextGames: allTeamGames,
    sportConfig,
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
      <Link
        to={`${sportPrefix}/game/${game.id}`}
        className={
          "schedule-row__result schedule-row__result--link " +
          (won ? "schedule-row__result--win" : lost ? "schedule-row__result--loss" : "")
        }
        aria-label={`Game details${isFinal ? `, final ${own}-${opp}` : ""}`}
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
      </Link>
      {recap && <p className="schedule-row__recap">{recap}</p>}
    </li>
  );
}
