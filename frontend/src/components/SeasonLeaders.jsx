import {
  formatStatsLine,
  positionFor,
  teamSeasonLeaders,
} from "../utils/seasonStats.js";

/**
 * "Season Leaders" card on the team page. One row per configured
 * display-category showing the team's top performer. Sport-aware via
 * sportConfig.stats.categories — football shows Passing/Rushing/
 * Receiving/Defense leaders; basketball shows Scoring/Rebounding/
 * Playmaking/Defense leaders; volleyball shows Kills/Assists/Digs/
 * Serving leaders.
 */
export default function SeasonLeaders({ rows, sportConfig }) {
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
            <span className="season-leaders__position">
              {positionFor(category)}
            </span>
            <div className="season-leaders__player">
              <span className="season-leaders__name">
                {row.player_name}
                {row.player_year && (
                  <span className="season-leaders__year"> ({row.player_year})</span>
                )}
              </span>
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
