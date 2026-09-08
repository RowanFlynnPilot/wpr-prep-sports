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
 * One-line editorial nudge to follow a school, shown while none is
 * followed. Sits BELOW the hero as a subtle hint at the finder already
 * living in the masthead — a full-width promotional band here (five
 * critique runs) read as a second CTA competing with the finder for the
 * same intent.
 *
 * The main action is now a plain text link inline in the prose. "Find
 * your school" focuses the masthead combobox (scrolling it into view on
 * phones); "A–Z" is the no-typing path. "Dismiss" hides the nudge for
 * 30 days on this device. Renders nothing once a school is followed.
 */
export default function FollowPrompt() {
  const favorites = useFavorites();
  const sportPrefix = useSportPrefix();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed || favorites.length > 0) return null;

  const focusFinder = (e) => {
    e.preventDefault();
    trackEvent("follow-prompt", { action: "find" });
    const el = document.getElementById(FINDER_INPUT_ID);
    if (!el) {
      navigate(`${sportPrefix}/teams`);
      return;
    }
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  };
  const dismiss = (e) => {
    e.preventDefault();
    trackEvent("follow-prompt", { action: "dismiss" });
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage blocked — hide for this visit only */
    }
    setDismissed(true);
  };

  return (
    <div className="follow-prompt" role="note">
      <p className="follow-prompt__text">
        <span className="follow-prompt__star" aria-hidden="true">
          ☆
        </span>{" "}
        <a href="#find-your-school" onClick={focusFinder} className="follow-prompt__find">
          Find your school
        </a>{" "}
        or{" "}
        <Link
          to={`${sportPrefix}/teams`}
          className="follow-prompt__all"
          onClick={() => trackEvent("follow-prompt", { action: "index" })}
        >
          browse A–Z
        </Link>{" "}
        to pin its last result and next game to the top of every sport.
      </p>
      <button
        type="button"
        className="follow-prompt__dismiss"
        onClick={dismiss}
        aria-label="Dismiss this follow-your-school note"
        title="Dismiss"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
