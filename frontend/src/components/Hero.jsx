import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import { schoolFor } from "../utils/schools.js";
import { formatGameDay, formatGameDate, formatGameTime } from "../utils/dates.js";
import { recapForGame } from "../utils/recap.js";

/**
 * Featured-game hero. Shows the most "important" recent or upcoming game
 * picked by utils/games.pickFeaturedGame. Renders dark, premium, score-first.
 *
 * Off-season variant (offSeason=true): swaps to a countdown card with
 * the next season's opener date + a small "Last game played" tile that
 * surfaces the most recent result. Gives the masthead something
 * intentional to show during the multi-month gap between seasons.
 */
export default function Hero({
  game,
  schoolIndex,
  games = [],
  seasonStats = [],
  offSeason = false,
  sportConfig = null,
  nextSeasonStart = null,
  daysToNext = null,
}) {
  if (offSeason) {
    return (
      <OffSeasonHero
        sportConfig={sportConfig}
        nextSeasonStart={nextSeasonStart}
        daysToNext={daysToNext}
        lastGame={game}
        schoolIndex={schoolIndex}
        games={games}
        seasonStats={seasonStats}
      />
    );
  }

  if (!game) {
    return (
      <section className="hero hero--empty">
        <p className="eyebrow">No games yet this week</p>
        <h2>Check back Friday.</h2>
      </section>
    );
  }

  const homeSchool = schoolFor(game.home, schoolIndex);
  const awaySchool = schoolFor(game.away, schoolIndex);

  const isFinal = game.status === "final";
  const eyebrow = isFinal ? "Final" : game.status === "in_progress" ? "Live" : "Up Next";

  const homeWon = isFinal && (game.home.score ?? 0) > (game.away.score ?? 0);
  const awayWon = isFinal && (game.away.score ?? 0) > (game.home.score ?? 0);

  // Recap is written from the winning side's perspective (or home if tied
  // and both tracked, or whichever side is in our manifest).
  const perspectiveSchoolId = homeWon
    ? game.home.school_id
    : awayWon
    ? game.away.school_id
    : game.home.school_id || game.away.school_id;
  const perspectiveTeamGames = isFinal && perspectiveSchoolId
    ? games.filter(
        (g) =>
          g.home.school_id === perspectiveSchoolId ||
          g.away.school_id === perspectiveSchoolId,
      )
    : null;
  const seasonStatsForPerspective = perspectiveSchoolId
    ? seasonStats.filter((r) => r.school_id === perspectiveSchoolId)
    : null;
  const recap = recapForGame(game, {
    schoolsById: schoolIndex,
    teamGames: perspectiveTeamGames,
    perspectiveSchoolId,
    seasonStatsForSchool: seasonStatsForPerspective,
    enrichWithSeasonTotals: true,
    contextGames: perspectiveTeamGames,
    sportConfig,
  });

  return (
    <section className="hero" aria-label="Featured game">
      <div className="hero__meta">
        <span className="eyebrow eyebrow--accent">{eyebrow}</span>
        <span className="hero__date">
          {formatGameDay(game.date)} · {formatGameDate(game.date)}
          {!isFinal && <> · {formatGameTime(game.date)}</>}
        </span>
        {game.venue && <span className="hero__venue">{game.venue}</span>}
      </div>

      <div className="hero__matchup">
        <TeamRow
          team={game.away}
          school={awaySchool}
          won={awayWon}
          showScore={isFinal}
        />
        <div className="hero__divider" aria-hidden="true">
          <span>vs</span>
        </div>
        <TeamRow
          team={game.home}
          school={homeSchool}
          won={homeWon}
          showScore={isFinal}
        />
      </div>

      {recap && <p className="hero__recap">{recap}</p>}
    </section>
  );
}

const NEXT_START_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

function OffSeasonHero({
  sportConfig,
  nextSeasonStart,
  daysToNext,
  lastGame,
  schoolIndex,
  games,
  seasonStats,
}) {
  const sportLabel = sportConfig?.label ?? "The season";
  const countdownLabel = daysToNext == null
    ? null
    : daysToNext === 0
      ? "Today"
      : daysToNext === 1
        ? "1 day"
        : daysToNext < 30
          ? `${daysToNext} days`
          : `${Math.round(daysToNext / 7)} weeks`;

  const headline = nextSeasonStart
    ? `${sportLabel} returns ${NEXT_START_FMT.format(nextSeasonStart)}`
    : `${sportLabel} season has wrapped`;

  // Last-game recap for the small retro card.
  const lastGameSchool = lastGame
    ? schoolFor(
        lastGame.home.score >= (lastGame.away.score ?? -1) ? lastGame.home : lastGame.away,
        schoolIndex,
      )
    : null;
  const lastRecap = lastGame
    ? recapForGame(lastGame, {
        schoolsById: schoolIndex,
        teamGames: games,
        contextGames: games,
        perspectiveSchoolId:
          lastGame.home.school_id || lastGame.away.school_id,
        sportConfig,
      })
    : null;

  return (
    <section className="hero hero--offseason" aria-label="Off-season hero">
      <div className="hero-off">
        <div className="hero-off__primary">
          <span className="eyebrow eyebrow--accent">Off-season</span>
          <h2 className="hero-off__headline">{headline}</h2>
          {countdownLabel && (
            <div className="hero-off__countdown" aria-label="Time until next season">
              <span className="hero-off__count">{countdownLabel}</span>
              <span className="hero-off__count-label">
                until first whistle
              </span>
            </div>
          )}
          <p className="hero-off__sub">
            Catch up on the {sportConfig?.season ?? "2025–26"} season below —
            standings, full schedules, and game-by-game recaps.
          </p>
        </div>

        {lastGame && (
          <div className="hero-off__last">
            <span className="hero-off__last-label">Last game played</span>
            <p className="hero-off__last-matchup">
              <strong>{lastGame.away.name}</strong>
              {lastGame.away.score != null && (
                <span className="hero-off__last-score">
                  {" "}{lastGame.away.score}
                </span>
              )}
              <span className="hero-off__last-at"> at </span>
              <strong>{lastGame.home.name}</strong>
              {lastGame.home.score != null && (
                <span className="hero-off__last-score">
                  {" "}{lastGame.home.score}
                </span>
              )}
            </p>
            <p className="hero-off__last-date">
              {formatGameDay(lastGame.date)} · {formatGameDate(lastGame.date)}
            </p>
            {lastRecap && (
              <p className="hero-off__last-recap">{lastRecap}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
function TeamRow({ team, school, won, showScore }) {
  const ribbon = team.school_id ? "" : "Visitor";
  return (
    <div className={`hero__team ${won ? "hero__team--won" : ""}`}>
      <TeamLogo team={team} school={school} size="xl" />
      <div className="hero__team-text">
        <h3 className="hero__team-name">
          <TeamLink team={team}>{team.name}</TeamLink>
        </h3>
        {school?.mascot && (
          <p className="hero__team-mascot">{school.mascot}</p>
        )}
        {!school?.mascot && ribbon && (
          <p className="hero__team-mascot hero__team-mascot--muted">{ribbon}</p>
        )}
      </div>
      <div className="hero__score-wrap">
        {showScore && (
          <span className="hero__score">{team.score ?? "—"}</span>
        )}
      </div>
    </div>
  );
}
