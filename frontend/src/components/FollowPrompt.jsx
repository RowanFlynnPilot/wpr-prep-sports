import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FINDER_INPUT_ID } from "./SchoolFinder.jsx";
import { useSportPrefix } from "../utils/links.js";
import { useFavorites } from "../utils/favorites.js";
import { trackEvent } from "../utils/analytics.js";
import { SITE } from "../config/site.js";

const DISMISS_KEY = `${SITE.storagePrefix}-follow-prompt-dismissed`;
const DISMISS_FOR_MS = 30 * 86_400_000;

function readDismissed() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/**
 * One-line nudge to follow a school, shown while none is followed. It
 * sits BELOW the hero: it is an invitation, not the answer, and on a
 * phone it had pushed the first score off screen one. "Find your
 * school" moves focus into the masthead finder (scrolling it into view);
 * the A–Z link is the no-typing path. "Not now" hides it for 30 days on
 * this device. Renders nothing once a school is followed.
 */
export default function FollowPrompt() {
  const favorites = useFavorites();
  const sportPrefix = useSportPrefix();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed || favorites.length > 0) return null;

  const focusFinder = () => {
    trackEvent("follow-prompt", { action: "find" });
    const el = document.getElementById(FINDER_INPUT_ID);
    if (!el) {
      navigate(`${sportPrefix}/teams`);
      return;
    }
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  };
  const dismiss = () => {
    trackEvent("follow-prompt", { action: "dismiss" });
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage blocked — hide for this visit only */
    }
    setDismissed(true);
  };

  return (
    <aside className="follow-prompt" aria-label="Follow your school">
      <span className="follow-prompt__star" aria-hidden="true">
        ☆
      </span>
      <p className="follow-prompt__text">
        <strong>Follow your school.</strong> Their last result and next game pin to the top
        of every sport on this device.
      </p>
      <div className="follow-prompt__actions">
        <button type="button" className="follow-prompt__find" onClick={focusFinder}>
          Find your school
        </button>
        <Link
          to={`${sportPrefix}/teams`}
          className="follow-prompt__all"
          onClick={() => trackEvent("follow-prompt", { action: "index" })}
        >
          All schools A–Z
        </Link>
        <button type="button" className="follow-prompt__dismiss" onClick={dismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}
