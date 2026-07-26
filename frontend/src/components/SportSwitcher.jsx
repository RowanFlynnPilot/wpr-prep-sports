import { NavLink } from "react-router-dom";
import { SPORT_IDS, configFor } from "../config/sports.js";

/**
 * Strip in the masthead for switching between sports. Each entry is a
 * NavLink so react-router applies the active class automatically when the
 * current URL is inside that sport.
 *
 * The strip WRAPS rather than scrolls — with eight-plus sports we want
 * every one visible (no tabs hidden behind a scroll fade), so the entries
 * fill the row and wrap onto a second row as needed.
 *
 * These are NAVIGATION links, not tabs: each one changes the route and
 * loads a different sport's dataset, and there is no single panel they
 * swap. They previously carried role="tab" without aria-selected,
 * aria-controls, or a tabpanel, which told a screen reader "tablist" and
 * then honoured none of the behaviour that promises. A labelled <nav> plus
 * aria-current is the accurate description. (SectionTabs, by contrast, IS
 * a real tablist — same page, swapped panel — and implements it fully.)
 *
 * Renders nothing if only one sport is registered — no point showing a
 * switcher with a single immutable option.
 */
export default function SportSwitcher() {
  if (SPORT_IDS.length < 2) return null;

  return (
    <nav className="sport-switcher" aria-label="Sport">
      <ul className="sport-switcher__list">
        {SPORT_IDS.map((id) => {
          const cfg = configFor(id);
          return (
            <li key={id} className="sport-switcher__item">
              <NavLink
                to={`/${id}`}
                // Both label variants stay in the DOM so CSS can swap them
                // by viewport — but that made every sport announce twice
                // ("FootballFootball"). Name the link once, explicitly, and
                // hide the visual spans from assistive tech.
                aria-label={cfg.label}
                // NavLink sets aria-current="page" on the active link itself
                // — it just never surfaced before, because role="tab"
                // overrode the link semantics it belongs to.
                className={({ isActive }) =>
                  "sport-switcher__tab" +
                  (isActive ? " sport-switcher__tab--active" : "")
                }
              >
                {cfg.icon && (
                  <span className="sport-switcher__icon" aria-hidden="true">
                    {cfg.icon}
                  </span>
                )}
                <span className="sport-switcher__label" aria-hidden="true">
                  {cfg.label}
                </span>
                <span
                  className="sport-switcher__label sport-switcher__label--short"
                  aria-hidden="true"
                >
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
