import { useEffect, useRef } from "react";
import { NavLink, useParams } from "react-router-dom";
import { SPORT_IDS, configFor } from "../config/sports.js";

/**
 * Tab strip in the masthead for switching between sports. Each tab is a
 * NavLink so react-router applies the active class automatically when
 * the current URL is inside that sport.
 *
 * Renders nothing if only one sport is registered — no point showing
 * a switcher with a single immutable option.
 *
 * Mobile polish: on narrow viewports the strip can overflow, so we
 * auto-scroll the active tab into view whenever the sport changes.
 * A right-edge fade gradient (CSS-driven) hints there's more to scroll.
 */
export default function SportSwitcher() {
  const { sport } = useParams();
  const navRef = useRef(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !sport) return;
    // Defer one tick so React has committed the active-class swap. We use
    // setTimeout(0) instead of requestAnimationFrame because rAF is
    // throttled in background tabs / some headless environments, and the
    // visual jump on tab change is a fine UX trade.
    const id = setTimeout(() => {
      const active = nav.querySelector(".sport-switcher__tab--active");
      if (!active) return;
      const target =
        active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2;
      nav.scrollLeft = Math.max(0, target);
    }, 0);
    return () => clearTimeout(id);
  }, [sport]);

  if (SPORT_IDS.length < 2) return null;

  return (
    <nav className="sport-switcher" aria-label="Sport" ref={navRef}>
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
