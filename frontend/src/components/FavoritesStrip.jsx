import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Sponsor from "./Sponsor.jsx";
import { FINDER_INPUT_ID } from "./SchoolFinder.jsx";
import { useSportPrefix } from "../utils/links.js";
import { formatGameDate, formatGameTime } from "../utils/dates.js";
import { teamGamesFor, summarizeTeam, conferenceStanding } from "../utils/teamSummary.js";
import { useFavorites, toggleFavorite } from "../utils/favorites.js";
import { trackEvent } from "../utils/analytics.js";
import { SITE } from "../config/site.js";

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

  // No favorites yet: a one-line nudge toward the finder instead of
  // nothing. Following is the feature built for this audience, and until
  // now it could only be discovered from a team page the reader had
  // already managed to reach.
  if (cards.length === 0) return <FollowPrompt sportPrefix={sportPrefix} />;

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

const DISMISS_KEY = `${SITE.storagePrefix}-follow-prompt-dismissed`;
const DISMISS_FOR_MS = 30 * 86_400_000;

function readDismissed() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/**
 * First-visit nudge shown where the "Your Teams" strip will appear once
 * the reader follows a school. "Find your school" moves focus into the
 * masthead finder (scrolling it into view on phones); the A–Z link is the
 * no-typing path. "Not now" hides it for 30 days on this device.
 */
function FollowPrompt({ sportPrefix }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const focusFinder = () => {
    trackEvent("follow-prompt", { action: "find" });
    const el = document.getElementById(FINDER_INPUT_ID);
    if (!el) {
      navigate(`${sportPrefix}/teams`);
      return;
    }
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  };
  const dismiss = () => {
    trackEvent("follow-prompt", { action: "dismiss" });
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage blocked — hide for this visit only */
    }
    setDismissed(true);
  };

  return (
    <aside className="follow-prompt" aria-label="Follow your school">
      <span className="follow-prompt__star" aria-hidden="true">
        ☆
      </span>
      <p className="follow-prompt__text">
        <strong>Follow your school.</strong> Their last result and next game pin to the top
        of every sport on this device.
      </p>
      <div className="follow-prompt__actions">
        <button type="button" className="follow-prompt__find" onClick={focusFinder}>
          Find your school
        </button>
        <Link
          to={`${sportPrefix}/teams`}
          className="follow-prompt__all"
          onClick={() => trackEvent("follow-prompt", { action: "index" })}
        >
          All schools A–Z
        </Link>
        <button type="button" className="follow-prompt__dismiss" onClick={dismiss}>
          Not now
        </button>
      </div>
    </aside>
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
