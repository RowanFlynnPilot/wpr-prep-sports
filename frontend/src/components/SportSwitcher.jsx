import { NavLink } from "react-router-dom";
import { SPORT_IDS, configFor } from "../config/sports.js";

/**
 * Tab strip in the masthead for switching between sports. Each tab is a
 * NavLink so react-router applies the active class automatically when
 * the current URL is inside that sport.
 *
 * Renders nothing if only one sport is registered — no point showing
 * a switcher with a single immutable option.
 */
export default function SportSwitcher() {
  if (SPORT_IDS.length < 2) return null;

  return (
    <nav className="sport-switcher" aria-label="Sport">
      <ul className="sport-switcher__list" role="tablist">
        {SPORT_IDS.map((id) => {
          const cfg = configFor(id);
          return (
            <li key={id} className="sport-switcher__item" role="presentation">
              <NavLink
                to={`/${id}`}
                role="tab"
                className={({ isActive }) =>
                  "sport-switcher__tab" +
                  (isActive ? " sport-switcher__tab--active" : "")
                }
              >
                <span className="sport-switcher__label">{cfg.label}</span>
                <span className="sport-switcher__label sport-switcher__label--short">
                  {cfg.shortLabel ?? cfg.label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
