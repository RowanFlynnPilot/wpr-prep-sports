import { useMemo, useState, useEffect } from "react";
import Sponsor from "./Sponsor.jsx";
import { loadPicks, savePick, pickableGames, scorePicks } from "../utils/pickem.js";

/**
 * Pick'em — weekly winner predictions. localStorage-backed so the
 * widget stays static-site friendly; one record per browser.
 *
 * Renders nothing when there are no upcoming pickable games (skip
 * the section in off-season rather than ship an empty card).
 */
export default function Pickem({ games, schoolIndex, sponsors }) {
  const upcoming = useMemo(() => pickableGames(games), [games]);
  const [picks, setPicks] = useState(() => loadPicks());

  // Re-read picks if a different tab updated them while this one is open.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === null || e.key.includes("pickem")) setPicks(loadPicks());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const score = useMemo(() => scorePicks(games, picks), [games, picks]);

  if (upcoming.length === 0) return null;

  const onPick = (gameId, side) => {
    const next = side === picks[gameId] ? null : side; // tap-twice to unset
    savePick(gameId, next);
    setPicks((p) => {
      const out = { ...p };
      if (next === null) delete out[gameId];
      else out[gameId] = next;
      return out;
    });
  };

  return (
    <section className="pickem" aria-label="Pick'em game">
      <header className="pickem__header">
        <div className="pickem__title">
          <span className="pickem__eyebrow">Pick'em</span>
          <Sponsor slot="pickem" sponsors={sponsors} variant="inline" />
        </div>
        <div className="pickem__score" aria-label="Your record">
          <span className="pickem__score-num pickem__score-num--correct">{score.correct}</span>
          <span className="pickem__score-sep">/</span>
          <span className="pickem__score-num">{score.correct + score.incorrect}</span>
          <span className="pickem__score-label">correct</span>
          {score.pending > 0 && (
            <span className="pickem__pending">+{score.pending} pending</span>
          )}
        </div>
      </header>

      <ul className="pickem__list">
        {upcoming.map((g) => (
          <PickRow
            key={g.id}
            game={g}
            picked={picks[g.id] ?? null}
            schoolIndex={schoolIndex}
            onPick={(side) => onPick(g.id, side)}
          />
        ))}
      </ul>

      <footer className="pickem__footer">
        Picks save in your browser only — no sign-in needed.
      </footer>
    </section>
  );
}

function PickRow({ game, picked, schoolIndex, onPick }) {
  const awayColor = schoolColor(game.away.school_id, schoolIndex);
  const homeColor = schoolColor(game.home.school_id, schoolIndex);
  const dateLabel = new Date(game.date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLabel = new Date(game.date).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <li className="pickem__row">
      <div className="pickem__when">
        <span className="pickem__date">{dateLabel}</span>
        <span className="pickem__time">{timeLabel}</span>
      </div>
      <button
        type="button"
        className={
          "pickem__team pickem__team--away" +
          (picked === "away" ? " pickem__team--picked" : "")
        }
        style={awayColor ? { "--school-color": awayColor } : undefined}
        onClick={() => onPick("away")}
        aria-pressed={picked === "away"}
      >
        <span className="pickem__team-loc">at</span>
        <span className="pickem__team-name">{game.away.name}</span>
        {picked === "away" && <span className="pickem__check" aria-hidden="true">✓</span>}
      </button>
      <span className="pickem__vs">vs</span>
      <button
        type="button"
        className={
          "pickem__team pickem__team--home" +
          (picked === "home" ? " pickem__team--picked" : "")
        }
        style={homeColor ? { "--school-color": homeColor } : undefined}
        onClick={() => onPick("home")}
        aria-pressed={picked === "home"}
      >
        <span className="pickem__team-loc">home</span>
        <span className="pickem__team-name">{game.home.name}</span>
        {picked === "home" && <span className="pickem__check" aria-hidden="true">✓</span>}
      </button>
    </li>
  );
}

function schoolColor(schoolId, schoolIndex) {
  if (!schoolId) return null;
  const s = schoolIndex?.get?.(schoolId);
  return s?.colors?.[0] ?? null;
}
