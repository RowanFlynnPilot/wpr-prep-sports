/**
 * The mini scoreboard's embed snippet — one source for the media-kit
 * builder, the README, and the Playwright guard that proves the heights.
 *
 * WordPress article and homepage blocks can't carry a resize script (the
 * WAF rejects any "<script" in a post body), so the iframe renders at the
 * height typed here. Each value is the tallest mini the layout can produce
 * — every slot full, the longest school names, a sold sponsor, 300px wide
 * (measured 2026-09-15: 521px single, 558px switcher) — plus a little air.
 * A shorter mini stretches its card to the frame (MiniScoreboard's
 * `mini--fill`), so the extra never shows as a gap on the host page. The
 * guard in e2e/mini.spec.js fails if a layout change ever outgrows these.
 *
 * Pure data + string building: no import.meta, so Node (Playwright) can
 * import it too.
 */

export const MINI_HEIGHTS = {
  // Header, presenter strip, 4 score cards, 3 fixtures, footer.
  single: 540,
  // The same plus the sport switcher row.
  switcher: 580,
};

/** Widest the module is designed for; wider columns center it. */
export const MINI_MAX_WIDTH = 420;

/**
 * iframe markup for a placement. `sport` is one sport id, or null with
 * `switcher: true` for the in-season switcher.
 */
export function miniEmbedSnippet({ origin, sport = "football", switcher = false, to = null }) {
  const base = origin.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (switcher) params.set("sports", "in-season");
  else params.set("sport", sport);
  if (to) params.set("to", to);
  const src = `${base}/mini.html?${params.toString()}`;
  const height = switcher ? MINI_HEIGHTS.switcher : MINI_HEIGHTS.single;
  return {
    src,
    height,
    html: `<iframe
  src="${src}"
  width="100%" height="${height}" frameborder="0" loading="lazy"
  title="Central Wisconsin Prep Sports scoreboard"
  style="border:0;display:block;max-width:${MINI_MAX_WIDTH}px;margin:0 auto;"></iframe>`,
  };
}
