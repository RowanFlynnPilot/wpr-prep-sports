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
 * Pick the month the calendar opens on:
 *   1. the current month, if it has games;
 *   2. otherwise the SOONEST month ahead that has games;
 *   3. otherwise the most recent month with games.
 *
 * Step 2 is the one that was missing. The old fallback went straight to the
 * latest game in the dataset, which is right once a season has finished
 * (land on the last month played rather than an empty grid) but wrong
 * before one starts: in July, with a full schedule published, it skipped
 * the whole season and opened on October — the month of the last game —
 * so a reader looking for the opener had to page backwards to find it.
 */
export function pickFocusMonth(games, now = new Date()) {
  const fallback = { year: now.getFullYear(), month: now.getMonth() };
  if (!games || games.length === 0) return fallback;

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  // Compare on a year*12+month ordinal so December -> January is just +1
  // and no month-boundary arithmetic is needed.
  const nowOrd = currentYear * 12 + currentMonth;

  const ords = games
    .map((g) => {
      const d = new Date(g.date);
      return Number.isNaN(d.getTime()) ? null : d.getFullYear() * 12 + d.getMonth();
    })
    .filter((o) => o !== null);
  if (ords.length === 0) return fallback;

  if (ords.includes(nowOrd)) return fallback;

  const upcoming = ords.filter((o) => o > nowOrd);
  const target = upcoming.length > 0 ? Math.min(...upcoming) : Math.max(...ords);
  return { year: Math.floor(target / 12), month: target % 12 };
}

/**
 * The day the calendar opens with its sheet already showing, so the
 * Schedule tab lands on games rather than on a grid of bare numbers
 * (critique run 15): today if it has games, else the next game day in
 * the focused month, else the last game day already played in it. Null
 * when the month has no games.
 */
export function pickInitialDay(gamesByDate, focus, now = new Date()) {
  const prefix = `${focus.year}-${String(focus.month + 1).padStart(2, "0")}-`;
  const days = [...gamesByDate.keys()].filter((d) => d.startsWith(prefix)).sort();
  if (days.length === 0) return null;
  const today = toISOString(now);
  if (days.includes(today)) return today;
  const upcoming = days.find((d) => d > today);
  return upcoming ?? days[days.length - 1];
}

/**
 * Order for a day sheet: kickoff time, then games with a home-region
 * school first, then the home team's name — so a 33-game Friday reads as
 * a timetable instead of dataset order.
 */
export function sortDayGames(games, homeRegionIds) {
  const local = (g) =>
    homeRegionIds?.has?.(g.home?.school_id) || homeRegionIds?.has?.(g.away?.school_id) ? 0 : 1;
  return [...(games ?? [])].sort(
    (a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime() ||
      local(a) - local(b) ||
      String(a.home?.name ?? "").localeCompare(String(b.home?.name ?? "")),
  );
}

/** Month names for the calendar header. */
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Short weekday labels for the calendar column headers. */
export const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
