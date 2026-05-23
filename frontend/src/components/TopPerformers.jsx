import { Link } from "react-router-dom";
import { formatStatsLine, topPerformers } from "../utils/seasonStats.js";
import { useSportPrefix } from "../utils/links.js";

/**
 * Top Performers — cross-team leaderboards. One small card per display
 * category from sportConfig.stats.categories, showing the top N players
 * by that category's sortKey. Each row links to the player's team page.
 */
export default function TopPerformers({ rows, schoolIndex, sportConfig, n = 5 }) {
  const sportPrefix = useSportPrefix();
  const categories = sportConfig?.stats?.categories ?? [];
  if (!rows || rows.length === 0 || categories.length === 0) return null;

  // Pre-compute leaders per category so we can short-circuit when every
  // category is empty (e.g., Bound returns only "Team" rows with no
  // per-player breakdown — current state of volleyball coverage).
  const cards = categories
    .map((category) => ({ category, leaders: topPerformers(rows, category, n) }))
    .filter(({ leaders }) => leaders.length > 0);
  if (cards.length === 0) return null;

  return (
    <div className="top-performers">
      {cards.map(({ category, leaders }) => {
        return (
          <article key={category.id} className="top-card">
            <header className="top-card__header">
              <h3 className="top-card__title">{category.displayLabel} Leaders</h3>
            </header>
            <ol className="top-card__list">
              {leaders.map((r, idx) => {
                const school = schoolIndex.get(r.school_id);
                return (
                  <li key={`${r.school_id}-${r.player_name}`} className="top-card__row">
                    <span className="top-card__rank">{idx + 1}</span>
                    <div className="top-card__player">
                      <span className="top-card__name">
                        {r.player_name}
                        {r.player_year && (
                          <span className="top-card__year"> ({r.player_year})</span>
                        )}
                      </span>
                      <Link
                        to={`${sportPrefix}/team/${r.school_id}`}
                        className="top-card__team"
                      >
                        {school?.name ?? r.school_id}
                      </Link>
                    </div>
                    <span className="top-card__stats">
                      {formatStatsLine(category, r.stats)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </article>
        );
      })}
    </div>
  );
}
