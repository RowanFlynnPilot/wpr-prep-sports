/**
 * Hosted embed helper — auto-resize + scroll restore for widget iframes.
 *
 * Exists because WordPress article saves go through the REST API, and the
 * WAF in front of the site rejects POST bodies containing inline
 * <script> code as stored-XSS ("Updating failed. The response is not a
 * valid JSON response."). Articles therefore paste an iframe plus ONE
 * external script tag pointing here — no inline JS ever enters the post
 * body. If a strict author role strips even the script tag, the iframe's
 * fixed fallback height keeps the widget usable (it scrolls internally).
 *
 * Behavior matches the README's inline page-template snippet:
 *  - `<namespace>:resize`    → set the iframe height to the reported px.
 *  - `<namespace>:navigated` → if in-widget navigation left the iframe's
 *    top edge above the viewport, scroll it back on-screen. Never fires
 *    on plain resizes, so live-score ticks can't move the reader.
 *
 * Multi-frame aware: every message is matched to the iframe whose
 * contentWindow sent it, so a page can hold the full widget plus any
 * number of per-school modules. Iframes added after this script runs are
 * picked up automatically (the scan happens per message).
 *
 * White-label: the widget origin is derived from this file's own src —
 * the helper is always served by the widget deployment itself, so tenant
 * forks need no edits. Message types are matched by ":resize"/":navigated"
 * suffix for the same reason (the namespace prefix is per-tenant).
 */
(function () {
  if (window.__wprPrepSportsEmbed) return; // idempotent if pasted twice
  window.__wprPrepSportsEmbed = true;

  // Breathing room above the widget after a scroll correction. Matches
  // HEADER_OFFSET in the README snippet.
  var HEADER_OFFSET = 12;

  // Origin this file was served from (anchor trick — ES5-safe).
  var WIDGET_ORIGIN = "";
  var script = document.currentScript;
  if (script && script.src) {
    var a = document.createElement("a");
    a.href = script.src;
    WIDGET_ORIGIN = a.protocol + "//" + a.host;
  }

  // The iframe that sent this message — must be the sender's own frame
  // AND loaded from the widget origin, so no framed ad or third-party
  // script on the page can resize our embeds or scroll the reader.
  function frameFor(sourceWindow, origin) {
    var frames = document.getElementsByTagName("iframe");
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f.contentWindow !== sourceWindow) continue;
      if ((f.src || "").indexOf(origin + "/") !== 0) continue;
      return f;
    }
    return null;
  }

  window.addEventListener("message", function (evt) {
    if (!evt.data || typeof evt.data.type !== "string" || !evt.source) return;
    if (WIDGET_ORIGIN && evt.origin !== WIDGET_ORIGIN) return;
    var iframe = frameFor(evt.source, evt.origin);
    if (!iframe) return;

    if (/:resize$/.test(evt.data.type)) {
      var h = Number(evt.data.height);
      if (h > 0 && h < 100000) iframe.style.height = h + "px";
    } else if (/:navigated$/.test(evt.data.type)) {
      var top = iframe.getBoundingClientRect().top;
      if (top < 0) window.scrollBy(0, top - HEADER_OFFSET);
    }
  });
})();
