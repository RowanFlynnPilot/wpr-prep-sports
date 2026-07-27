import { Link } from "react-router-dom";
import { formatStatsLine, teamSeasonLeaders } from "../utils/seasonStats.js";
import { useSportPrefix } from "../utils/links.js";
import { displayPlayerName, playerProfileHref } from "../utils/players.js";

/**
 * "Season Leaders" card on the team page. One row per configured
 * display-category showing the team's top performer. Sport-aware via
 * sportConfig.stats.categories — football shows Passing/Rushing/
 * Receiving/Defense leaders; basketball shows Scoring/Rebounding/
 * Playmaking/Defense leaders; volleyball shows Kills/Assists/Digs/
 * Serving leaders.
 *
 * Names link to the player profile (game-by-game log), matching the
 * dashboard's Top Performers and the game-page box scores. The team page
 * is where a parent lands looking for their kid, so a stat line that
 * couldn't be clicked was the one dead end in the drill-down.
 */
export default function SeasonLeaders({ rows, sportConfig }) {
  const sportPrefix = useSportPrefix();
  if (!rows || rows.length === 0) return null;
  const leaders = teamSeasonLeaders(rows, sportConfig);
  if (leaders.length === 0) return null;

  return (
    <section className="season-leaders">
      <header className="season-leaders__header">
        <h3>Season Leaders</h3>
        <span className="season-leaders__hint">
          {sportConfig?.season ?? ""} totals
        </span>
      </header>
      <ul className="season-leaders__list">
        {leaders.map(({ category, row }) => (
          <li key={category.id} className="season-leaders__row">
            <div className="season-leaders__player">
              {/* Untracked schools have no profile route to point at, so
                  those names stay inert text rather than a dead link. */}
              {row.school_id ? (
                <Link
                  to={playerProfileHref(sportPrefix, row.school_id, row.player_name)}
                  className="season-leaders__name season-leaders__name--link"
                >
                  {displayPlayerName(row.player_name)}
                  {row.player_year && (
                    <span className="season-leaders__year"> ({row.player_year})</span>
                  )}
                </Link>
              ) : (
                <span className="season-leaders__name">
                  {displayPlayerName(row.player_name)}
                  {row.player_year && (
                    <span className="season-leaders__year"> ({row.player_year})</span>
                  )}
                </span>
              )}
              <span className="season-leaders__category">{category.displayLabel}</span>
            </div>
            <span className="season-leaders__stats">
              {formatStatsLine(category, row.stats)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
