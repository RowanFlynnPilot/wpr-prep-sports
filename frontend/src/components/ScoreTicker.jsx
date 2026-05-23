import { useEffect, useRef, useState, useCallback } from "react";
import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import { schoolFor } from "../utils/schools.js";
import { formatGameShortDay, formatGameDate } from "../utils/dates.js";
import { playerLineForGame } from "../utils/recap.js";

/**
 * Horizontal scrollable ticker of recent + tonight games. Each card surfaces
 * the most important info: date, both team logos+names, scores, status.
 *
 * Scroll polish:
 * - native scrollbar hidden (track still drag-scrolls)
 * - gradient mask fades cards at the edges, hinting "more here"
 * - circular left/right arrow buttons paginate by ~one card width and
 *   disable themselves at the ends
 * - scroll-snap-type: x mandatory makes the snap feel crisp on touch
 */
export default function ScoreTicker({ games, schoolIndex }) {
  const trackRef = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateEdges = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 4px tolerance — scroll positions sometimes settle ±1px off the end.
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= max - 4);
  }, []);

  useEffect(() => {
    updateEdges();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      ro.disconnect();
    };
  }, [updateEdges, games]);

  const scrollBy = useCallback((direction) => {
    const el = trackRef.current;
    if (!el) return;
    // Step = one card + gap (read off the first card's actual width).
    const firstCard = el.querySelector(".card");
    const step = firstCard
      ? firstCard.getBoundingClientRect().width + 14
      : el.clientWidth * 0.8;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      left: step * direction,
      behavior: prefersReduced ? "instant" : "smooth",
    });
  }, []);

  if (!games || games.length === 0) {
    return (
      <div className="ticker ticker--empty">
        <p>No games in the last week. Friday Night Lights returns soon.</p>
      </div>
    );
  }

  return (
    <div className="ticker">
      <button
        type="button"
        className="ticker__arrow ticker__arrow--left"
        onClick={() => scrollBy(-1)}
        disabled={atStart}
        aria-label="Scroll scores left"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M15 6l-6 6 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="ticker__viewport">
        <div className="ticker__track" ref={trackRef}>
          {games.map((g) => (
            <GameCard key={g.id} game={g} schoolIndex={schoolIndex} />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="ticker__arrow ticker__arrow--right"
        onClick={() => scrollBy(1)}
        disabled={atEnd}
        aria-label="Scroll scores right"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
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
