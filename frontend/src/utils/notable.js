/**
 * "Notable" auto-detectors — sportscaster-style headlines computed
 * from the existing data. No new scrape inputs needed.
 *
 * Each detector returns 0+ items. An item is:
 *   { id, headline, schoolId?, sport, priority }
 *
 * The dashboard sorts by priority (higher = more newsworthy) and
 * shows the top N.
 */

/** Maximum number of callouts shown on the dashboard. */
export const NOTABLE_LIMIT = 5;

/**
 * Run every detector and return the top callouts. Pure read-only —
 * fed the same dataset the dashboard already has.
 */
export function buildNotable({ games, standings, seasonStats, sportConfig }) {
  const sport = sportConfig?.id ?? "";
  const all = [
    ...detectStreaks(games, sport),
    ...detectUndefeatedConference(standings, sport),
    ...detectBlowouts(games, sport),
    ...detectStateChampions(games, sport),
    ...detectBigGameAheadThisWeek(games, standings, sport),
    ...detectSeasonStandouts(seasonStats, sport),
  ];
  all.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  // Cap loss-streak items at 1 — a parade of losses reads bleak even
  // when factually accurate. Editorial preference for upbeat coverage.
  const out = [];
  let lossStreakCount = 0;
  for (const item of all) {
    const isLossStreak = item.id?.startsWith("streak-") &&
      /\bhas lost\b/.test(item.headline ?? "");
    if (isLossStreak && lossStreakCount >= 1) continue;
    if (isLossStreak) lossStreakCount++;
    out.push(item);
    if (out.length >= NOTABLE_LIMIT) break;
  }
  return out;
}

/* ---------------- detectors ---------------- */

/** Active win or loss streaks of 4+ games on tracked teams. */
function detectStreaks(games, sport) {
  const finals = (games ?? []).filter((g) => g.status === "final");
  const byTeam = new Map();
  for (const g of finals) {
    pushTeamGame(byTeam, g, g.home, g.away);
    pushTeamGame(byTeam, g, g.away, g.home);
  }
  const out = [];
  for (const [schoolId, list] of byTeam) {
    if (!schoolId) continue;
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    let streak = 0;
    let streakKind = null;
    for (const entry of list) {
      const kind = entry.won ? "W" : entry.lost ? "L" : null;
      if (!kind) break;
      if (streakKind === null) streakKind = kind;
      if (kind !== streakKind) break;
      streak++;
    }
    if (streak >= 4) {
      const name = list[0].teamName;
      const verb = streakKind === "W" ? "has won" : "has lost";
      // Win streaks score much higher than loss streaks at equal length —
      // editorial preference for upbeat callouts. Loss streaks still
      // surface when nothing else qualifies, just behind wins.
      const priority = streakKind === "W"
        ? 60 + streak * 8
        : Math.min(20 + streak * 2, 45);
      out.push({
        id: `streak-${schoolId}`,
        headline: `${name} ${verb} ${streak} in a row.`,
        schoolId,
        sport,
        priority,
      });
    }
  }
  return out;
}

function pushTeamGame(byTeam, g, own, opp) {
  const sid = own.school_id;
  if (!sid) return;
  if (own.score == null || opp.score == null) return;
  if (!byTeam.has(sid)) byTeam.set(sid, []);
  byTeam.get(sid).push({
    date: g.date,
    teamName: own.name,
    won: own.score > opp.score,
    lost: own.score < opp.score,
    margin: Math.abs(own.score - opp.score),
    oppName: opp.name,
  });
}

/** Teams still undefeated in their conference. */
function detectUndefeatedConference(standings, sport) {
  const out = [];
  for (const s of standings ?? []) {
    for (const r of s.rows ?? []) {
      const played = (r.conference_wins ?? 0) + (r.conference_losses ?? 0);
      if (played >= 4 && r.conference_losses === 0) {
        out.push({
          id: `undef-${sport}-${r.school_id}`,
          headline: `${r.name} is unbeaten in ${s.conference} play at ${r.conference_wins}-0.`,
          schoolId: r.school_id,
          sport,
          priority: 40 + r.conference_wins,
        });
      }
    }
  }
  return out;
}

/** Recent finalized games with margins ≥ a sport-appropriate threshold. */
function detectBlowouts(games, sport) {
  const threshold = blowoutThreshold(sport);
  const cutoff = Date.now() - 8 * 86_400_000; // last 8 days
  const recent = (games ?? [])
    .filter((g) => g.status === "final" && new Date(g.date).getTime() > cutoff)
    .filter((g) => g.home.school_id || g.away.school_id) // at least one tracked side
    .filter((g) => {
      const a = g.home.score, b = g.away.score;
      return a != null && b != null && Math.abs(a - b) >= threshold;
    });
  // Keep at most one — biggest margin wins.
  recent.sort(
    (a, b) =>
      Math.abs(b.home.score - b.away.score) -
      Math.abs(a.home.score - a.away.score),
  );
  const g = recent[0];
  if (!g) return [];
  const winner = g.home.score > g.away.score ? g.home : g.away;
  const loser = g.home.score > g.away.score ? g.away : g.home;
  const margin = Math.abs(g.home.score - g.away.score);
  return [{
    id: `blowout-${g.id}`,
    headline: `${winner.name} blew out ${loser.name} by ${margin} (${winner.score}-${loser.score}).`,
    schoolId: winner.school_id,
    sport,
    priority: 25 + Math.min(margin / 5, 15),
  }];
}

function blowoutThreshold(sport) {
  switch (sport) {
    case "football": return 40;
    case "boys_basketball":
    case "girls_basketball": return 30;
    case "volleyball": return 3; // sets won; volleyball maxes 3-0
    case "boys_hockey":
    case "girls_hockey": return 6;
    default: return 25;
  }
}

/** Teams that won their state title (using TournamentBracket's logic). */
const STATE_TITLE_ROUNDS = new Set([
  "Level 4", "State Final", "State Championship",
]);
function detectStateChampions(games, sport) {
  const out = [];
  for (const g of games ?? []) {
    if (!g.playoff || g.status !== "final") continue;
    if (!STATE_TITLE_ROUNDS.has(g.playoff_round ?? "")) continue;
    if (g.home.score == null || g.away.score == null) continue;
    const winner = g.home.score > g.away.score ? g.home : g.away;
    if (!winner.school_id) continue;
    out.push({
      id: `champ-${g.id}`,
      headline: `${winner.name} won the ${g.playoff_round}.`,
      schoolId: winner.school_id,
      sport,
      priority: 100,
    });
  }
  return out;
}

/** This-week matchups between two strong (top-3 in any conference) teams. */
function detectBigGameAheadThisWeek(games, standings, sport) {
  const topIds = new Set();
  for (const s of standings ?? []) {
    (s.rows ?? []).slice(0, 3).forEach((r) => r.school_id && topIds.add(r.school_id));
  }
  if (topIds.size === 0) return [];
  const now = Date.now();
  const oneWeek = 7 * 86_400_000;
  const candidates = (games ?? []).filter(
    (g) =>
      g.status === "scheduled" &&
      topIds.has(g.home.school_id) &&
      topIds.has(g.away.school_id) &&
      new Date(g.date).getTime() > now &&
      new Date(g.date).getTime() < now + oneWeek,
  );
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => new Date(a.date) - new Date(b.date));
  const g = candidates[0];
  const dateLabel = new Date(g.date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  return [{
    id: `bigweek-${g.id}`,
    headline: `${dateLabel}: ${g.away.name} at ${g.home.name} — two top-3 teams meet.`,
    sport,
    priority: 35,
  }];
}

/** Players hitting milestone season totals. */
function detectSeasonStandouts(seasonStats, sport) {
  const out = [];
  for (const row of seasonStats ?? []) {
    const s = row.stats ?? {};
    const player = row.player_name;
    // Bound rolls up a per-team aggregate row named "Team" — that's not
    // a person; skip so we don't print "Team is averaging 60 PPG."
    if (!player || player === "Team") continue;
    const yds = asNum(s.YDS);
    const tds = asNum(s.TDS);
    const pts = asNum(s.PTS) || asNum(s.PPG);
    // Football milestones
    if (row.category === "Passing" && Number.isFinite(yds) && yds >= 2000) {
      out.push(mileItem(row, sport, `${player} has thrown for ${yds.toLocaleString()} yards this season.`, 30));
    }
    if (row.category === "Rushing" && Number.isFinite(yds) && yds >= 1500) {
      out.push(mileItem(row, sport, `${player} has rushed for ${yds.toLocaleString()} yards this season.`, 30));
    }
    if (row.category === "Receiving" && Number.isFinite(yds) && yds >= 1000) {
      out.push(mileItem(row, sport, `${player} has piled up ${yds.toLocaleString()} receiving yards.`, 28));
    }
    // Basketball PPG milestone
    if (row.category === "Basketball" && Number.isFinite(pts) && pts >= 25) {
      out.push(mileItem(row, sport, `${player} is averaging ${pts.toFixed(1)} points per game.`, 28));
    }
  }
  return out;
}

function mileItem(row, sport, headline, priority) {
  return {
    id: `mile-${row.school_id}-${row.player_name}-${row.category}`.replace(/\s+/g, "-"),
    headline,
    schoolId: row.school_id,
    sport,
    priority,
  };
}

function asNum(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}
