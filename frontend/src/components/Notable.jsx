import { useMemo } from "react";
import { Link } from "react-router-dom";
import { buildNotable } from "../utils/notable.js";
import { useSportPrefix } from "../utils/links.js";

/**
 * "Notable" — auto-generated sportscaster headlines derived from the
 * existing data (streaks, undefeated runs, recent blowouts, state
 * champions, big upcoming matchups, season milestones).
 *
 * Renders nothing when no callout clears the priority floor — quiet
 * sports/weeks don't field a half-filled card.
 */
export default function Notable({ games, standings, seasonStats, sportConfig, schoolIndex }) {
  const items = useMemo(
    () => buildNotable({ games, standings, seasonStats, sportConfig }),
    [games, standings, seasonStats, sportConfig],
  );
  const sportPrefix = useSportPrefix();
  if (items.length === 0) return null;

  return (
    <section className="notable" aria-label="Notable storylines">
      <header className="notable__header">
        <span className="notable__eyebrow">Notable</span>
        <span className="notable__hint">storylines from the data</span>
      </header>
      <ul className="notable__list">
        {items.map((item) => {
          const school = item.schoolId ? schoolIndex?.get?.(item.schoolId) : null;
          const accent = school?.colors?.[0] ?? null;
          const body = (
            <span className="notable__headline">{item.headline}</span>
          );
          return (
            <li
              key={item.id}
              className="notable__item"
              style={accent ? { "--school-color": accent } : undefined}
            >
              {item.schoolId ? (
                <Link
                  to={`${sportPrefix}/team/${item.schoolId}`}
                  className="notable__link"
                >
                  {body}
                </Link>
              ) : (
                <div className="notable__static">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
