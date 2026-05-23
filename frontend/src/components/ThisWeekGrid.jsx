import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import { schoolFor } from "../utils/schools.js";
import { groupByDay } from "../utils/weeks.js";
import { formatGameDay, formatGameDate, formatGameTime } from "../utils/dates.js";
import { playerLineForGame } from "../utils/recap.js";
import { useSportPrefix } from "../utils/links.js";

/**
 * A day-by-day schedule for the featured week. Football clusters
 * Thursday/Friday/Saturday, so a vertical "day → games" layout reads
 * naturally. Each game row is dense: logos, names, time, score/result.
 */
export default function ThisWeekGrid({ week, schoolIndex, allGames = [] }) {
  if (!week || week.games.length === 0) {
    return (
      <div className="week week--empty">
        <p>No games this week.</p>
      </div>
    );
  }

  const groups = groupByDay(week.games);

  return (
    <div className="week">
      {groups.map(([day, games]) => (
        <section key={day} className="week-day">
          <header className="week-day__header">
            <h3 className="week-day__name">{formatGameDay(games[0].date)}</h3>
            <span className="week-day__date">{formatGameDate(games[0].date)}</span>
            <span className="week-day__count">
              {games.length} game{games.length === 1 ? "" : "s"}
            </span>
          </header>

          <ul className="week-day__games">
            {games.map((g) => (
              <GameRow
                key={g.id}
                game={g}
                schoolIndex={schoolIndex}
                allGames={allGames}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GameRow({ game, schoolIndex, allGames }) {
  const sportPrefix = useSportPrefix();
  const homeSchool = schoolFor(game.home, schoolIndex);
  const awaySchool = schoolFor(game.away, schoolIndex);
  const isFinal = game.status === "final";

  const homeWon = isFinal && (game.home.score ?? -1) > (game.away.score ?? -1);
  const awayWon = isFinal && (game.away.score ?? -1) > (game.home.score ?? -1);
  const playerLine = playerLineForGame(game, { contextGames: allGames });

  return (
    <li className="game-row">
      <Side
        team={game.away}
        school={awaySchool}
        score={game.away.score}
        won={awayWon}
        showScore={isFinal}
      />
      <span className="game-row__at">at</span>
      <Side
        team={game.home}
        school={homeSchool}
        score={game.home.score}
        won={homeWon}
        showScore={isFinal}
      />
      <Link to={`${sportPrefix}/game/${game.id}`} className="game-row__status game-row__details">
        {isFinal ? "Final" : formatGameTime(game.date)}
        <span aria-hidden="true"> ›</span>
      </Link>
      {playerLine && <p className="game-row__recap">{playerLine}</p>}
    </li>
  );
}

function Side({ team, school, score, won, showScore }) {
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
