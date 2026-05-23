import { Link } from "react-router-dom";
import {
  formatStatsLine,
  positionFor,
  topPerformers,
} from "../utils/seasonStats.js";

const CATEGORIES = [
  { key: "Passing", title: "Passing" },
  { key: "Rushing", title: "Rushing" },
  { key: "Receiving", title: "Receiving" },
  { key: "Defense", title: "Defense" },
];

/**
 * Top Performers — cross-team leaderboards. One small card per category
 * showing the top 5 players by yardage (passing/rushing/receiving) or
 * tackles (defense). Each row links to the player's team page.
 */
export default function TopPerformers({ rows, schoolIndex, n = 5 }) {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="top-performers">
      {CATEGORIES.map(({ key, title }) => {
        const leaders = topPerformers(rows, key, n);
        if (leaders.length === 0) return null;
        return (
          <article key={key} className="top-card">
            <header className="top-card__header">
              <span className="top-card__position">{positionFor(key)}</span>
              <h3 className="top-card__title">{title} Leaders</h3>
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
                        to={`/team/${r.school_id}`}
                        className="top-card__team"
                      >
                        {school?.name ?? r.school_id}
                      </Link>
                    </div>
                    <span className="top-card__stats">
                      {formatStatsLine(key, r.stats)}
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
