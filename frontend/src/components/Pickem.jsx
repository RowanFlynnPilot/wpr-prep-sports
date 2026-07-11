import { useMemo, useState, useEffect } from "react";
import Sponsor from "./Sponsor.jsx";
import { loadPicks, savePick, pickableGames, scorePicks } from "../utils/pickem.js";
import {
  pickemApiEnabled,
  submitPicks,
  fetchAggregates,
  fetchLeaderboard,
  loadDisplayName,
  saveDisplayName,
} from "../utils/pickemApi.js";
import { trackEvent } from "../utils/analytics.js";

/**
 * Pick'em — weekly winner predictions. Picks always live in
 * localStorage; when the Pick'em API is configured (VITE_PICKEM_API →
 * pickem-api/ worker) they ALSO submit to the community pool, which
 * unlocks the "64% picked Mosinee" bars and the season leaderboard.
 * Without the API this renders exactly as the original local-only game.
 *
 * Renders nothing when there are no upcoming pickable games (skip
 * the section in off-season rather than ship an empty card).
 */
export default function Pickem({ games, schoolIndex, sponsors, sportId }) {
  const upcoming = useMemo(() => pickableGames(games), [games]);
  const [picks, setPicks] = useState(() => loadPicks());
  const [agg, setAgg] = useState(null);
  const [board, setBoard] = useState(null);
  const [name, setName] = useState(() => loadDisplayName());

  // Re-read picks if a different tab updated them while this one is open.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === null || e.key.includes("pickem")) setPicks(loadPicks());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Community layer (no-ops when the API is off).
  useEffect(() => {
    if (!pickemApiEnabled || upcoming.length === 0) return undefined;
    let cancelled = false;
    fetchAggregates(sportId, upcoming.map((g) => g.id)).then(
      (a) => !cancelled && setAgg(a),
    );
    fetchLeaderboard(sportId).then((b) => !cancelled && setBoard(b));
    return () => {
      cancelled = true;
    };
  }, [sportId, upcoming]);

  const score = useMemo(() => scorePicks(games, picks), [games, picks]);

  if (upcoming.length === 0) return null;

  const onPick = (gameId, side) => {
    const next = side === picks[gameId] ? null : side; // tap-twice to unset
    if (next !== null) {
      const game = upcoming.find((g) => g.id === gameId);
      trackEvent("pickem-pick", { sport: game?.sport ?? "unknown" });
    }
    savePick(gameId, next);
    setPicks((p) => {
      const out = { ...p };
      if (next === null) delete out[gameId];
      else out[gameId] = next;
      return out;
    });
    submitPicks(sportId, { [gameId]: next });
    // Optimistic bump so the % bar reacts to your own pick immediately.
    if (agg && next !== null) {
      setAgg((a) => ({
        ...a,
        [gameId]: {
          ...(a[gameId] ?? { home: 0, away: 0 }),
          [next]: (a[gameId]?.[next] ?? 0) + 1,
        },
      }));
    }
  };

  const onNameCommit = () => {
    const trimmed = name.trim();
    saveDisplayName(trimmed);
    if (trimmed) submitPicks(sportId, {}, trimmed);
  };

  return (
    <section className="pickem" aria-label="Pick'em game">
      <header className="pickem__header">
        <div className="pickem__title">
          <span className="pickem__eyebrow">Pick&rsquo;em</span>
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
            community={agg?.[g.id] ?? null}
            onPick={(side) => onPick(g.id, side)}
          />
        ))}
      </ul>

      {pickemApiEnabled && board && board.leaders?.length > 0 && (
        <div className="pickem__board" aria-label="Leaderboard">
          <span className="pickem__board-title">
            Leaderboard · {board.players} player{board.players === 1 ? "" : "s"}
          </span>
          <ol className="pickem__board-list">
            {board.leaders.slice(0, 5).map((l) => (
              <li key={`${l.rank}:${l.name}`}>
                <span className="pickem__board-rank">#{l.rank}</span>
                <span className="pickem__board-name">{l.name}</span>
                <span className="pickem__board-score">
                  {l.correct}/{l.total}
                </span>
              </li>
            ))}
          </ol>
          {board.you && (
            <p className="pickem__board-you">
              You: #{board.you.rank} · {board.you.correct}/{board.you.total}
            </p>
          )}
        </div>
      )}

      {pickemApiEnabled ? (
        <footer className="pickem__footer pickem__footer--api">
          <label className="pickem__name">
            <span>Leaderboard name</span>
            <input
              type="text"
              value={name}
              maxLength={24}
              placeholder="Anonymous"
              onChange={(e) => setName(e.target.value)}
              onBlur={onNameCommit}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
          <span className="pickem__lock-note">
            Picks lock at kickoff · no sign-in needed
          </span>
        </footer>
      ) : (
        <footer className="pickem__footer">
          Picks save in your browser only — no sign-in needed.
        </footer>
      )}
    </section>
  );
}

function PickRow({ game, picked, schoolIndex, community, onPick }) {
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

  // Community bar renders once a few picks exist — a 1-0 split reads
  // as noise, not signal.
  const totalPicks = (community?.home ?? 0) + (community?.away ?? 0);
  const homePct = totalPicks >= 3 ? Math.round(((community.home ?? 0) / totalPicks) * 100) : null;

  return (
    <li className="pickem__row-wrap">
      <div className="pickem__row">
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
      </div>
      {homePct !== null && (
        <div
          className="pickem__community"
          title={`${totalPicks} community picks`}
          aria-label={`Community: ${100 - homePct}% ${game.away.name}, ${homePct}% ${game.home.name}`}
        >
          <span className="pickem__community-away">{100 - homePct}%</span>
          <span className="pickem__community-bar" aria-hidden="true">
            <span
              className="pickem__community-fill"
              style={{ width: `${100 - homePct}%` }}
            />
          </span>
          <span className="pickem__community-home">{homePct}%</span>
        </div>
      )}
    </li>
  );
}

function schoolColor(schoolId, schoolIndex) {
  if (!schoolId) return null;
  const s = schoolIndex?.get?.(schoolId);
  return s?.colors?.[0] ?? null;
}
