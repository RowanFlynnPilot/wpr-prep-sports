import { useEffect, useRef, useState } from "react";
import { SITE } from "../config/site.js";
import { trackEvent } from "../utils/analytics.js";
import { calendarFeedUrl, calendarLinks } from "../utils/calendarFeed.js";
import Icon from "./Icon.jsx";
import Sponsor from "./Sponsor.jsx";

/**
 * "Add to calendar" on a team page: subscribe a phone calendar to the
 * team's feed (data/calendar/<school>/<sport>.ics, built by
 * scraper/scripts/build_calendars.py) or to every sport the school plays.
 *
 * A subscription, not a one-off download: the feed is rebuilt on every
 * scrape, so moved games move and final scores land in the event title.
 * Research for review run 21 (2026-11-21): Bound, TeamSnap and SportsYou
 * all give parents this; it keeps the hub's name and game links on their
 * phone for the whole season.
 *
 * Two pieces so the page can place them apart: the toggle rides in the
 * hero's Follow / Share row, and the panel is its own full-width row of
 * the hero (on a phone the action row sits in a ~170px column beside the
 * logo, far too narrow for four app buttons). The panel is in the page
 * flow, not a popover, so the iframe edge can't clip it, and every
 * destination opens in a new tab: webcal: and the calendar sites can't
 * load inside the embed.
 */
export const calendarsEnabled = () => SITE.features?.calendars !== false;

export default function CalendarButton({ open, onToggle, panelId, sportId }) {
  if (!calendarsEnabled()) return null;
  return (
    <button
      type="button"
      className="cal-toggle"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => {
        if (!open) trackEvent("calendar_open", { sport: sportId });
        onToggle();
      }}
    >
      <span className="cal-toggle__icon" aria-hidden="true">
        <Icon name="schedule" />
      </span>
      Add to calendar
    </button>
  );
}

export function CalendarPanel({ panelId, schoolId, schoolName, sportId, sportLabel, sponsors }) {
  const [scope, setScope] = useState("team"); // team | school
  const [copied, setCopied] = useState(null); // null | "copied" | "manual"
  const inputRef = useRef(null);

  useEffect(() => {
    if (copied === "manual" && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [copied]);

  if (!calendarsEnabled() || !schoolId || !sportId) return null;

  const feed = scope === "school" ? "all" : sportId;
  const name = scope === "school" ? `${schoolName} sports` : `${schoolName} ${sportLabel}`;
  const url = calendarFeedUrl(schoolId, feed);
  const links = calendarLinks(url, name);

  const track = (app) => trackEvent("calendar", { app, scope, sport: sportId });

  const copy = async () => {
    track("copy");
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      // Clipboard is permission-gated inside the iframe; show the link.
      setCopied("manual");
    }
  };

  const choose = (value) => {
    setScope(value);
    setCopied(null);
  };

  return (
    <div className="cal-panel" id={panelId} role="group" aria-label="Add games to your calendar">
      <p className="cal-panel__lede">
        Every game lands in your phone&rsquo;s calendar. If a time changes, the calendar changes
        too, and the final score fills in after the game.
      </p>

      <div className="cal-panel__scope" role="radiogroup" aria-label="Which games">
        <label className="cal-panel__choice">
          <input
            type="radio"
            name={`${panelId}-scope`}
            value="team"
            checked={scope === "team"}
            onChange={() => choose("team")}
          />
          <span>{sportLabel} only</span>
        </label>
        <label className="cal-panel__choice">
          <input
            type="radio"
            name={`${panelId}-scope`}
            value="school"
            checked={scope === "school"}
            onChange={() => choose("school")}
          />
          <span>Every {schoolName} sport</span>
        </label>
      </div>

      <div className="cal-panel__apps">
        <a
          className="cal-panel__app"
          href={links.apple}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("apple")}
        >
          iPhone or Mac
        </a>
        <a
          className="cal-panel__app"
          href={links.google}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("google")}
        >
          Google Calendar
        </a>
        <a
          className="cal-panel__app"
          href={links.outlook}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("outlook")}
        >
          Outlook
        </a>
        <button type="button" className="cal-panel__app" onClick={copy}>
          {copied === "copied" ? "Link copied" : "Copy link"}
        </button>
      </div>

      {copied === "manual" && (
        <div className="cal-panel__manual">
          <label className="sr-only" htmlFor={`${panelId}-url`}>
            Calendar link
          </label>
          <input
            id={`${panelId}-url`}
            ref={inputRef}
            className="share__url"
            type="text"
            readOnly
            value={url}
          />
        </div>
      )}

      <span className="sr-only" role="status">
        {copied === "copied" ? "Calendar link copied" : ""}
      </span>

      <p className="cal-panel__note">
        Google Calendar can take up to a day to show changes. For other apps, copy the link and
        add it as a calendar subscription.
      </p>

      <Sponsor slot="calendar" sponsors={sponsors} variant="inline" className="cal-panel__sponsor" />
    </div>
  );
}
