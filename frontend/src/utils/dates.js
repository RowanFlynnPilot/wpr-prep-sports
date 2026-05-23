/**
 * Date formatting helpers. All dates in the dataset are tz-aware ISO 8601
 * strings in US/Central. We render in the user's browser locale but with
 * Central-time field values (so a parent in Wausau sees "Friday Oct 24"
 * regardless of where they're reading from).
 */

const CENTRAL = "America/Chicago";

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

export function isFuture(iso, now = new Date()) {
  return new Date(iso).getTime() > now.getTime();
}
