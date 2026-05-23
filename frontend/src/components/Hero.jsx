import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import { schoolFor } from "../utils/schools.js";
import { formatGameDay, formatGameDate, formatGameTime } from "../utils/dates.js";

/**
 * Featured-game hero. Shows the most "important" recent or upcoming game
 * picked by utils/games.pickFeaturedGame. Renders dark, premium, score-first.
 */
export default function Hero({ game, schoolIndex }) {
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
