import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchDataset } from "../data/fetchDataset.js";
import { indexSchools, schoolFor, primaryColor, initials } from "../utils/schools.js";
import { isKnownSport, configFor } from "../config/sports.js";
import { formatGameDay, formatGameDate } from "../utils/dates.js";

/**
 * Standalone 1200x630 game-card route used by the OG-image generator.
 * Playwright navigates to /#/card/<sport>/<gameId>, waits for
 * `[data-og-ready]`, and screenshots `.og-card`.
 *
 * No widget chrome — this route bypasses Layout so the screenshot only
 * captures the card. Self-contained styles inlined to keep the asset
 * stable when global styles change.
 */
export default function OgCardPage() {
  const { sport, gameId } = useParams();
  const [dataset, setDataset] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isKnownSport(sport)) {
      setError(`Unknown sport: ${sport}`);
      return;
    }
    fetchDataset(sport)
      .then(setDataset)
      .catch((e) => setError(e.message));
  }, [sport]);

  if (error) {
    return <CardError message={error} />;
  }
  if (!dataset) {
    return <CardLoading />;
  }

  const game = dataset.games.find((g) => g.id === gameId);
  if (!game) {
    return <CardError message={`Game not found: ${gameId}`} />;
  }

  const schoolIndex = indexSchools(dataset.schools, dataset.games);
  const sportConfig = configFor(sport);

  return <Card game={game} schoolIndex={schoolIndex} sportConfig={sportConfig} />;
}

function Card({ game, schoolIndex, sportConfig }) {
  const awaySchool = schoolFor(game.away, schoolIndex);
  const homeSchool = schoolFor(game.home, schoolIndex);
  const isFinal = game.status === "final";
  const isLive = game.status === "in_progress";
  const awayScore = game.away.score;
  const homeScore = game.home.score;
  const awayWon = isFinal && (awayScore ?? -1) > (homeScore ?? -1);
  const homeWon = isFinal && (homeScore ?? -1) > (awayScore ?? -1);

  const statusLabel = isLive
    ? "LIVE"
    : isFinal
      ? "FINAL"
      : "UP NEXT";

  return (
    <div className="og-card" data-og-ready="true">
      <header className="og-card__header">
        <span className="og-card__brand">CENTRAL WISCONSIN PREP SPORTS</span>
        <span className="og-card__sport">
          <span className="og-card__sport-icon" aria-hidden="true">
            {sportConfig.icon ?? ""}
          </span>
          {sportConfig.label}
        </span>
      </header>

      <div className="og-card__matchup">
        <Side
          team={game.away}
          school={awaySchool}
          score={awayScore}
          won={awayWon}
          showScore={isFinal || isLive}
        />
        <div className="og-card__center">
          <span className={`og-card__status og-card__status--${game.status}`}>
            {statusLabel}
          </span>
          <span className="og-card__date">
            {formatGameDay(game.date)} · {formatGameDate(game.date)}
          </span>
          {game.playoff_round && (
            <span className="og-card__playoff">{game.playoff_round}</span>
          )}
          {!isFinal && !isLive && (
            <span className="og-card__vs" aria-hidden="true">vs</span>
          )}
        </div>
        <Side
          team={game.home}
          school={homeSchool}
          score={homeScore}
          won={homeWon}
          showScore={isFinal || isLive}
        />
      </div>

      <footer className="og-card__footer">
        <span className="og-card__pub">
          <img
            src={`${import.meta.env.BASE_URL}wpr-logo.png`}
            alt=""
            className="og-card__pub-logo"
          />
          WAUSAU PILOT &amp; REVIEW
        </span>
        <span className="og-card__url">wausaupilotandreview.com</span>
      </footer>
    </div>
  );
}

function Side({ team, school, score, won, showScore }) {
  const color = primaryColor(school) || "#0f172a";
  const logo = team?.logo_url;
  return (
    <div
      className={`og-card__side ${won ? "og-card__side--won" : ""}`}
      style={{ "--team-color": color }}
    >
      <div className="og-card__logo-wrap">
        {logo ? (
          <img className="og-card__logo" src={logo} alt="" />
        ) : (
          <span className="og-card__monogram" style={{ background: color }}>
            {initials(team?.name ?? "")}
          </span>
        )}
      </div>
      <div className="og-card__team-text">
        <div className="og-card__team-name">{team.name}</div>
        {school?.mascot && (
          <div className="og-card__team-mascot">{school.mascot}</div>
        )}
      </div>
      {showScore && (
        <div className="og-card__score">{score ?? "—"}</div>
      )}
    </div>
  );
}

function CardLoading() {
  return (
    <div className="og-card og-card--loading">
      <span>Loading…</span>
    </div>
  );
}

function CardError({ message }) {
  return (
    <div className="og-card og-card--error" data-og-ready="true">
      <strong>OG card error</strong>
      <span>{message}</span>
    </div>
  );
}
