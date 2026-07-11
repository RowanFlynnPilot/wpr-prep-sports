import { useMemo } from "react";
import { useParams } from "react-router-dom";
import TeamLogo from "../components/TeamLogo.jsx";
import Sponsor from "../components/Sponsor.jsx";
import { formatGameDate, formatGameTime } from "../utils/dates.js";
import { SITE, SITE_TITLE } from "../config/site.js";

/**
 * Per-school embed — a compact, chrome-free team module for placing in
 * publisher article bodies and sidebars via iframe:
 *
 *   <iframe src=".../wpr-prep-sports/#/football/embed/wausau-east" ...>
 *
 * Sells as per-school sponsor inventory (the school:<id> slot renders
 * here too), and every module links back to the full widget — each
 * embed placed in a game story is a funnel into the hub. No masthead,
 * no footer, no sport switcher: the host page provides the context.
 * Links open a new tab (the module lives inside someone else's page).
 */
const FULL_WIDGET_URL = SITE.widgetOrigin;

export default function EmbedPage({ dataset, schoolIndex, sportConfig }) {
  const { schoolId } = useParams();
  const school = schoolIndex?.get?.(schoolId) ?? null;

  const teamGames = useMemo(
    () =>
      (dataset.games ?? [])
        .filter(
          (g) => g.home.school_id === schoolId || g.away.school_id === schoolId,
        )
        .sort((a, b) => new Date(a.date) - new Date(b.date)),
    [dataset.games, schoolId],
  );

  const summary = useMemo(() => {
    let wins = 0;
    let losses = 0;
    const form = [];
    let lastGame = null;
    for (const g of teamGames) {
      if (g.status !== "final") continue;
      const isHome = g.home.school_id === schoolId;
      const ours = isHome ? g.home.score : g.away.score;
      const theirs = isHome ? g.away.score : g.home.score;
      if (ours == null || theirs == null) continue;
      if (ours > theirs) wins++;
      else if (theirs > ours) losses++;
      form.push(ours > theirs ? "W" : "L");
      lastGame = g;
    }
    const now = Date.now();
    const nextGame =
      teamGames.find(
        (g) => g.status === "scheduled" && new Date(g.date).getTime() >= now,
      ) ?? null;
    return { wins, losses, form: form.slice(-5), lastGame, nextGame };
  }, [teamGames, schoolId]);

  const standing = useMemo(() => {
    const conf = school?.conferences?.find?.(
      (c) => c.sport === dataset.sport,
    )?.conference;
    if (!conf) return null;
    const table = (dataset.standings ?? []).find((s) => s.conference === conf);
    if (!table) return { conference: conf, rank: null, size: null };
    const idx = table.rows.findIndex((r) => r.school_id === schoolId);
    return {
      conference: conf,
      rank: idx >= 0 ? idx + 1 : null,
      size: table.rows.length,
    };
  }, [school, dataset.sport, dataset.standings, schoolId]);

  if (!school) {
    return (
      <div className="embed embed--unknown">
        <p>
          Team not found.{" "}
          <a href={FULL_WIDGET_URL} target="_blank" rel="noopener noreferrer">
            {SITE_TITLE} →
          </a>
        </p>
      </div>
    );
  }

  const teamUrl = `${FULL_WIDGET_URL}#/${dataset.sport}/team/${schoolId}`;
  const color = school.colors?.[0];
  const hasSeasonStarted = summary.wins + summary.losses > 0;

  return (
    <div
      className="embed"
      style={color ? { "--school-color": color } : undefined}
      data-school={schoolId}
    >
      <header className="embed__header">
        <TeamLogo team={{ school_id: schoolId, name: school.name }} school={school} size="md" />
        <div className="embed__title">
          <h1>{school.name}</h1>
          <p>
            {school.mascot}
            {standing?.conference ? ` · ${standing.conference}` : ""}
          </p>
        </div>
        <div className="embed__record" aria-label="Record">
          {hasSeasonStarted ? `${summary.wins}-${summary.losses}` : `${sportConfig.label}`}
          {hasSeasonStarted && standing?.rank ? (
            <span className="embed__rank">
              #{standing.rank} of {standing.size}
            </span>
          ) : (
            <span className="embed__rank">
              {hasSeasonStarted ? "" : dataset.meta?.season ?? ""}
            </span>
          )}
        </div>
      </header>

      {summary.lastGame && (
        <GameRow label="Last" game={summary.lastGame} schoolId={schoolId} />
      )}
      {summary.nextGame && (
        <GameRow label="Next" game={summary.nextGame} schoolId={schoolId} />
      )}

      {summary.form.length > 0 && (
        <div className="embed__form" aria-label="Recent form">
          {summary.form.map((r, i) => (
            <span key={i} className={`embed__form-mark embed__form-mark--${r.toLowerCase()}`}>
              {r}
            </span>
          ))}
        </div>
      )}

      <Sponsor
        slot={`school:${schoolId}`}
        sponsors={dataset.sponsors}
        variant="inline"
        className="embed__sponsor"
      />

      <footer className="embed__footer">
        <a href={teamUrl} target="_blank" rel="noopener noreferrer">
          Full {school.name} coverage →
        </a>
        <span className="embed__credit">{SITE.orgName}</span>
      </footer>
    </div>
  );
}

function GameRow({ label, game, schoolId }) {
  const isHome = game.home.school_id === schoolId;
  const us = isHome ? game.home : game.away;
  const them = isHome ? game.away : game.home;
  const isFinal = game.status === "final";
  const won = isFinal && (us.score ?? -1) > (them.score ?? -1);
  const gameUrl = `${FULL_WIDGET_URL}#/${game.sport}/game/${game.id}`;

  return (
    <a
      className="embed__game"
      href={gameUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="embed__game-label">{label}</span>
      <span className="embed__game-detail">
        {isHome ? "vs" : "at"} {them.name}
        {isFinal ? (
          <strong className={won ? "embed__won" : "embed__lost"}>
            {" "}
            {won ? "W" : "L"} {us.score}-{them.score}
          </strong>
        ) : (
          <span className="embed__when">
            {" "}
            · {formatGameDate(game.date)} · {formatGameTime(game.date)}
          </span>
        )}
      </span>
    </a>
  );
}
