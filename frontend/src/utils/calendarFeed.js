/**
 * Team calendar feed URLs (scraper/output/calendar.py writes the files to
 * data/calendar/<school_id>/<sport | all>.ics). Not to be confused with
 * utils/calendar.js, the dashboard's month-grid helpers.
 *
 * The URL is resolved against the page the reader is on, using the same
 * data base fetchDataset reads from, so a white-label tenant or a
 * VITE_DATA_BASE override points subscriptions at its own files.
 */
const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ?? `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

/** Absolute https URL of a feed: feed is a sport id or "all". */
export function calendarFeedUrl(schoolId, feed) {
  const path = `${DATA_BASE}/calendar/${encodeURIComponent(schoolId)}/${encodeURIComponent(feed)}.ics`;
  const here = typeof window !== "undefined" ? window.location.href : "https://localhost/";
  return new URL(path, here).href;
}

/**
 * One-tap subscribe links per calendar app.
 *   apple    webcal:// opens Calendar on iPhone, iPad and Mac
 *   google   Google Calendar's add-by-URL page (cid takes the webcal URL)
 *   outlook  Outlook.com's "subscribe from web" page
 */
export function calendarLinks(httpsUrl, name) {
  const webcal = httpsUrl.replace(/^https?:/, "webcal:");
  return {
    apple: webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    outlook:
      `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}` +
      `&name=${encodeURIComponent(name)}`,
  };
}
