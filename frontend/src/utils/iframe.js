/**
 * iframe height reporter.
 *
 * The widget lives inside an iframe on wausaupilotandreview.com. The host
 * doesn't know our content height ahead of time, so we postMessage our
 * scrollHeight up on mount, on every layout change (ResizeObserver), and
 * on hash navigation. The host listens for `wpr-prep-sports:resize` and
 * sets the iframe's height attribute. See README for the WordPress snippet.
 *
 * Posts to window.parent. Safe no-op if we're not actually in an iframe
 * (parent === window) — useful during local dev.
 */

import { useEffect } from "react";
import { SITE } from "../config/site.js";

const MESSAGE_TYPE = `${SITE.messageNamespace}:resize`;
const NAVIGATED_TYPE = `${SITE.messageNamespace}:navigated`;

/**
 * True when the widget is running inside the WPR WordPress iframe (or any
 * other host page) — used to hide dev/diagnostic chrome like the
 * stale-data banner that's useful in standalone preview but noisy for
 * end readers. Also flips to true when `?embed=1` is present on the URL
 * so we can verify the embedded look locally without an actual iframe.
 *
 * Computed once at module load; the embed state can't change during a
 * session (iframe-ness is fixed for the page lifetime, and the query
 * param is read once).
 */
export const isEmbedded = (() => {
  if (typeof window === "undefined") return false;
  if (window.self !== window.top) return true;
  const params = new URLSearchParams(window.location.search);
  return params.get("embed") === "1";
})();

export function useIframeHeightReporter() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return; // not embedded

    let lastHeight = 0;
    const post = () => {
      // Measure the BODY BOX, not documentElement.scrollHeight.
      //
      // scrollHeight is max(content, viewport) — and inside an iframe the
      // viewport IS the height the host just set from our previous message.
      // That makes it a ratchet: once the tall dashboard pushes the frame to
      // ~5000px, a reader opening a team page measures 5000px again (the
      // viewport floor), the value is unchanged, no message is sent, and the
      // frame never shrinks. Verified against the live site through the
      // README's own snippet: navigating dashboard -> team page produced
      // zero resize messages and left thousands of pixels of blank below the
      // content. html and body carry no height rule, so the body box is true
      // content height and falls as well as rises.
      const h = Math.ceil(document.body.getBoundingClientRect().height);
      if (h === lastHeight || h === 0) return;
      lastHeight = h;
      window.parent.postMessage(
        { type: MESSAGE_TYPE, height: h },
        "*",
      );
    };

    post();

    // Observe the body for the same reason: documentElement is the viewport,
    // which the host controls, so it does not resize when our content does.
    const ro = new ResizeObserver(() => post());
    ro.observe(document.body);

    // Hash route changes don't trigger ResizeObserver synchronously.
    // After reposting the height, tell the host a NAVIGATION happened —
    // distinct from a mere resize (images loading, live score ticks),
    // which must never move the reader's scroll position. The host page
    // uses it to pull the widget's top edge back on-screen when the new,
    // differently-sized page leaves the old scroll offset pointing at
    // whatever sits below the iframe. Only the host can do this: we are
    // cross-origin, and this window itself never scrolls. Posted after
    // post() so the host handles the shrink first, then measures.
    const onHash = () =>
      requestAnimationFrame(() => {
        post();
        window.parent.postMessage({ type: NAVIGATED_TYPE }, "*");
      });
    window.addEventListener("hashchange", onHash);

    // Images loading async (logos!) can change layout after first paint.
    const onLoad = () => requestAnimationFrame(post);
    window.addEventListener("load", onLoad);

    return () => {
      ro.disconnect();
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("load", onLoad);
    };
  }, []);
}
