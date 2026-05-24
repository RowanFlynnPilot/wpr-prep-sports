import { useMemo, useState } from "react";
import { useParams, Navigate, Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TeamLink from "../components/TeamLink.jsx";
import Sponsor from "../components/Sponsor.jsx";
import ScoringSummary from "../components/ScoringSummary.jsx";
import GamePreview from "../components/GamePreview.jsx";
import SpiritGallery from "../components/SpiritGallery.jsx";
import { schoolFor } from "../utils/schools.js";
import { formatGameDay, formatGameDate, formatGameTime } from "../utils/dates.js";
import { recapForGame } from "../utils/recap.js";
import { useSportPrefix } from "../utils/links.js";
import { playerProfileHref } from "../utils/players.js";

/**
 * Full game detail. Shows the matchup header, the recap line, and every
 * Bound-sourced stat leader split by team. Lives at /<sport>/game/:gameId.
 */
export default function GamePage({ dataset, schoolIndex, sportConfig }) {
  const { gameId } = useParams();
  const sportPrefix = useSportPrefix();
  const game = useMemo(
    () => (dataset.games ?? []).find((g) => g.id === gameId),
    [dataset.games, gameId],
  );

  // Stat-line grouping memo must run on every render (hooks rule), so we
  // compute it before the not-found guard and tolerate game === undefined.
  const statsByKey = useMemo(() => {
    const m = new Map();
    for (const line of game?.stat_leaders ?? []) {
      const key = line.team_school_id || `name:${normalizeName(line.team_name)}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(line);
    }
    return m;
  }, [game]);

  if (!game) {
    return <Navigate to={sportPrefix} replace />;
  }

  const isFinal = game.status === "final";
  const homeScore = game.home.score;
  const awayScore = game.away.score;
  const homeWon = isFinal && (homeScore ?? -1) > (awayScore ?? -1);
  const awayWon = isFinal && (awayScore ?? -1) > (homeScore ?? -1);

  const homeSchool = schoolFor(game.home, schoolIndex);
  const awaySchool = schoolFor(game.away, schoolIndex);

  // Recap voice from the winning side (or tracked side if winner isn't tracked)
  const perspectiveSchoolId = homeWon
    ? game.home.school_id || game.away.school_id
    : awayWon
    ? game.away.school_id || game.home.school_id
    : game.home.school_id || game.away.school_id;
  const teamGames = perspectiveSchoolId
    ? dataset.games
        .filter(
          (g) =>
            g.home.school_id === perspectiveSchoolId ||
            g.away.school_id === perspectiveSchoolId,
        )
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    : null;
  const recap = recapForGame(game, {
    schoolsById: schoolIndex,
    teamGames,
    perspectiveSchoolId,
    sportConfig,
  });

  const keyForSide = (side) =>
    side.school_id || `name:${normalizeName(side.name)}`;

  const breadcrumb = (
    <>
      <Link to={sportPrefix} className="breadcrumb__back">
        <span aria-hidden="true" className="breadcrumb__back-arrow">‹</span>
        Back to {sportConfig?.label ?? "Games"}
      </Link>
      <span aria-hidden="true" className="breadcrumb__sep">·</span>
      <span className="breadcrumb__current">
        {game.away.name} {isFinal ? `${awayScore}-${homeScore}` : "vs"} {game.home.name}
      </span>
    </>
  );

  // Context chip text for the eyebrow row — sport label + conference / playoff hint.
  const contextLabel = [
    sportConfig?.label,
    game.playoff
      ? game.playoff_round
        ? `WIAA Tournament · ${game.playoff_round}`
        : "WIAA Tournament"
      : game.conference_game
        ? "Conference matchup"
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Layout breadcrumb={breadcrumb} sponsors={dataset.sponsors}>
      <section className="game-page__hero">
        <div className="game-page__meta">
          {game.status === "in_progress" ? (
            <span className="eyebrow eyebrow--live">
              <span className="game-page__live-dot" aria-hidden="true" />
              LIVE
            </span>
          ) : (
            <span className="eyebrow eyebrow--accent">
              {isFinal ? "Final" : "Up Next"}
            </span>
          )}
          <span className="game-page__date">
            {formatGameDay(game.date)} · {formatGameDate(game.date)}
            {!isFinal && <> · {formatGameTime(game.date)}</>}
          </span>
          {game.venue && <span className="game-page__venue">{game.venue}</span>}
          {contextLabel && (
            <span className="game-page__context">{contextLabel}</span>
          )}
        </div>

        <div className="game-page__matchup">
          <Side
            team={game.away}
            school={awaySchool}
            score={awayScore}
            won={awayWon}
            showScore={isFinal || game.status === "in_progress"}
          />
          <div className="game-page__divider" aria-hidden="true">
            <span>vs</span>
          </div>
          <Side
            team={game.home}
            school={homeSchool}
            score={homeScore}
            won={homeWon}
            showScore={isFinal || game.status === "in_progress"}
          />
        </div>

        {recap && <p className="game-page__recap">{recap}</p>}

        {game.set_scores && game.set_scores.length > 0 && (
          <SetScoreLine
            sets={game.set_scores}
            awayName={game.away.name}
            homeName={game.home.name}
            awayMascot={awaySchool?.mascot}
            homeMascot={homeSchool?.mascot}
          />
        )}
      </section>

      <Sponsor
        slot="game-detail"
        sponsors={dataset.sponsors}
        variant="inline"
        className="game-page__sponsor"
      />

      <GamePreview game={game} dataset={dataset} schoolIndex={schoolIndex} />

      <ScoringSummary game={game} schoolIndex={schoolIndex} />

      <SpiritGallery game={game} photos={dataset.spirit} />

      {game.status !== "scheduled" && (<section>
        <div className="section-header">
          <h2>Game Stats</h2>
          <span className="section-header__hint">
            {game.stat_leaders?.length
              ? `${game.stat_leaders.length} stat leaders${statsSourceLabel(game) ? ` · via ${statsSourceLabel(game)}` : ""}`
              : "No stats available for this game"}
          </span>
        </div>

        {game.stat_leaders?.length > 0 ? (
          <div className="game-stats">
            <TeamStatsCard
              label={game.away.name}
              team={game.away}
              school={awaySchool}
              won={awayWon}
              lines={statsByKey.get(keyForSide(game.away)) ?? []}
              score={awayScore}
              showScore={isFinal}
              sportPrefix={sportPrefix}
              otherSideHasStats={
                (statsByKey.get(keyForSide(game.home)) ?? []).length > 0
              }
            />
            <TeamStatsCard
              label={game.home.name}
              team={game.home}
              school={homeSchool}
              won={homeWon}
              lines={statsByKey.get(keyForSide(game.home)) ?? []}
              score={homeScore}
              showScore={isFinal}
              sportPrefix={sportPrefix}
              otherSideHasStats={
                (statsByKey.get(keyForSide(game.away)) ?? []).length > 0
              }
            />
          </div>
        ) : (
          <div className="game-stats__empty">
            <p>
              Stats for this game haven't been reported to Bound yet, or this
              matchup is outside the coverage area. The final score above is
              authoritative.
            </p>
          </div>
        )}
      </section>)}
    </Layout>
  );
}

/**
 * Volleyball set-by-set ladder. Renders below the matchup hero on
 * games that have set_scores populated (MaxPreps boxes). Each set's
 * winner gets a bold treatment so a 25-22, 25-18, 24-26, 25-23 sweep
 * reads at a glance.
 */
function SetScoreLine({ sets, awayName, homeName, awayMascot, homeMascot }) {
  return (
    <div className="set-score-line" aria-label="Set-by-set score">
      <div className="set-score-line__heading">Sets</div>
      <table className="set-score-line__table">
        <thead>
          <tr>
            <th scope="col" className="set-score-line__corner" aria-hidden="true" />
            {sets.map((_, i) => (
              <th key={i} scope="col" className="set-score-line__set-head">
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <SetRow side="away" name={awayName} mascot={awayMascot} sets={sets} />
          <SetRow side="home" name={homeName} mascot={homeMascot} sets={sets} />
        </tbody>
      </table>
    </div>
  );
}

function SetRow({ side, name, mascot, sets }) {
  return (
    <tr className={`set-score-line__row set-score-line__row--${side}`}>
      <th scope="row" className="set-score-line__team">
        <span className="set-score-line__team-name">{name}</span>
        {mascot && <span className="set-score-line__team-mascot">{mascot}</span>}
      </th>
      {sets.map((s, i) => {
        const own = s[side];
        const other = s[side === "home" ? "away" : "home"];
        const wonSet = own > other;
        return (
          <td
            key={i}
            className={`set-score-line__set ${wonSet ? "set-score-line__set--won" : ""}`}
          >
            {own}
          </td>
        );
      })}
    </tr>
  );
}

function Side({ team, school, score, won, showScore }) {
  const schoolColor = school?.colors?.[0] ?? null;
  return (
    <div
      className={`game-page__team ${won ? "game-page__team--won" : ""}`}
      style={schoolColor ? { "--school-color": schoolColor } : undefined}
    >
      <TeamLogo team={team} school={school} size="xl" />
      <div className="game-page__team-text">
        <h3 className="game-page__team-name">
          <TeamLink team={team}>{team.name}</TeamLink>
        </h3>
        {school?.mascot && (
          <p className="game-page__team-mascot">{school.mascot}</p>
        )}
      </div>
      <div className="game-page__score-wrap">
        {showScore && (
          <span className="game-page__score">{score ?? "—"}</span>
        )}
      </div>
    </div>
  );
}

// Default leaders shown per category before the user clicks "Show all".
// Bound + WPH typically emit 1-3 per category, so the cap is invisible
// for those. MaxPreps volleyball ships entire rosters (15+ rows per
// category) which is where the collapse pays off.
const DEFAULT_LEADERS_PER_CATEGORY = 3;

// Stat-key that ranks a player within a category. Players sort by this
// descending; rows whose value here is missing/zero sink to the bottom.
const LEADER_KEY_BY_CATEGORY = {
  // Volleyball — canonical keys emitted by maxpreps.py + Bound's
  // volleyball stat lines.
  "Kills": "KLS",
  "Assists": "AST",
  "Digs": "DIG",
  "Total Blocks": "BLK",
  "Serve Aces": "ACE",
  // Football (Bound).
  "Passing Yards": "YDS",
  "Rushing Yards": "YDS",
  "Receiving Yards": "YDS",
  "Total Tackles": "TKL",
  // Basketball (Bound) — both rendered categories.
  "Points": "PTS",
  "Rebounds": "RBD",
  // Hockey (WPH).
  "Hockey Points": "PTS",
  "Hockey Goals": "G",
  "Hockey Saves": "SV",
};

function TeamStatsCard({ label, team, school, won, lines, score, showScore, otherSideHasStats, sportPrefix }) {
  // Per-category expand toggle. State lives on the card (one card per
  // team) so each side can be expanded independently.
  const [expanded, setExpanded] = useState({});
  // Card-level view mode: compact per-category leaders ("leaders") vs.
  // a comprehensive box-score table ("box") that shows every player ×
  // every stat column the source provided. Toggle via the header.
  const [viewMode, setViewMode] = useState("leaders");

  // Group by category, sort each group by its leader stat. Categories
  // arrive in the source's natural order; preserve that.
  const groups = useMemo(() => groupLinesByCategory(lines), [lines]);

  if (lines.length === 0 && !team.school_id) {
    return (
      <article className="team-stats team-stats--empty">
        <header className="team-stats__header">
          <TeamLogo team={team} school={school} size="md" />
          <div>
            <h3>{label}</h3>
          </div>
          {showScore && (
            <span className="team-stats__score">{score ?? "—"}</span>
          )}
        </header>
        <p className="team-stats__empty-note">No stats reported.</p>
      </article>
    );
  }

  const schoolColor = school?.colors?.[0] ?? null;
  return (
    <article
      className={`team-stats ${won ? "team-stats--won" : ""}`}
      style={schoolColor ? { "--school-color": schoolColor } : undefined}
    >
      <header className="team-stats__header">
        <TeamLogo team={team} school={school} size="md" />
        <div className="team-stats__title">
          <h3>
            <TeamLink team={team}>{label}</TeamLink>
          </h3>
          {school?.mascot && <p>{school.mascot}</p>}
        </div>
        {showScore && (
          <span className="team-stats__score">{score ?? "—"}</span>
        )}
      </header>
      {lines.length === 0 ? (
        <p className="team-stats__empty-note">
          {otherSideHasStats
            ? "No box score submitted for this team — coaches input stats per-team on MaxPreps."
            : "No stats reported for this team."}
        </p>
      ) : viewMode === "box" ? (
        <FullBoxScore
          groups={groups}
          sportPrefix={sportPrefix}
          onClose={() => setViewMode("leaders")}
        />
      ) : (
        <div className="team-stats__groups">
          <button
            type="button"
            className="team-stats__view-toggle"
            onClick={() => setViewMode("box")}
            aria-label="View full box score"
          >
            Full box score →
          </button>
          {groups.map(({ category, lines: groupLines }) => {
            const isOpen = expanded[category] ?? false;
            const visible = isOpen
              ? groupLines
              : groupLines.slice(0, DEFAULT_LEADERS_PER_CATEGORY);
            const hiddenCount = groupLines.length - visible.length;
            return (
              <div key={category} className="team-stats__group">
                <h4 className="team-stats__group-header">
                  <span>{category}</span>
                  <span className="team-stats__group-count">
                    {groupLines.length}
                  </span>
                </h4>
                <ul className="team-stats__list">
                  {visible.map((line, idx) => (
                    <StatRow
                      key={`${category}-${idx}`}
                      line={line}
                      sportPrefix={sportPrefix}
                    />
                  ))}
                </ul>
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    className="team-stats__expand"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [category]: !isOpen,
                      }))
                    }
                  >
                    Show all {groupLines.length} →
                  </button>
                )}
                {isOpen && groupLines.length > DEFAULT_LEADERS_PER_CATEGORY && (
                  <button
                    type="button"
                    className="team-stats__expand team-stats__expand--collapse"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [category]: false,
                      }))
                    }
                  >
                    ← Show top {DEFAULT_LEADERS_PER_CATEGORY}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

/**
 * Comprehensive box-score view for one team. Renders a table per
 * category with every column the source provided (Hitting, Serving,
 * Blocking, Digging, Ball Handling — all of MP's columns including
 * the granular ones the leader view collapses).
 *
 * The first column links the player name to their profile when the
 * team is tracked. Players sort by their category's leader stat.
 */
function FullBoxScore({ groups, sportPrefix, onClose }) {
  return (
    <div className="team-stats__box">
      <button
        type="button"
        className="team-stats__view-toggle team-stats__view-toggle--back"
        onClick={onClose}
      >
        ← Back to leaders
      </button>
      {groups.map(({ category, lines }) => (
        <BoxCategoryTable
          key={category}
          category={category}
          lines={lines}
          sportPrefix={sportPrefix}
        />
      ))}
    </div>
  );
}

function BoxCategoryTable({ category, lines, sportPrefix }) {
  // Build the column set from the union of every player's stats keys
  // in this category. Order them: SP first (sets played, always
  // useful), then the leader key, then everything else in first-seen
  // order. Hide the canonical leader key when a friendlier equivalent
  // exists (same dedupe rule as the compact view).
  const columns = useMemo(() => {
    const seen = [];
    const set = new Set();
    for (const line of lines) {
      for (const k of Object.keys(line.stats ?? {})) {
        if (set.has(k)) continue;
        if (REDUNDANT_KEYS.has(k) && hasReadableEquivalent(k, line.stats)) {
          continue;
        }
        set.add(k);
        seen.push(k);
      }
    }
    // Promote SP to the front, then the canonical leader key.
    const leaderKey = LEADER_KEY_BY_CATEGORY[category];
    const promoted = [];
    if (seen.includes("SP")) promoted.push("SP");
    if (leaderKey && seen.includes(leaderKey) && !promoted.includes(leaderKey)) {
      promoted.push(leaderKey);
    }
    for (const k of seen) {
      if (!promoted.includes(k)) promoted.push(k);
    }
    return promoted;
  }, [lines, category]);

  if (columns.length === 0) return null;

  return (
    <div className="box-cat">
      <h4 className="box-cat__header">{category}</h4>
      <div className="box-cat__scroll">
        <table className="box-cat__table">
          <thead>
            <tr>
              <th scope="col" className="box-cat__col-name">Player</th>
              {columns.map((col) => (
                <th key={col} scope="col">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={`${line.player_name}-${i}`}>
                <th scope="row" className="box-cat__col-name">
                  {line.team_school_id ? (
                    <Link
                      to={playerProfileHref(sportPrefix, line.team_school_id, line.player_name)}
                      className="box-cat__name-link"
                    >
                      {line.player_name}
                      {line.player_year && (
                        <span className="box-cat__year"> ({line.player_year})</span>
                      )}
                    </Link>
                  ) : (
                    <>
                      {line.player_name}
                      {line.player_year && (
                        <span className="box-cat__year"> ({line.player_year})</span>
                      )}
                    </>
                  )}
                </th>
                {columns.map((col) => (
                  <td key={col}>{line.stats?.[col] ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function groupLinesByCategory(lines) {
  // Preserve category order of first appearance; sort lines within each
  // category by the canonical leader stat, descending.
  const order = [];
  const buckets = new Map();
  for (const line of lines) {
    const cat = line.category || "Other";
    if (!buckets.has(cat)) {
      buckets.set(cat, []);
      order.push(cat);
    }
    buckets.get(cat).push(line);
  }
  return order.map((cat) => {
    const arr = [...buckets.get(cat)];
    const key = LEADER_KEY_BY_CATEGORY[cat];
    arr.sort((a, b) => statNum(b.stats, key) - statNum(a.stats, key));
    return { category: cat, lines: arr };
  });
}

function statNum(stats, key) {
  if (!key || !stats) return -Infinity;
  const raw = stats[key];
  if (raw == null || raw === "") return -Infinity;
  const n = parseFloat(String(raw).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : -Infinity;
}

function normalizeName(name) {
  return (name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Pretty label for the stats provider. WIAA gives schedule/scores, never
// stats, so strip it; whatever remains is the stats source.
const SOURCE_LABELS = {
  bound: "Bound",
  wisconsinprephockey: "Wisconsin Prep Hockey",
  maxpreps: "MaxPreps",
};
function statsSourceLabel(game) {
  const stats = (game.sources ?? []).filter((s) => s !== "wiaa");
  if (stats.length === 0) return null;
  return stats.map((s) => SOURCE_LABELS[s] ?? s).join(" / ");
}

// Only categories whose position is fully determined by the category
// itself get a pos badge. Basketball + volleyball can't be inferred this
// way (every player can score/rebound/assist), and hockey skater
// categories vary by player — so those render without a pill rather
// than a meaningless dash.
const CATEGORY_POS = {
  "Passing Yards": "QB",
  "Rushing Yards": "RB",
  "Receiving Yards": "WR",
  "Total Tackles": "DEF",
  "Hockey Saves": "G",
};

// Canonical leader keys we add in the parser layer that duplicate a
// more readable column (Bound/MP both expose K for kills; KLS is our
// own normalized copy). Hide the canonical key from display so each
// row doesn't read "K 6 · KLS 6" with the same value twice.
const REDUNDANT_KEYS = new Set(["KLS", "AST", "DIG", "BLK", "ACE"]);

function StatRow({ line, sportPrefix }) {
  const stats = line.stats ?? {};
  const pos = line.position || CATEGORY_POS[line.category] || null;
  const visibleStats = Object.entries(stats).filter(([k]) => {
    if (!REDUNDANT_KEYS.has(k)) return true;
    return !hasReadableEquivalent(k, stats);
  });
  // Player name links to profile when we have a school_id for them
  // (we can't build a profile route for untracked opponents).
  const NameWrap = line.team_school_id
    ? ({ children }) => (
        <Link
          to={playerProfileHref(sportPrefix, line.team_school_id, line.player_name)}
          className="stat-row__name stat-row__name--link"
        >
          {children}
        </Link>
      )
    : ({ children }) => <span className="stat-row__name">{children}</span>;
  return (
    <li className={`stat-row${pos ? "" : " stat-row--no-pos"}`}>
      {pos && <span className="stat-row__pos">{pos}</span>}
      <div className="stat-row__player">
        <NameWrap>
          {line.player_name}
          {line.player_year && (
            <span className="stat-row__year"> ({line.player_year})</span>
          )}
        </NameWrap>
      </div>
      <div className="stat-row__stats">
        {visibleStats.map(([k, v]) => (
          <span key={k} className="stat-row__stat">
            <span className="stat-row__stat-label">{k}</span>
            <span className="stat-row__stat-value">{v}</span>
          </span>
        ))}
      </div>
    </li>
  );
}

function hasReadableEquivalent(canon, stats) {
  // Canonical → list of source-side column headers that would be the
  // same value. Hide canonical only when one of these is present.
  const equivalents = {
    KLS: ["K"],
    AST: ["Ast"],
    DIG: ["D"],
    BLK: ["Tot Blks"],
    ACE: ["A"],
  };
  return (equivalents[canon] ?? []).some((k) => k in stats);
}
