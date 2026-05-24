import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { groupPlayoffGames, gameHasTrackedTeam } from "../utils/bracket.js";
import { useSportPrefix } from "../utils/links.js";

/**
 * Playoff bracket — rounds rendered as horizontal columns from
 * earliest-left to latest-right. Each column is a vertical list of
 * game cards. Tracked-team games are highlighted.
 *
 * "Show area only" toggle filters to games involving at least one
 * tracked school so the central-WI view isn't drowned in unrelated
 * state-wide playoffs.
 */
export default function TournamentBracket({ games }) {
  const allRounds = useMemo(() => groupPlayoffGames(games), [games]);
  const [areaOnly, setAreaOnly] = useState(true);

  const rounds = useMemo(() => {
    if (!areaOnly) return allRounds;
    return allRounds
      .map((r) => ({
        round: r.round,
        games: r.games.filter(gameHasTrackedTeam),
      }))
      .filter((r) => r.games.length > 0);
  }, [allRounds, areaOnly]);

  if (allRounds.length === 0) return null;

  const totalArea = allRounds.reduce(
    (acc, r) => acc + r.games.filter(gameHasTrackedTeam).length,
    0,
  );
  const totalAll = allRounds.reduce((acc, r) => acc + r.games.length, 0);

  return (
    <div className="bracket">
      <div className="bracket__toolbar">
        <span className="bracket__meta">
          {areaOnly
            ? `${totalArea} game${totalArea === 1 ? "" : "s"} involving central-WI schools`
            : `${totalAll} playoff games statewide`}
        </span>
        <label className="bracket__toggle">
          <input
            type="checkbox"
            checked={areaOnly}
            onChange={(e) => setAreaOnly(e.target.checked)}
          />
          <span>Central WI only</span>
        </label>
      </div>

      {rounds.length === 0 ? (
        <p className="bracket__empty">No central-WI playoff games to show.</p>
      ) : (
        <div className="bracket__columns">
          {rounds.map(({ round, games: roundGames }) => (
            <div key={round} className="bracket__col">
              <div className="bracket__col-header">
                <h4>{round}</h4>
                <span className="bracket__col-count">{roundGames.length}</span>
              </div>
              <ol className="bracket__games">
                {roundGames.map((g) => (
                  <BracketGame key={g.id} game={g} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BracketGame({ game }) {
  const sportPrefix = useSportPrefix();
  const isFinal = game.status === "final";
  const homeScore = game.home.score;
  const awayScore = game.away.score;
  const homeWon = isFinal && (homeScore ?? -1) > (awayScore ?? -1);
  const awayWon = isFinal && (awayScore ?? -1) > (homeScore ?? -1);
  const tracked = gameHasTrackedTeam(game);

  return (
    <li className={"bracket-game" + (tracked ? " bracket-game--tracked" : "")}>
      <Link to={`${sportPrefix}/game/${game.id}`} className="bracket-game__link">
        <Side
          name={game.away.name}
          score={awayScore}
          won={awayWon}
          tracked={!!game.away.school_id}
          isFinal={isFinal}
        />
        <Side
          name={game.home.name}
          score={homeScore}
          won={homeWon}
          tracked={!!game.home.school_id}
          isFinal={isFinal}
        />
        <span className="bracket-game__date">
          {new Date(game.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </Link>
    </li>
  );
}

function Side({ name, score, won, tracked, isFinal }) {
  const cls = [
    "bracket-game__side",
    won ? "bracket-game__side--won" : "",
    tracked ? "bracket-game__side--tracked" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className="bracket-game__team">{name}</span>
      <span className="bracket-game__score">
        {isFinal ? (score ?? "—") : ""}
      </span>
    </div>
  );
}
