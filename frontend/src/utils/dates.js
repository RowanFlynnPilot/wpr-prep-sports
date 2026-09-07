/**
 * Date formatting helpers. All dates in the dataset are tz-aware ISO 8601
 * strings in the site's home time zone. We render in the user's browser
 * locale but with home-zone field values (so a parent in Wausau sees
 * "Friday Oct 24" regardless of where they're reading from).
 */
import { SITE } from "../config/site.js";

const CENTRAL = SITE.timeZone;

const DAY_LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  timeZone: CENTRAL,
});
const DATE_MED = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: CENTRAL,
});
const TIME_SHORT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: CENTRAL,
});
const DAY_SHORT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: CENTRAL,
});
const DAY_AND_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: CENTRAL,
});

export function formatGameDay(iso) {
  const d = new Date(iso);
  return DAY_LONG.format(d).toUpperCase();
}

export function formatGameDate(iso) {
  return DATE_MED.format(new Date(iso));
}

export function formatGameTime(iso) {
  return TIME_SHORT.format(new Date(iso));
}

export function formatGameShortDay(iso) {
  return DAY_SHORT.format(new Date(iso)).toUpperCase();
}

/** "Friday, Sep 4" — for prose that names a game day. */
export function formatGameDayDate(iso) {
  return DAY_AND_DATE.format(new Date(iso));
}

/**
 * "Aug 24–30" or "Aug 31–Sep 6" for a school week starting at `startMs`
 * (a local-midnight Monday from utils/weeks.js). Sampled at noon so a
 * reader in another US zone still sees the home zone's Monday.
 */
export function formatWeekRange(startMs, days = 7) {
  const NOON = 12 * 3_600_000;
  const start = new Date(startMs + NOON);
  const end = new Date(startMs + (days - 1) * 86_400_000 + NOON);
  const part = (d, type) => DATE_MED.formatToParts(d).find((p) => p.type === type)?.value ?? "";
  const m1 = part(start, "month");
  const m2 = part(end, "month");
  const d1 = part(start, "day");
  const d2 = part(end, "day");
  return m1 === m2 ? `${m1} ${d1}–${d2}` : `${m1} ${d1}–${m2} ${d2}`;
}

export function isFuture(iso, now = new Date()) {
  return new Date(iso).getTime() > now.getTime();
}
