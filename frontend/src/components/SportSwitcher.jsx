import { useId, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { SPORT_IDS, configFor } from "../config/sports.js";
import { SITE } from "../config/site.js";
import Icon from "./Icon.jsx";

const EXPANDED_KEY = `${SITE.storagePrefix}-sports-expanded`;

function readExpanded() {
  try {
    return window.sessionStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeExpanded(v) {
  try {
    window.sessionStorage.setItem(EXPANDED_KEY, v ? "1" : "0");
  } catch {
    /* session storage blocked — expansion just won't persist */
  }
}

/** Sports whose data is refreshing this calendar month. */
function inSeason(id, month) {
  return (configFor(id)?.activeMonths ?? []).includes(month);
}

/**
 * Strip in the masthead for switching between sports.
 *
 * In-season sports lead; the rest sit behind one "More sports" tab. In
 * September that is three sports plus the tab in a single row, where
 * eight chips had wrapped to two rows on desktop and three on a phone —
 * with five of them leading to off-season countdown pages. The sport
 * being viewed always stays visible even when out of season, so the
 * active tab can never vanish from under the reader. Expansion persists
 * for the session.
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
  const { sport: activeSport } = useParams();
  const [showAll, setShowAll] = useState(readExpanded);
  const listId = useId();
  if (SPORT_IDS.length < 2) return null;

  const month = new Date().getMonth();
  const primary = SPORT_IDS.filter((id) => inSeason(id, month) || id === activeSport);
  const rest = SPORT_IDS.filter((id) => !primary.includes(id));
  // Nothing to fold away (every sport in season, or a one-sport tenant):
  // plain strip, no toggle.
  const foldable = rest.length > 0 && primary.length > 0;
  const collapsed = foldable && !showAll;
  const shown = collapsed ? primary : [...primary, ...rest];

  const toggle = () => {
    setShowAll((v) => {
      writeExpanded(!v);
      return !v;
    });
  };

  return (
    <nav className="sport-switcher" aria-label="Sport">
      <ul
        id={listId}
        className={
          "sport-switcher__list" + (collapsed ? " sport-switcher__list--collapsed" : "")
        }
        style={collapsed ? { "--switcher-cols": shown.length + 1 } : undefined}
      >
        {shown.map((id) => {
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
                {/* Drawn icon keyed by sport id; cfg.icon (emoji) is kept
                    in the config for the rasterized share cards only. */}
                <span className="sport-switcher__icon" aria-hidden="true">
                  <Icon name={cfg.id} />
                </span>
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
        {foldable && (
          <li className="sport-switcher__item">
            <button
              type="button"
              className="sport-switcher__tab sport-switcher__more"
              aria-expanded={!collapsed}
              aria-controls={listId}
              aria-label={
                collapsed
                  ? `Show ${rest.length} more ${rest.length === 1 ? "sport" : "sports"} (off-season)`
                  : "Show fewer sports"
              }
              onClick={toggle}
            >
              <span className="sport-switcher__icon" aria-hidden="true">
                <Icon name="chevron" />
              </span>
              <span className="sport-switcher__label" aria-hidden="true">
                {collapsed ? `${rest.length} more sports` : "Fewer sports"}
              </span>
              <span
                className="sport-switcher__label sport-switcher__label--short"
                aria-hidden="true"
              >
                {collapsed ? `+${rest.length} more` : "Fewer"}
              </span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
