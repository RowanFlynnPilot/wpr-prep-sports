import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import { schoolFor } from "../utils/schools.js";
import { formatGameShortDay, formatGameDate } from "../utils/dates.js";
import { playerLineForGame } from "../utils/recap.js";

/**
 * Horizontal scrollable ticker of recent + tonight games. Each card surfaces
 * the most important info: date, both team logos+names, scores, status.
 */
export default function ScoreTicker({ games, schoolIndex }) {
  if (!games || games.length === 0) {
    return (
      <div className="ticker ticker--empty">
        <p>No games in the last week. Friday Night Lights returns soon.</p>
      </div>
    );
  }

  return (
    <div className="ticker">
      <div className="ticker__track">
        {games.map((g) => (
          <GameCard key={g.id} game={g} schoolIndex={schoolIndex} />
        ))}
      </div>
    </div>
  );
}

function GameCard({ game, schoolIndex }) {
  const homeSchool = schoolFor(game.home, schoolIndex);
  const awaySchool = schoolFor(game.away, schoolIndex);
  const isFinal = game.status === "final";

  const homeScore = game.home.score;
  const awayScore = game.away.score;
  const homeWon = isFinal && (homeScore ?? -1) > (awayScore ?? -1);
  const awayWon = isFinal && (awayScore ?? -1) > (homeScore ?? -1);
  const playerLine = playerLineForGame(game);

  return (
    <article className="card">
      <header className="card__header">
        <span className="card__day">{formatGameShortDay(game.date)}</span>
        <span className="card__date">{formatGameDate(game.date)}</span>
        <span className={`card__status card__status--${game.status}`}>
          {isFinal ? "Final" : game.status === "in_progress" ? "Live" : "Upcoming"}
        </span>
      </header>

      <ul className="card__teams">
        <Row team={game.away} school={awaySchool} score={awayScore} won={awayWon} showScore={isFinal} />
        <Row team={game.home} school={homeSchool} score={homeScore} won={homeWon} showScore={isFinal} />
      </ul>

      {playerLine && (
        <p className="card__recap" title={playerLine}>
          {playerLine}
        </p>
      )}
    </article>
  );
}

function Row({ team, school, score, won, showScore }) {
  return (
    <li className={`card__team ${won ? "card__team--won" : ""}`}>
      <TeamLogo team={team} school={school} size="sm" />
      <TeamLink team={team} className="card__team-name">
        {team.name}
      </TeamLink>
      <span className="card__team-score">
        {showScore ? (score ?? "—") : ""}
      </span>
    </li>
  );
}
