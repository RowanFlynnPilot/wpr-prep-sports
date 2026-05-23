/**
 * Central registry of every sport this widget can render.
 *
 * Phase 1 of the sport-switcher refactor: only the cosmetic + bootstrap
 * fields each sport needs to display its labels correctly live here.
 * Stat categories, thresholds, and recap verbs remain inside the football
 * utils (utils/recap.js, utils/seasonStats.js, utils/seasonSummary.js)
 * for now and will migrate into this registry as basketball/volleyball
 * are wired up — at which point the utils will start taking a
 * `sportConfig` argument instead of hardcoding football's constants.
 *
 * Add a new sport by appending an entry here and creating
 * `data/<id>/` with games.json, standings.json, season_stats.json
 * (optional), and meta.json.
 */

export const DEFAULT_SPORT = "football";

/** Lookup of every sport the frontend knows about. */
export const SPORTS = {
  football: {
    id: "football",
    /** Display label used in section headers and the sport switcher. */
    label: "Football",
    /** Short label for tight UI like the mobile sport switcher. */
    shortLabel: "Football",
    /** Season string used in headers — kept editable in case WIAA changes format. */
    season: "2025–26",
    /**
     * Calendar months (0-indexed: Jan=0) during which this sport's data is
     * expected to refresh frequently. StaleBanner uses this to decide
     * whether a "data is N hours old" warning is appropriate.
     */
    activeMonths: [7, 8, 9, 10], // Aug–Nov
    /** Whether scraper writes a season_stats.json for this sport. */
    hasSeasonStats: true,
  },
  boys_basketball: {
    id: "boys_basketball",
    label: "Boys Basketball",
    shortLabel: "Boys Hoops",
    season: "2025–26",
    activeMonths: [10, 11, 0, 1, 2], // Nov–Mar
    hasSeasonStats: false,
  },
  girls_basketball: {
    id: "girls_basketball",
    label: "Girls Basketball",
    shortLabel: "Girls Hoops",
    season: "2025–26",
    activeMonths: [10, 11, 0, 1, 2], // Nov–Mar
    hasSeasonStats: false,
  },
};

/** All sport ids the registry knows about, in display order. */
export const SPORT_IDS = Object.keys(SPORTS);

/** Look up a sport config. Unknown ids fall back to the default sport. */
export function configFor(sportId) {
  return SPORTS[sportId] ?? SPORTS[DEFAULT_SPORT];
}

/** True if `id` is a known sport. */
export function isKnownSport(id) {
  return Object.prototype.hasOwnProperty.call(SPORTS, id);
}
