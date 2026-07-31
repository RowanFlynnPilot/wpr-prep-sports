import { useMemo } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Sponsor from "./Sponsor.jsx";
import { useSportPrefix } from "../utils/links.js";
import { formatGameDate, formatGameTime } from "../utils/dates.js";
import { teamGamesFor, summarizeTeam, conferenceStanding } from "../utils/teamSummary.js";
import { useFavorites, toggleFavorite } from "../utils/favorites.js";
import { trackEvent } from "../utils/analytics.js";

/**
 * "Your Teams" — the pinned strip above the dashboard.
 *
 * Favorites are stored per school and cross-sport, so this renders each
 * favorite through the *currently loaded* sport: pin Wausau East once and
 * the card follows them into basketball in November. A favorite that
 * doesn't field a team in this sport is shown greyed rather than dropped,
 * so the list doesn't appear to lose schools when you switch sports.
 *
 * Renders nothing at all when no favorites are set — the default dashboard
 * is unchanged for a first-time reader.
 */
export default function FavoritesStrip({ dataset, schoolIndex, sponsors, sportConfig, now }) {
  const favorites = useFavorites();
  const sportPrefix = useSportPrefix();

  const cards = useMemo(
    () =>
      favorites.map((schoolId) => {
        const school = schoolIndex?.get?.(schoolId) ?? null;
        if (!school) return null; // left the manifest — ignore quietly
        const games = teamGamesFor(dataset.games, schoolId);
        const standing = conferenceStanding(school, dataset.sport, dataset.standings, schoolId);
        return {
          schoolId,
          school,
          // Whether the school FIELDS a team comes from the manifest, not
          // from the games we happen to hold: mid-rollover a sport can have
          // an empty dataset, and telling a Wausau East parent their school
          // has no soccer team because WIAA hasn't posted the schedule yet
          // is both wrong and trust-destroying.
          playsThisSport: Boolean(standing),
          hasGames: games.length > 0,
          summary: summarizeTeam(games, schoolId, now ? { now } : undefined),
          standing,
        };
      }).filter(Boolean),
    [favorites, schoolIndex, dataset.games, dataset.sport, dataset.standings, now],
  );

  if (cards.length === 0) return null;

  return (
    <section className="favstrip" aria-label="Your teams">
      <div className="favstrip__head">
        <h2 className="favstrip__title">Your Teams</h2>
        <span className="favstrip__hint">
          {sportConfig.label} · pinned to the top of every sport
        </span>
      </div>

      <ul className="favstrip__list">
        {cards.map((c) => (
          <FavoriteCard
            key={c.schoolId}
            {...c}
            sportPrefix={sportPrefix}
            sponsors={sponsors}
            sportConfig={sportConfig}
          />
        ))}
      </ul>
    </section>
  );
}

function FavoriteCard({
  schoolId,
  school,
  playsThisSport,
  hasGames,
  summary,
  standing,
  sportPrefix,
  sponsors,
  sportConfig,
}) {
  const color = school.colors?.[0];
  const teamHref = `${sportPrefix}/team/${schoolId}`;
  const sportLabel = sportConfig.label.toLowerCase();

  // Three distinct states, deliberately worded apart:
  //   record   — the season is under way
  //   pending  — they play this sport, but no schedule/results yet
  //   absent   — the school doesn't field a team at all
  const subtitle = !playsThisSport
    ? `No ${sportLabel} team`
    : !hasGames
      ? "Schedule not posted yet"
      : summary.hasSeasonStarted
        ? `${summary.wins}-${summary.losses}${summary.ties > 0 ? `-${summary.ties}` : ""}${
            standing?.rank ? ` · #${standing.rank} of ${standing.size}` : ""
          }`
        : standing?.conference ?? sportConfig.label;

  return (
    <li
      className={"favcard" + (hasGames ? "" : " favcard--inactive")}
      style={color ? { "--school-color": color } : undefined}
      data-school={schoolId}
    >
      <button
        type="button"
        className="favcard__remove"
        onClick={() => {
          toggleFavorite(schoolId);
          trackEvent("favorite-remove", { school: schoolId });
        }}
        aria-label={`Unfollow ${school.name}`}
        title="Unfollow"
      >
        ×
      </button>

      <Link to={teamHref} className="favcard__main">
        <TeamLogo team={{ school_id: schoolId, name: school.name }} school={school} size="md" />
        <div className="favcard__meta">
          <span className="favcard__name">{school.name}</span>
          <span className="favcard__sub">{subtitle}</span>
        </div>
      </Link>

      {hasGames && (summary.nextGame || summary.lastGame) && (
        <GameLine
          game={summary.nextGame ?? summary.lastGame}
          isNext={Boolean(summary.nextGame)}
          schoolId={schoolId}
          sportPrefix={sportPrefix}
        />
      )}

      {hasGames && summary.form.length > 0 && (
        <div className="favcard__form" aria-label="Recent form">
          {summary.form.map((r, i) => (
            <span key={i} className={`favcard__form-mark favcard__form-mark--${r.toLowerCase()}`}>
              {r}
            </span>
          ))}
        </div>
      )}

      <Sponsor
        slot={`school:${schoolId}`}
        sponsors={sponsors}
        variant="inline"
        className="favcard__sponsor"
      />
    </li>
  );
}

function GameLine({ game, isNext, schoolId, sportPrefix }) {
  const isHome = game.home.school_id === schoolId;
  const us = isHome ? game.home : game.away;
  const them = isHome ? game.away : game.home;
  const isFinal = game.status === "final";
  const won = isFinal && (us.score ?? -1) > (them.score ?? -1);
  const tied = isFinal && us.score != null && us.score === them.score;

  return (
    <Link to={`${sportPrefix}/game/${game.id}`} className="favcard__game">
      <span className="favcard__game-label">{isNext ? "Next" : "Last"}</span>
      <span className="favcard__game-detail">
        {isHome ? "vs" : "at"} {them.name}
        {isFinal ? (
          <strong className={won ? "favcard__won" : tied ? "favcard__tied" : "favcard__lost"}>
            {" "}
            {won ? "W" : tied ? "T" : "L"} {us.score}–{them.score}
          </strong>
        ) : (
          <span className="favcard__when">
            {" "}
            · {formatGameDate(game.date)} · {formatGameTime(game.date)}
          </span>
        )}
      </span>
    </Link>
  );
}
