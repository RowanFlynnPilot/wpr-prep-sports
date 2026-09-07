import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Icon from "./Icon.jsx";
import { useSchoolsContext } from "../utils/schoolsContext.js";
import { conferenceFor, searchSchools } from "../utils/schoolSearch.js";
import { useSportPrefix } from "../utils/links.js";
import { trackEvent } from "../utils/analytics.js";

/** Stable id so the follow prompt can move focus here from the page body. */
export const FINDER_INPUT_ID = "school-finder-input";

/**
 * "Find your school" — the masthead combobox.
 *
 * Sixty-seven schools, and until this existed a team page was reachable
 * only through a standings row (which needs the conference), a This Week
 * row (only if they played), or Favorites (settable only from a team
 * page). The one question this audience arrives with — did my kid's
 * team win — routed through knowledge a grandparent doesn't have.
 *
 * ARIA combobox pattern: the input owns the listbox, arrow keys move an
 * active option, Enter opens it, Escape closes then clears. Options are
 * mouse-down-suppressed so clicking one doesn't blur the input before the
 * click lands. Renders nothing outside a sport route (no roster to search).
 */
export default function SchoolFinder({ className = "", placeholder = "Find your school" }) {
  const ctx = useSchoolsContext();
  const sportPrefix = useSportPrefix();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const listId = useId();

  const results = useMemo(
    () => (ctx ? searchSchools(ctx.schools, query) : []),
    [ctx, query],
  );

  // Close on any pointer press outside the finder.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!ctx) return null;
  const { sportId } = ctx;

  const go = (school) => {
    trackEvent("school-find", { school: school.id, sport: sportId });
    setQuery("");
    setOpen(false);
    setActive(-1);
    navigate(`${sportPrefix}/team/${school.id}`);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      const pick = active >= 0 ? results[active] : results.length === 1 ? results[0] : null;
      if (pick) {
        e.preventDefault();
        go(pick);
      }
    } else if (e.key === "Escape") {
      if (open) {
        setOpen(false);
        setActive(-1);
      } else if (query) {
        setQuery("");
      }
    }
  };

  const typed = query.trim().length > 0;
  const showPop = open && typed;
  const hasList = showPop && results.length > 0;
  const optId = (i) => `${listId}-opt-${i}`;

  return (
    <div ref={rootRef} className={`school-finder ${className}`.trim()}>
      <label htmlFor={FINDER_INPUT_ID} className="sr-only">
        Find your school
      </label>
      <span className="school-finder__icon" aria-hidden="true">
        <Icon name="search" />
      </span>
      <input
        id={FINDER_INPUT_ID}
        type="search"
        className="school-finder__input"
        placeholder={placeholder}
        value={query}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        role="combobox"
        aria-expanded={hasList}
        aria-controls={hasList ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={hasList && active >= 0 ? optId(active) : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {showPop && (
        <div className="school-finder__pop">
          {hasList ? (
            <ul id={listId} role="listbox" aria-label="Schools" className="school-finder__list">
              {results.map((s, i) => {
                const conf = conferenceFor(s, sportId);
                const sub = [s.mascot, s.city].filter(Boolean).join(" · ");
                return (
                  <li
                    key={s.id}
                    id={optId(i)}
                    role="option"
                    aria-selected={i === active}
                    className={
                      "school-finder__opt" + (i === active ? " school-finder__opt--active" : "")
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(s)}
                  >
                    <TeamLogo
                      team={{ school_id: s.id, name: s.name, logo_url: s.logo_url ?? null }}
                      school={s}
                      size="sm"
                    />
                    <span className="school-finder__opt-name">{s.name}</span>
                    <span className="school-finder__opt-sub">
                      {sub}
                      {conf ? ` · ${conf}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="school-finder__none" role="status">
              No school matches &ldquo;{query.trim()}&rdquo;. Try the town&rsquo;s name.
            </p>
          )}
          <Link
            to={`${sportPrefix}/teams`}
            className="school-finder__all"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false);
              setQuery("");
            }}
          >
            All schools A–Z <span aria-hidden="true">›</span>
          </Link>
        </div>
      )}
    </div>
  );
}
