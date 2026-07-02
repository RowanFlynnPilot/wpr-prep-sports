/**
 * Theme resolution — sets data-theme="light|dark" on <html>.
 *
 * Priority:
 *   1. Explicit ?theme=dark|light query param (before the hash), so the
 *      WordPress embed — or a future host with a dark skin — can force
 *      either mode: src=".../wpr-prep-sports/?theme=dark#/football".
 *   2. Embedded (inside an iframe): default LIGHT regardless of the
 *      visitor's OS preference. The WPR page around us is light; a dark
 *      widget island inside a light article looks broken.
 *   3. Standalone: follow prefers-color-scheme, live-updating if the
 *      OS preference changes.
 */
import { isEmbedded } from "./iframe.js";

export function initTheme() {
  const forced = new URLSearchParams(window.location.search).get("theme");
  if (forced === "dark" || forced === "light") {
    apply(forced);
    return;
  }
  if (isEmbedded) {
    apply("light");
    return;
  }
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  apply(mq?.matches ? "dark" : "light");
  mq?.addEventListener?.("change", (e) => apply(e.matches ? "dark" : "light"));
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
}
