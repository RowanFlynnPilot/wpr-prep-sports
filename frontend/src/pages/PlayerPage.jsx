import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import Sponsor from "../components/Sponsor.jsx";
import { schoolFor } from "../utils/schools.js";
import { useSportPrefix } from "../utils/links.js";
import { formatGameDate } from "../utils/dates.js";
import {
  findPlayerGameLog,
  findPlayerSeasonStats,
  resolvePlayerName,
  resolvePlayerPosition,
  resolvePlayerYear,
} from "../utils/players.js";
import { formatStatsLine } from "../utils/seasonStats.js";

/**
 * Player profile — season totals (split by raw category) + a game-by-
 * game stat log. Linked from leaderboards, game-page stat rows, and
 * future search.
 *
 * URL: /<sport>/player/<school-id>/<player-slug>. The slug is a
 * deterministic kebab-case of the player's name (see utils/players.js).
 */
export default function PlayerPage({ dataset, schoolIndex, sportConfig }) {
  const { schoolId, playerSlug: slug } = useParams();
  const sportPrefix = useSportPrefix();

  const playerName = useMemo(
    () =>
      resolvePlayerName({
        games: dataset.games,
        seasonStats: dataset.seasonStats,
        schoolId,
        slug,
      }),
    [dataset.games, dataset.seasonStats, schoolId, slug],
  );

  const seasonRows = useMemo(
    () =>
      playerName
        ? findPlayerSeasonStats(
            dataset.seasonStats,
            schoolId,
            playerName,
            sportConfig,
          )
        : [],
    [dataset.seasonStats, schoolId, playerName, sportConfig],
  );

  const gameLog = useMemo(
    () =>
      playerName
        ? findPlayerGameLog(dataset.games, schoolId, playerName)
        : [],
    [dataset.games, schoolId, playerName],
  );

  const position = useMemo(
    () =>
      playerName
        ? resolvePlayerPosition({
            games: dataset.games,
            seasonStats: dataset.seasonStats,
            schoolId,
            slug,
          })
        : null,
    [dataset.games, dataset.seasonStats, schoolId, slug, playerName],
  );

  const year = useMemo(
    () =>
      playerName
        ? resolvePlayerYear({
            games: dataset.games,
            seasonStats: dataset.seasonStats,
            schoolId,
            slug,
          })
        : null,
    [dataset.games, dataset.seasonStats, schoolId, slug, playerName],
  );

  if (!playerName) {
    return <Navigate to={`${sportPrefix}/team/${schoolId}`} replace />;
  }

  const school = schoolIndex?.get?.(schoolId);
  const teamForLogo = {
    school_id: schoolId,
    name: school?.name ?? schoolId,
    logo_url: school?.logo_url ?? null,
  };

  const breadcrumb = (
    <>
      <Link to={`${sportPrefix}/team/${schoolId}`} className="breadcrumb__back">
        <span aria-hidden="true" className="breadcrumb__back-arrow">‹</span>
        Back to {school?.name ?? "team"}
      </Link>
      <span aria-hidden="true" className="breadcrumb__sep">·</span>
      <span className="breadcrumb__current">{playerName}</span>
    </>
  );

  return (
    <Layout breadcrumb={breadcrumb} sponsors={dataset.sponsors}>
      <section className="player-page__hero">
        <TeamLogo team={teamForLogo} school={school} size="xl" />
        <div className="player-page__hero-text">
          <div className="player-page__eyebrow">
            {position && (
              <span className="player-page__pos">{position}</span>
            )}
            <span className="player-page__sport">{sportConfig?.label}</span>
          </div>
          <h1 className="player-page__name">
            {playerName}
            {year && <span className="player-page__year"> ({year})</span>}
          </h1>
          <Link
            to={`${sportPrefix}/team/${schoolId}`}
            className="player-page__school"
          >
            {school?.name ?? schoolId}
            {school?.mascot && (
              <span className="player-page__mascot"> · {school.mascot}</span>
            )}
          </Link>
        </div>
      </section>

      <Sponsor
        slot="player-profile"
        sponsors={dataset.sponsors}
        variant="inline"
        className="player-page__sponsor"
      />

      {seasonRows.length > 0 && (
        <section>
          <div className="section-header">
            <h2>Season Totals</h2>
            <span className="section-header__hint">
              {sportConfig?.season}
            </span>
          </div>
          <div className="player-page__season">
            {seasonRows.map((row) => (
              <SeasonCard key={row.category} row={row} sportConfig={sportConfig} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-header">
          <h2>Game Log</h2>
          <span className="section-header__hint">
            {gameLogHint(gameLog, seasonRows)}
          </span>
        </div>
        {gameLog.length === 0 ? (
          <p className="player-page__empty">
            No per-game stat lines on record for this player.
          </p>
        ) : (
          <GameLogTable
            entries={gameLog}
            sportPrefix={sportPrefix}
            schoolId={schoolId}
            schoolIndex={schoolIndex}
          />
        )}
      </section>
    </Layout>
  );
}

function SeasonCard({ row, sportConfig }) {
  // Match each rendered display category from sportConfig that maps
  // to this raw category so we can use its formatLine for a nice
  // one-liner ("392 KLS · 877 ATT · .283 EFF").
  const matchingCats = (sportConfig?.stats?.categories ?? []).filter(
    (c) => c.rawCategory === row.category,
  );

  // Build (label, lead, secondary) tuples per stat line. `lead` is the
  // headline number ("21.2 PPG") rendered large; `secondary` carries
  // the dot-separated supporting stats ("54.6% FG · 42.5% 3P").
  const blocks =
    matchingCats.length > 0
      ? matchingCats
          .map((cat) => {
            const full = formatStatsLine(cat, row.stats);
            if (!full) return null;
            const [lead, ...rest] = full.split(" · ");
            return {
              key: cat.id,
              label: cat.displayLabel,
              lead,
              secondary: rest.join(" · "),
            };
          })
          .filter(Boolean)
      : // Fallback: dump dict as label/value pairs with no lead split.
        Object.entries(row.stats || {})
          .filter(([k]) => k !== "GP")
          .map(([k, v]) => ({ key: k, label: k, lead: String(v), secondary: "" }));

  return (
    <article className="player-season-card">
      <header className="player-season-card__header">
        <h3>{row.category.replace(/^(Volleyball|Hockey)\s+/, "")}</h3>
        {row.stats?.GP && (
          <span className="player-season-card__gp">
            {row.stats.GP} {row.category.startsWith("Volleyball") ? "matches" : "games"}
          </span>
        )}
      </header>
      <div className="player-season-card__blocks">
        {blocks.map((b) => (
          <div key={b.key} className="season-stat-block">
            <span className="season-stat-block__label">{b.label}</span>
            <span className="season-stat-block__lead">{b.lead}</span>
            {b.secondary && (
              <span className="season-stat-block__secondary">{b.secondary}</span>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function GameLogTable({ entries, sportPrefix, schoolId, schoolIndex }) {
  return (
    <div className="game-log">
      {entries.map(({ game, lines }) => {
        const isHome = game.home.school_id === schoolId;
        const opp = isHome ? game.away : game.home;
        const ownScore = isHome ? game.home.score : game.away.score;
        const oppScore = isHome ? game.away.score : game.home.score;
        const won = (ownScore ?? -1) > (oppScore ?? -1);
        const oppSchool = opp.school_id ? schoolIndex?.get?.(opp.school_id) : null;
        const oppTeam = {
          school_id: opp.school_id || "",
          name: opp.name,
          logo_url: opp.logo_url || oppSchool?.logo_url || null,
        };
        return (
          <Link
            key={game.id}
            to={`${sportPrefix}/game/${game.id}`}
            className={`game-log__row ${won ? "game-log__row--won" : "game-log__row--lost"}`}
          >
            <div className="game-log__date">
              {formatGameDate(game.date)}
            </div>
            <div className="game-log__opp">
              <span className="game-log__opp-loc">{isHome ? "vs" : "@"}</span>
              <TeamLogo team={oppTeam} school={oppSchool} size="sm" />
              <span className="game-log__opp-name">{opp.name}</span>
            </div>
            <div className="game-log__result">
              <span className="game-log__wl">{won ? "W" : "L"}</span>
              <span className="game-log__score">
                {ownScore ?? "—"}-{oppScore ?? "—"}
              </span>
            </div>
            <div className="game-log__stats">
              {lines.map((line, i) => (
                <span key={i} className="game-log__stat-chip">
                  <span className="game-log__stat-label">{line.category}</span>
                  <span className="game-log__stat-value">
                    {leaderValueText(line)}
                  </span>
                </span>
              ))}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// Per-category formatters for the game-log stat chip. Each returns a
// compact, scannable string like "23 YDS · 2 TD". The first key in
// each list whose value is non-empty/non-zero is used; trailing keys
// only render when they add information. Designed to be denser than
// "HOCKEY POINTS 2" — a reader should see at a glance what kind of
// game it was.
const CATEGORY_FORMATTERS = {
  // Hockey — composite goal/assist/point line per skater.
  "Hockey Points": (s) =>
    composeStat([
      [s.G, "G"],
      [s.A, "A"],
      [s.PTS, "PTS"],
    ]),
  "Hockey Goals": (s) =>
    composeStat([
      [s.G, "G"],
      [s.A, "A"],
    ]),
  "Hockey Saves": (s) => {
    const sv = num(s.SV);
    const ga = num(s.GA);
    const parts = [];
    if (Number.isFinite(sv)) parts.push(`${sv} SV`);
    if (Number.isFinite(ga)) parts.push(`${ga} GA`);
    if (Number.isFinite(sv) && Number.isFinite(ga) && ga === 0 && sv >= 10) {
      parts.push("SHO");
    }
    return parts.join(" · ") || "—";
  },

  // Football.
  "Passing Yards": (s) =>
    composeStat([
      [s.YDS, "YDS"],
      [s.TDS, "TD"],
      [s.COMP && s.ATT ? `${s.COMP}/${s.ATT}` : null, ""],
    ]),
  "Rushing Yards": (s) =>
    composeStat([
      [s.YDS, "YDS"],
      [s.TDS, "TD"],
      [s.CAR, "CAR"],
    ]),
  "Receiving Yards": (s) =>
    composeStat([
      [s.YDS, "YDS"],
      [s.TDS, "TD"],
      [s.REC, "REC"],
    ]),
  "Total Tackles": (s) =>
    composeStat([
      [s.TKL || s.TOT, "TKL"],
      [s.SKS || s.SACKS, "SK"],
      [s.TFL, "TFL"],
    ]),

  // Basketball.
  Points: (s) =>
    composeStat([
      [s.PTS, "PTS"],
      [s.RBD, "RBD"],
      [s.AST, "AST"],
    ]),
  Rebounds: (s) =>
    composeStat([
      [s.RBD, "RBD"],
      [s.PTS, "PTS"],
    ]),

  // Volleyball (per-game).
  Kills: (s) =>
    composeStat([
      [s.K || s.KLS, "K"],
      [s.E, "E"],
      [s["Hit %"] || s["HIT %"], ""],
    ]),
  Assists: (s) =>
    composeStat([
      [s.Ast || s.AST, "A"],
      [s.SP, "SP"],
    ]),
  Digs: (s) =>
    composeStat([
      [s.D || s.DIG, "D"],
    ]),
  "Total Blocks": (s) =>
    composeStat([
      [s["Tot Blks"] || s.BLK, "BLK"],
      [s.BS, "BS"],
    ]),
  "Serve Aces": (s) =>
    composeStat([
      [s.A || s.ACE, "ACE"],
      [s.PTS, "PTS"],
    ]),
};

function leaderValueText(line) {
  const stats = line.stats || {};
  const formatter = CATEGORY_FORMATTERS[line.category];
  if (formatter) {
    const out = formatter(stats);
    if (out && out !== "—") return out;
  }
  // Fallback: first non-empty stat.
  for (const [k, v] of Object.entries(stats)) {
    if (v != null && v !== "") return `${v} ${k}`;
  }
  return "—";
}

// Hint shown next to the Game Log header. When we know the player's
// season GP (from season totals) we show "9 of 23 games" so the
// reader understands box-score coverage is partial — common for
// hockey (WPH doesn't publish detail pages for every game) and
// volleyball (coach-uploaded MaxPreps boxes).
function gameLogHint(gameLog, seasonRows) {
  const n = gameLog.length;
  let seasonGp = 0;
  for (const row of seasonRows) {
    const gp = parseInt(row.stats?.GP, 10);
    if (Number.isFinite(gp) && gp > seasonGp) seasonGp = gp;
  }
  if (seasonGp > n) {
    return `${n} of ${seasonGp} games with detailed stats`;
  }
  return `${n} game${n === 1 ? "" : "s"} with stats`;
}

function num(v) {
  if (v == null || v === "") return NaN;
  const n = parseFloat(String(v).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

// Build "X G · Y A · Z PTS" from [[value, label], ...]. Drops parts
// where value is null/empty/zero (zero "TD" is uninteresting). Label
// can be empty for already-formatted segments (e.g. "12/24" passing).
function composeStat(pairs) {
  const out = [];
  for (const [value, label] of pairs) {
    if (value == null || value === "") continue;
    const n = num(value);
    if (Number.isFinite(n) && n === 0) continue;
    out.push(label ? `${value} ${label}` : value);
  }
  return out.length ? out.join(" · ") : "—";
}
