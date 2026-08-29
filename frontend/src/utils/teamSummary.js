/**
 * One school's season at a glance: record, recent form, last/next game, and
 * where they sit in their conference.
 *
 * Extracted from EmbedPage so the per-school embed and the favorites strip
 * compute the same numbers from the same code — two implementations of
 * "what's this team's record" would drift, and the embed is sold inventory.
 */

/** A school's games for the loaded sport, oldest first. */
export function teamGamesFor(games, schoolId) {
  return (games ?? [])
    .filter((g) => g.home.school_id === schoolId || g.away.school_id === schoolId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Record, last five results, and the bracketing games.
 * `now` is injectable so callers can anchor to a season window rather than
 * wall-clock (the dashboard does this in preseason).
 */
export function summarizeTeam(teamGames, schoolId, { now = Date.now() } = {}) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  const form = [];
  let lastGame = null;

  for (const g of teamGames) {
    if (g.status !== "final") continue;
    // WIAA posts forfeits as FINALS on their future scheduled date (e.g.
    // a 1-0 credited six weeks out). Counting those today inflates the
    // record and makes "Last" show a game that hasn't happened — skip
    // finals still ahead of the clock; they count when their date passes.
    if (new Date(g.date).getTime() > now) continue;
    const isHome = g.home.school_id === schoolId;
    const ours = isHome ? g.home.score : g.away.score;
    const theirs = isHome ? g.away.score : g.home.score;
    if (ours == null || theirs == null) continue;
    // Soccer has real draws — a "T" in the form strip, not a red "L".
    if (ours > theirs) wins++;
    else if (theirs > ours) losses++;
    else ties++;
    form.push(ours > theirs ? "W" : theirs > ours ? "L" : "T");
    lastGame = g;
  }

  const nextGame =
    teamGames.find(
      (g) => g.status === "scheduled" && new Date(g.date).getTime() >= now,
    ) ?? null;

  return {
    wins,
    losses,
    ties,
    form: form.slice(-5),
    lastGame,
    nextGame,
    hasSeasonStarted: wins + losses + ties > 0,
  };
}

/**
 * Conference placement for a school in one sport. Returns null when the
 * school doesn't play that sport; rank/size are null when the table hasn't
 * been published yet (normal mid-rollover).
 */
export function conferenceStanding(school, sport, standings, schoolId) {
  const conference = school?.conferences?.find?.((c) => c.sport === sport)?.conference;
  if (!conference) return null;
  const table = (standings ?? []).find((s) => s.conference === conference);
  if (!table) return { conference, rank: null, size: null };
  const idx = table.rows.findIndex((r) => r.school_id === schoolId);
  return {
    conference,
    rank: idx >= 0 ? idx + 1 : null,
    size: table.rows.length,
  };
}
