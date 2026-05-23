/**
 * Helpers for building sport-scoped URLs.
 *
 * After the sport-switcher refactor, every page route is nested under a
 * `/:sport` prefix (e.g. `/football/team/auburndale`). Components that
 * render internal links use these helpers so they don't have to know
 * the prefix convention — call `useSportPrefix()` once at the top of a
 * component and concatenate.
 */

import { useParams } from "react-router-dom";
import { DEFAULT_SPORT } from "../config/sports.js";

/** "/<sport>" for the current route, or the default sport prefix. */
export function useSportPrefix() {
  const { sport } = useParams();
  return `/${sport ?? DEFAULT_SPORT}`;
}
