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

const MESSAGE_TYPE = "wpr-prep-sports:resize";

export function useIframeHeightReporter() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return; // not embedded

    let lastHeight = 0;
    const post = () => {
      // scrollHeight on documentElement is the most reliable cross-browser
      // measure for "tallest rendered content."
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      if (h === lastHeight) return;
      lastHeight = h;
      window.parent.postMessage(
        { type: MESSAGE_TYPE, height: h },
        "*",
      );
    };

    post();

    const ro = new ResizeObserver(() => post());
    ro.observe(document.documentElement);

    // Hash route changes don't trigger ResizeObserver synchronously.
    const onHash = () => requestAnimationFrame(post);
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
