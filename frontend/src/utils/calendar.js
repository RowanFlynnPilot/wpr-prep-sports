/**
 * Month-grid helpers for the dashboard calendar view.
 *
 * Returns a 6-row × 7-col grid of date cells. Each row starts on Sunday.
 * Cells outside the focused month are marked with `inMonth: false` so
 * the UI can dim them.
 */

/**
 * Group games by ISO date (YYYY-MM-DD) in US/Central. Returns a Map keyed
 * by date string.
 */
export function groupGamesByDate(games) {
  const map = new Map();
  for (const g of games ?? []) {
    const d = isoDateFor(g.date);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(g);
  }
  return map;
}

/** Convert an ISO datetime to a YYYY-MM-DD date string in US/Central. */
export function isoDateFor(iso) {
  // The scraper writes US/Central-aware datetimes; slice(0,10) of the ISO
  // works as long as the offset is preserved. Falls back gracefully for
  // malformed inputs.
  if (!iso) return "";
  return String(iso).slice(0, 10);
}

/** Build the 6×7 grid of date strings centered on the given month. */
export function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=Sun
  // Step via setDate(+1) rather than +86_400_000 — adding ms breaks at
  // DST transitions where the local day "lasts" 25 hours (two cells
  // would otherwise land on the same calendar date).
  const today = new Date();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - startWeekday + i);
    cells.push({
      date: d,
      iso: toISOString(d),
      inMonth: d.getMonth() === month,
      isToday: isSameDay(d, today),
    });
  }
  return cells;
}

function toISOString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Pick the month to focus on given a list of games and the current date:
 * if the current month has games, use it. Otherwise jump to the
 * most-recent month with games.
 */
export function pickFocusMonth(games, now = new Date()) {
  const fallback = { year: now.getFullYear(), month: now.getMonth() };
  if (!games || games.length === 0) return fallback;

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const hasCurrent = games.some((g) => {
    const d = new Date(g.date);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  });
  if (hasCurrent) return fallback;

  // Most recent game's month.
  const sorted = [...games].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const latest = new Date(sorted[0].date);
  return { year: latest.getFullYear(), month: latest.getMonth() };
}

/** Month names for the calendar header. */
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Short weekday labels for the calendar column headers. */
export const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
