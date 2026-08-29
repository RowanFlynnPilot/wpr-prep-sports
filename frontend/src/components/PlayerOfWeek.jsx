import { useMemo } from "react";
import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";
import { pickPlayerOfWeek, resolveOverridePotw } from "../utils/playerOfWeek.js";
import { homeRegionSchoolIds, initials, primaryColor } from "../utils/schools.js";
import { useSportPrefix } from "../utils/links.js";
import { displayPlayerName, playerProfileHref } from "../utils/players.js";
import { formatGameDayDate } from "../utils/dates.js";

/**
 * Player of the Week — highlights the standout performance from the
 * most recent week of play. Hidden when no qualifying line exists, so
 * quiet weeks don't field a halfhearted card.
 */
export default function PlayerOfWeek({ games, schoolIndex, sponsors, sportConfig, override }) {
  // Editorial radius: the auto-pick only crowns home-region athletes
  // (~60 miles of Wausau via SITE.homeRegionCities). The editor override
  // is exempt — an explicit pick is an editorial decision either way.
  const eligible = useMemo(
    () => homeRegionSchoolIds([...(schoolIndex?.values?.() ?? [])]),
    [schoolIndex],
  );
  const pick = useMemo(
    () =>
      resolveOverridePotw(override, games) ??
      pickPlayerOfWeek(games, { eligibleSchoolIds: eligible.size ? eligible : null }),
    [override, games, eligible],
  );
  const sportPrefix = useSportPrefix();
  if (!pick) return null;

  const { line, game, schoolId } = pick;
  const school = schoolIndex.get(schoolId);
  const opponent = game.home.school_id === schoolId ? game.away : game.home;
  const ownScore = game.home.school_id === schoolId ? game.home.score : game.away.score;
  const oppScore = game.home.school_id === schoolId ? game.away.score : game.home.score;
  const tied = ownScore != null && oppScore != null && ownScore === oppScore;
  const won = !tied && (ownScore ?? -1) > (oppScore ?? -1);
  const isHome = game.home.school_id === schoolId;
  // Pinned to the home zone like every other date on the page — the
  // viewer's locale must not relabel a Friday-night game "Saturday".
  const dateLabel = formatGameDayDate(game.date);

  const schoolColor = school ? primaryColor(school) : null;
  const cardStyle = schoolColor ? { "--school-color": schoolColor } : undefined;
  // Editor-supplied headline wins; otherwise format the algorithmic stat line.
  const formatted =
    line.headline
    ?? sportConfig?.stats?.gameLine?.format?.(line, { tone: "default" })
    ?? null;

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
            <Link
              to={playerProfileHref(sportPrefix, schoolId, line.player_name)}
              className="potw__name-link"
            >
              {displayPlayerName(line.player_name)}
              {line.player_year && (
                <span className="potw__year"> ({line.player_year})</span>
              )}
            </Link>
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
            {won ? "W" : tied ? "T" : "L"} {ownScore}-{oppScore}
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
