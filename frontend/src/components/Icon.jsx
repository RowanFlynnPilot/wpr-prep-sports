/**
 * The widget's icon set — authored inline SVG, one stroke weight, one
 * grid. Replaces the emoji that stood in for icons in the section tabs
 * and sport switcher: emoji render as each OS's color art (an orange
 * "VS" square on Android, Apple's glossy ball on iOS), which is the one
 * element on a monochrome page that never matched the page.
 *
 * Sized with 1em so the surrounding text style sets the size, and
 * stroked with currentColor so it takes the tab's ink/white/red state
 * for free. Sport ids alias to a shared drawing (boys/girls basketball
 * share one ball).
 */

const ALIASES = {
  boys_basketball: "basketball",
  girls_basketball: "basketball",
  boys_hockey: "hockey",
  girls_hockey: "hockey",
  boys_soccer: "soccer",
  girls_soccer: "soccer",
};

// 24×24 grid, stroke paths only (no fills), so every icon shares weight.
const PATHS = {
  // Section tabs
  scores: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M3 9.5h18"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  standings: '<path d="M4 4v16h16"/><path d="M8 16V9M12 16V6M16 16v-4"/>',
  spotlight:
    '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  // Sports
  football:
    '<path d="M5.2 18.8c-1.6-1.6-1.4-6.3 2.9-10.7S16.9 3.6 18.8 5.2s1.4 6.3-2.9 10.7S6.8 20.4 5.2 18.8z"/><path d="M8.6 15.4l6.8-6.8M10.2 12.2l1.6 1.6M12.2 10.2l1.6 1.6"/>',
  basketball:
    '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6c3.6 3.6 3.6 9.2 0 12.8M18.4 5.6c-3.6 3.6-3.6 9.2 0 12.8"/>',
  volleyball:
    '<circle cx="12" cy="12" r="9"/><path d="M12 3c-3 3-3.6 7.2-1.6 10.3M3.3 13.4c4.1-.6 8 .9 10.3 3.8M20.7 9.6c-4 1.4-6.4 4.6-6.9 8.6"/>',
  hockey: '<path d="M5 3l7.4 12.3c.6 1 1.6 1.7 2.8 1.7H19"/><ellipse cx="7.5" cy="19" rx="3" ry="1.5"/>',
  soccer:
    '<circle cx="12" cy="12" r="9"/><path d="M12 8.2l3.7 2.7-1.4 4.3H9.7l-1.4-4.3z"/><path d="M12 3v5.2M20.5 9.6l-4.8 1.3M18.6 18.3l-4.3-3.1M5.4 18.3l4.3-3.1M3.5 9.6l4.8 1.3"/>',
};

export default function Icon({ name, className = "" }) {
  const key = ALIASES[name] ?? name;
  const markup = PATHS[key];
  if (!markup) return null;
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
