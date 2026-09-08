/**
 * The Central Wisconsin Ten — a weekly hyperlocal poll.
 *
 * Filters the sport's Power Index rankings to schools in the publisher's
 * home region (SITE.homeRegionCities, matched via `homeRegionSchoolIds`)
 * and takes the top N. Each pick gets an editorial lede drawn from the
 * team's latest final via `recap.js`, so the artifact reads like a
 * sports desk wrote it rather than a scores widget printed it. The
 * ordering is algorithmic and matches PowerRankings; the framing —
 * hyperlocal cut, one-sentence lede per team, Monday-morning cadence —
 * is what makes it uncopyable.
 *
 * Editorial override (`data/regional_top10.json`) is the same pattern as
 * `data/potw.json`: entries there replace the algorithm's rank + lede
 * for the specified school, so Rowan/Shereen can promote a team the
 * numbers haven't caught up to yet, or replace an algorithmic sentence
 * with a hand-written one. Missing overrides fall through cleanly.
 */

import { homeRegionSchoolIds } from "./schools.js";
import { recapForGame } from "./recap.js";

export const REGIONAL_TOP_N = 10;

/**
 * Build the Central Wisconsin Ten for the loaded sport.
 *
 * Returns null when there is no home-region cut to make (no cities
 * configured, or no rankings yet), so the caller can skip rendering
 * without a placeholder card.
 *
 * @param {object} p
 * @param {{ schools, games, powerRankings, standings }} p.dataset  full loaded dataset
 * @param {Map} p.schoolIndex   from utils/schools.indexSchools
 * @param {object} p.sportConfig
 * @param {object|null} [p.override]   { entries: [{school_id, rank?, lede?}] }
 * @param {number} [p.size]     top N, default 10
 */
export function pickRegionalTop10({
  dataset,
  schoolIndex,
  sportConfig,
  override = null,
  size = REGIONAL_TOP_N,
}) {
  if (!dataset) return null;
  const { schools, games, powerRankings, standings } = dataset;
  const rankings = powerRankings?.rankings ?? [];
  if (rankings.length === 0) return null;

  const homeRegion = homeRegionSchoolIds(schools);
  if (homeRegion.size === 0) return null;

  const inRegion = rankings.filter((r) => homeRegion.has(r.school_id));
  if (inRegion.length === 0) return null;

  // Overrides: rank-pin one school (override.rank), replace its lede, or
  // both. Applied AFTER the algorithmic cut so an editor pin can promote
  // an unranked team into the list; anyone the editor demoted stays in
  // the pool but slides down.
  const overrideById = new Map();
  for (const entry of override?.entries ?? []) {
    if (entry?.school_id) overrideById.set(entry.school_id, entry);
  }
  const withPins = [...inRegion];
  for (const [id, entry] of overrideById) {
    if (entry.rank == null) continue;
    // Ensure the pinned school appears in the pool even if unranked.
    if (!withPins.some((r) => r.school_id === id)) {
      const school = schoolIndex?.get?.(id);
      withPins.push({
        rank: null,
        school_id: id,
        school_name: school?.name ?? id,
        wins: 0,
        losses: 0,
        ties: 0,
        movement: null,
        score: null,
      });
    }
  }

  // Sort: pinned ranks first (in the editor's order), then the algorithm.
  withPins.sort((a, b) => {
    const pa = overrideById.get(a.school_id)?.rank;
    const pb = overrideById.get(b.school_id)?.rank;
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return (a.rank ?? 999) - (b.rank ?? 999);
  });

  const top = withPins.slice(0, size).map((r, i) => {
    const rank = i + 1;
    const editorLede = overrideById.get(r.school_id)?.lede ?? null;
    const school = schoolIndex?.get?.(r.school_id);
    const conference = standingConference(standings, r.school_id, sportConfig?.id);
    const division = school?.wiaa_division?.[sportConfig?.id] ?? null;

    // Movement is versus the ALGORITHMIC ranking, not the pinned order —
    // a pin that moved a team up shouldn't be printed as "▲ 3" week over
    // week. Ranks change only if the underlying power_rankings changed.
    const movement = r.movement ?? null;

    const lede = editorLede ?? algorithmicLede({
      schoolId: r.school_id,
      games,
      schoolIndex,
      sportConfig,
    });

    return {
      rank,
      school_id: r.school_id,
      school_name: r.school_name,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
      ties: r.ties ?? 0,
      conference,
      division,
      movement,
      lede,
      isEditorPick: overrideById.has(r.school_id),
    };
  });

  return {
    method: "Home-region cut of the WPR Power Index; ledes from each team's latest final.",
    editorial: overrideById.size > 0,
    teams: top,
  };
}

function standingConference(standings, schoolId, sportId) {
  if (!Array.isArray(standings)) return null;
  for (const table of standings) {
    if (sportId && table.sport && table.sport !== sportId) continue;
    for (const row of table.rows ?? []) {
      if (row.school_id === schoolId) return table.conference;
    }
  }
  return null;
}

/**
 * The team's latest final, phrased in `recap.js`'s voice — the same
 * sentence engine every game row uses, so the poll reads like the rest
 * of the paper. Returns "Idle this week." when the team's most recent
 * game hasn't happened yet, and null when there's no context to write
 * from (rare — a ranked team with zero games shouldn't reach us).
 */
function algorithmicLede({ schoolId, games, schoolIndex, sportConfig }) {
  const teamGames = (games ?? [])
    .filter((g) => g.home?.school_id === schoolId || g.away?.school_id === schoolId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (teamGames.length === 0) return null;

  const finals = teamGames.filter(
    (g) => g.status === "final" && g.home.score != null && g.away.score != null,
  );
  if (finals.length === 0) return "Yet to open the season.";

  const latest = finals[finals.length - 1];
  const sentence = recapForGame(latest, {
    schoolsById: schoolIndex,
    teamGames,
    perspectiveSchoolId: schoolId,
    sportConfig,
  });
  return stripTrailingDate(sentence);
}

/**
 * Every recap.js sentence ends in " on <Weekday, Mon D>." — that reads
 * right in a game row (where the date is context) and redundant in a
 * weekly poll (where the header already prints the week). Strip it, but
 * only when the tail matches — a sentence built without a date (a rare
 * edge case) is left alone.
 */
function stripTrailingDate(sentence) {
  if (!sentence) return null;
  return sentence.replace(
    /\s+on\s+[A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d+(\.)$/,
    "$1",
  );
}
