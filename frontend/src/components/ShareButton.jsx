import { useEffect, useRef, useState } from "react";
import { shareLink, shareUrlFor } from "../utils/share.js";
import { trackEvent } from "../utils/analytics.js";

/**
 * Copy/share a link to the current view.
 *
 * Same reasoning as FavoriteButton: a real <button> carrying a word, not a
 * bare glyph. The people most likely to send a game to family are the least
 * likely to recognise an unlabelled share icon.
 *
 * The manual branch isn't a nicety — in a cross-origin iframe both
 * navigator.share and the clipboard are gated by Permissions Policy, so a
 * publisher whose embed omits the `allow` attribute lands here every time.
 * Showing the URL in a focused, pre-selected input means the button still
 * does something useful instead of silently failing.
 */
export default function ShareButton({ route, title, label = "Share", className = "" }) {
  const [state, setState] = useState("idle"); // idle | shared | copied | manual
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const url = shareUrlFor(route);

  const onClick = async () => {
    const result = await shareLink({ url, title });
    if (result === "dismissed") return;
    trackEvent("share", { via: result });
    if (result === "manual") {
      setState("manual");
      return;
    }
    // "shared" (the native sheet handled it) and "copied" are different
    // facts — announcing "Link copied" after a share sheet would be false;
    // nothing touched the clipboard.
    setState(result === "shared" ? "shared" : "copied");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setState("idle"), 2600);
  };

  // Select the URL as soon as the manual field appears, so the reader's next
  // action is one keystroke rather than a drag-select on a phone.
  useEffect(() => {
    if (state === "manual" && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [state]);

  return (
    <span className={`share ${className}`.trim()}>
      <button
        type="button"
        className="share__btn"
        onClick={onClick}
        /* Leads with the visible word. A title that didn't contain "Share"
           became the button's accessible name in testing, which breaks
           Label in Name — voice-control users say what they see, and
           "click Share" has to match. */
        title={`${label} — copy a link to this page`}
      >
        <span className="share__icon" aria-hidden="true">
          ↗
        </span>
        <span className="share__label">
          {state === "copied" ? "Link copied" : state === "shared" ? "Shared" : label}
        </span>
      </button>

      {/* Announced rather than shown-and-hoped-for: the label change alone
          never reaches a screen reader, since nothing moves focus. */}
      <span className="sr-only" role="status">
        {state === "copied" ? "Link copied to clipboard" : state === "shared" ? "Shared" : ""}
      </span>

      {state === "manual" && (
        <span className="share__manual">
          <label className="sr-only" htmlFor="share-url">
            Link to this page
          </label>
          <input
            id="share-url"
            ref={inputRef}
            className="share__url"
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
        </span>
      )}
    </span>
  );
}
