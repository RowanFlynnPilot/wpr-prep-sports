import { Component, useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo.jsx";
import Sponsor from "../components/Sponsor.jsx";
import Icon from "../components/Icon.jsx";
import { fetchMiniDataset } from "../data/fetchDataset.js";
import { configFor } from "../config/sports.js";
import { SITE } from "../config/site.js";
import { formatGameDayDate, formatGameShortDay, formatGameTime } from "../utils/dates.js";
import { indexSchools } from "../utils/schools.js";
import { useFavorites } from "../utils/favorites.js";
import { isEmbedded, useIframeHeightReporter } from "../utils/iframe.js";
import { trackEvent, useAnalytics } from "../utils/analytics.js";
import { readMiniParams } from "./params.js";
import { MINI_RESULTS, MINI_UPCOMING, selectMiniGames } from "./selectGames.js";

/**
 * The mini scoreboard — a compact, fixed-height module for the publisher's
 * homepage and sidebars (mini.html, its own lightweight entry: no router,
 * no dashboard bundle, and the few-KB mini.json feed instead of a season
 * of games).
 *
 * Every tap goes to the publisher page that embeds the full widget
 * (SITE.hubUrl, or ?to=), in the top frame, so a homepage reader stays on
 * the publisher's site. The mini keeps no deep links: that page's iframe
 * src is fixed, so a game-specific URL would land on the dashboard anyway.
 */

const LIVE_REFRESH_MS = 60_000;
const SPORT_KEY = `${SITE.storagePrefix}-mini-sport`;

function readStoredSport(allowed) {
  try {
    const id = window.localStorage.getItem(SPORT_KEY);
    return id && allowed.includes(id) ? id : null;
  } catch {
    return null;
  }
}

function storeSport(id) {
  try {
    window.localStorage.setItem(SPORT_KEY, id);
  } catch {
    /* storage blocked — the choice lasts this visit only */
  }
}

export default function MiniScoreboard() {
  const params = useMemo(() => readMiniParams(window.location.search), []);
  const { sports, destination } = params;
  // A reader who switched to volleyball last visit opens on volleyball.
  const [sport, setSport] = useState(
    () => (sports.length > 0 && readStoredSport(sports)) || params.sport,
  );
  const [load, setLoad] = useState({ status: "loading", data: null });
  // Sponsors are cross-sport: kept across a sport switch so the presenter
  // strip doesn't blink out while the next sport loads.
  const [sponsors, setSponsors] = useState(null);

  useIframeHeightReporter();
  useAnalytics();

  useEffect(() => {
    if (load.data?.sponsors) setSponsors(load.data.sponsors);
  }, [load.data]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading", data: null });
    fetchMiniDataset(sport)
      .then((data) => !cancelled && setLoad({ status: "ready", data }))
      .catch((error) => {
        if (cancelled) return;
        console.warn(`[${SITE.messageNamespace}] mini load failed:`, error);
        setLoad({ status: "error", data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [sport]);

  // Friday night: re-fetch every minute while anything is live. A failed
  // refresh keeps the last good scores on screen.
  const hasLive = (load.data?.games ?? []).some((g) => g.status === "in_progress");
  useEffect(() => {
    if (!hasLive) return;
    let cancelled = false;
    const id = setInterval(() => {
      fetchMiniDataset(sport)
        .then((data) => !cancelled && setLoad({ status: "ready", data }))
        .catch(() => {});
    }, LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hasLive, sport]);

  const chooseSport = (id) => {
    if (id === sport) return;
    storeSport(id);
    trackEvent("mini-sport", { sport: id });
    setSport(id);
  };

  const cfg = configFor(sport);

  return (
    <div
      className={"mini" + (isEmbedded ? " mini--fill" : "")}
      data-sport={sport}
      aria-busy={load.status === "loading"}
    >
      <header className="mini__head">
        <a
          className="mini__brand"
          href={destination}
          target="_top"
          onClick={() => trackEvent("mini-click", { sport, target: "brand" })}
        >
          {SITE.titleLead} <em>{SITE.titleEm}</em>
        </a>
        {sports.length === 0 && <span className="mini__sport">{cfg.label}</span>}
      </header>

      {/* "Scoreboard presented by" attaches to the title, one line under
          it: the most visible spot for the sponsor, and a fixed-height row
          (a footer credit wrapped to three lines at 300px and broke the
          published iframe height). Renders nothing while unsold. */}
      {sponsors && (
        <Sponsor slot="mini" sponsors={sponsors} variant="inline" className="mini__presenter" />
      )}

      {sports.length > 0 && (
        <div className="mini__sports" role="group" aria-label="Sport">
          {sports.map((id) => {
            const c = configFor(id);
            return (
              <button
                key={id}
                type="button"
                className={"mini__sport-btn" + (id === sport ? " mini__sport-btn--on" : "")}
                aria-pressed={id === sport}
                onClick={() => chooseSport(id)}
              >
                <span className="mini__sport-icon" aria-hidden="true">
                  <Icon name={id} />
                </span>
                <span className="mini__sport-label">{c.shortLabel ?? c.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mini__body">
        {load.status === "loading" && <MiniSkeleton />}
        {load.status === "error" && (
          <p className="mini__empty">
            Scores are taking a moment to load. The full scoreboard is one tap away.
          </p>
        )}
        {load.status === "ready" && (
          <MiniGames data={load.data} sport={sport} destination={destination} />
        )}
      </div>

      <footer className="mini__foot">
        <a
          className="mini__cta"
          href={destination}
          target="_top"
          onClick={() => trackEvent("mini-click", { sport, target: "cta" })}
        >
          All scores &amp; standings <span aria-hidden="true">›</span>
        </a>
      </footer>
    </div>
  );
}

function MiniGames({ data, sport, destination }) {
  const favorites = useFavorites();
  const schoolIndex = useMemo(() => indexSchools(data.schools, data.games), [data]);
  // School id → position of its city in SITE.homeRegionCities (Wausau
  // first). Membership is "home region"; the number is nearness.
  const cityRank = useMemo(() => {
    const cities = (SITE.homeRegionCities ?? []).map((c) => c.trim().toLowerCase());
    const rank = new Map();
    for (const s of data.schools ?? []) {
      const i = cities.indexOf((s.city ?? "").trim().toLowerCase());
      if (i >= 0) rank.set(s.id, i);
    }
    return rank;
  }, [data.schools]);
  const picked = useMemo(
    () => selectMiniGames(data.games, { now: Date.now(), cityRank, followedIds: favorites }),
    [data.games, cityRank, favorites],
  );
  const cfg = configFor(sport);
  const onGame = () => trackEvent("mini-click", { sport, target: "game" });

  if (picked.results.length === 0 && picked.upcoming.length === 0) {
    return <p className="mini__empty">{emptyCopy(cfg)}</p>;
  }

  const resultsLabel =
    picked.liveCount === picked.results.length
      ? "Live now"
      : picked.liveCount > 0
        ? "Live & latest"
        : picked.resultsDay
          ? `${formatGameDayDate(picked.resultsDay)} · Final`
          : "Latest scores";
  const upcomingLabel = picked.upcomingDay
    ? `${picked.results.length === 0 ? "Coming up" : "Up next"} · ${formatGameDayDate(picked.upcomingDay)}`
    : picked.results.length === 0
      ? "Coming up"
      : "Up next";

  return (
    <>
      {picked.results.length > 0 && (
        <section className="mini__section" aria-labelledby="mini-results">
          <h2 id="mini-results" className="mini__label">
            {resultsLabel}
          </h2>
          <ul className="mini__list">
            {picked.results.map((g) => (
              <li key={g.id}>
                <ResultCard
                  game={g}
                  schoolIndex={schoolIndex}
                  showDay={!picked.resultsDay}
                  href={destination}
                  onClick={onGame}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {picked.upcoming.length > 0 && (
        <section className="mini__section" aria-labelledby="mini-upcoming">
          <h2 id="mini-upcoming" className="mini__label">
            {upcomingLabel}
          </h2>
          <ul className="mini__list">
            {picked.upcoming.map((g) => (
              <li key={g.id}>
                <FixtureRow
                  game={g}
                  showDay={!picked.upcomingDay}
                  href={destination}
                  onClick={onGame}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ResultCard({ game, schoolIndex, showDay, href, onClick }) {
  const live = game.status === "in_progress";
  const { home, away } = game;
  const hasScore = home.score != null && away.score != null;
  const homeWon = !live && hasScore && home.score > away.score;
  const awayWon = !live && hasScore && away.score > home.score;
  // The section label already says "Friday, Sep 11 · Final" when every card
  // shares it; a status column then only repeats it and costs name width.
  const status = live ? "Live" : showDay ? formatGameShortDay(game.date) : null;
  const label = hasScore
    ? `${away.name} ${away.score}, ${home.name} ${home.score}, ${
        live ? "in progress" : `final${showDay ? `, ${formatGameDayDate(game.date)}` : ""}`
      }`
    : `${away.name} at ${home.name}, in progress`;

  return (
    <a
      className={
        "mini-game" + (live ? " mini-game--live" : "") + (status ? "" : " mini-game--plain")
      }
      href={href}
      target="_top"
      aria-label={label}
      onClick={onClick}
    >
      <TeamLine team={away} won={awayWon} schoolIndex={schoolIndex} />
      <TeamLine team={home} won={homeWon} schoolIndex={schoolIndex} />
      {status && (
        <span className="mini-game__status" aria-hidden="true">
          {live && <span className="mini-game__dot" />}
          {status}
        </span>
      )}
    </a>
  );
}

function TeamLine({ team, won, schoolIndex }) {
  const school = team.school_id ? schoolIndex.get(team.school_id) : null;
  return (
    <span className={"mini-game__team" + (won ? " mini-game__team--won" : "")} aria-hidden="true">
      <TeamLogo team={team} school={school} size="xs" />
      <span className="mini-game__name" title={team.name}>
        {team.name}
      </span>
      <span className="mini-game__score">{team.score ?? ""}</span>
    </span>
  );
}

function FixtureRow({ game, showDay, href, onClick }) {
  const time = formatGameTime(game.date);
  const when = showDay ? `${formatGameShortDay(game.date)} ${time}` : time;
  return (
    <a
      className="mini-next"
      href={href}
      target="_top"
      aria-label={`${game.away.name} at ${game.home.name}, ${
        showDay ? formatGameDayDate(game.date) : ""
      } ${time}`.replace(/\s+/g, " ")}
      onClick={onClick}
    >
      <span className="mini-next__matchup" aria-hidden="true" title={`${game.away.name} at ${game.home.name}`}>
        {game.away.name} <span className="mini-next__at">at</span> {game.home.name}
      </span>
      <span className="mini-next__when" aria-hidden="true">
        {when}
      </span>
    </a>
  );
}

/** Between seasons, or a quiet stretch with nothing inside the windows. */
function emptyCopy(cfg) {
  const opener = cfg.nextSeasonStart ? new Date(`${cfg.nextSeasonStart}T12:00:00-05:00`) : null;
  if (opener && opener.getTime() > Date.now()) {
    return `${cfg.label} is between seasons. The next season opens ${formatGameDayDate(
      opener.toISOString(),
    )}.`;
  }
  return `No ${cfg.label.toLowerCase()} games on the schedule this week.`;
}

/** Same footprint as a full mini, so nothing jumps when the scores land. */
function MiniSkeleton() {
  return (
    <div className="mini__skeleton" aria-hidden="true">
      <span className="mini__label mini__label--ghost" />
      {Array.from({ length: MINI_RESULTS }, (_, i) => (
        <span key={`r${i}`} className="mini-ghost mini-ghost--card" />
      ))}
      <span className="mini__label mini__label--ghost" />
      {Array.from({ length: MINI_UPCOMING }, (_, i) => (
        <span key={`u${i}`} className="mini-ghost mini-ghost--row" />
      ))}
      <span className="sr-only">Loading scores</span>
    </div>
  );
}

/** A crash inside the mini must not leave a blank hole on the homepage. */
export class MiniBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(`[${SITE.messageNamespace}] mini crashed:`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { destination } = readMiniParams(window.location.search);
    return (
      <div className="mini">
        <header className="mini__head">
          <a className="mini__brand" href={destination} target="_top">
            {SITE.titleLead} <em>{SITE.titleEm}</em>
          </a>
        </header>
        <p className="mini__empty">The scoreboard hit a snag.</p>
        <footer className="mini__foot">
          <a className="mini__cta" href={destination} target="_top">
            All scores &amp; standings <span aria-hidden="true">›</span>
          </a>
        </footer>
      </div>
    );
  }
}
