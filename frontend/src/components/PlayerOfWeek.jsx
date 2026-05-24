import { useMemo } from "react";
import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";
import { pickPlayerOfWeek } from "../utils/playerOfWeek.js";
import { initials, primaryColor } from "../utils/schools.js";
import { useSportPrefix } from "../utils/links.js";

/**
 * Player of the Week — highlights the standout performance from the
 * most recent week of play. Hidden when no qualifying line exists, so
 * quiet weeks don't field a halfhearted card.
 */
export default function PlayerOfWeek({ games, schoolIndex, sponsors, sportConfig }) {
  const pick = useMemo(() => pickPlayerOfWeek(games), [games]);
  const sportPrefix = useSportPrefix();
  if (!pick) return null;

  const { line, game, schoolId } = pick;
  const school = schoolIndex.get(schoolId);
  const opponent = game.home.school_id === schoolId ? game.away : game.home;
  const ownScore = game.home.school_id === schoolId ? game.home.score : game.away.score;
  const oppScore = game.home.school_id === schoolId ? game.away.score : game.home.score;
  const won = (ownScore ?? -1) > (oppScore ?? -1);
  const isHome = game.home.school_id === schoolId;
  const dateLabel = new Date(game.date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const schoolColor = school ? primaryColor(school) : null;
  const cardStyle = schoolColor ? { "--school-color": schoolColor } : undefined;
  const formatted = sportConfig?.stats?.gameLine?.format?.(line, { tone: "default" }) ?? null;

  return (
    <section className="potw" aria-label="Player of the Week" style={cardStyle}>
      <header className="potw__header">
        <span className="potw__eyebrow">Player of the Week</span>
        <Sponsor slot="potw" sponsors={sponsors} variant="inline" />
      </header>

      <div className="potw__body">
        <div className="potw__avatar" aria-hidden="true">
          {school?.logo_url ? (
            <img
              src={school.logo_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="potw__avatar-logo"
            />
          ) : (
            initials(line.player_name)
          )}
        </div>

        <div className="potw__meta">
          <h3 className="potw__name">
            {line.player_name}
            {line.player_year && (
              <span className="potw__year"> ({line.player_year})</span>
            )}
            {line.position && (
              <span className="potw__pos">{line.position}</span>
            )}
          </h3>
          <Link
            to={`${sportPrefix}/team/${schoolId}`}
            className="potw__school"
          >
            {school?.name ?? schoolId}
            {school?.mascot && (
              <span className="potw__mascot"> · {school.mascot}</span>
            )}
          </Link>
          {formatted && <p className="potw__line">{formatted}</p>}
        </div>

        <Link to={`${sportPrefix}/game/${game.id}`} className="potw__game">
          <span className="potw__game-result">
            {won ? "W" : "L"} {ownScore}-{oppScore}
          </span>
          <span className="potw__game-opp">
            {isHome ? "vs" : "@"} {opponent.name}
          </span>
          <span className="potw__game-date">{dateLabel}</span>
        </Link>
      </div>
    </section>
  );
}
