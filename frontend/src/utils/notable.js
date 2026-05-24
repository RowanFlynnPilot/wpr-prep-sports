/**
 * "Notable" auto-detectors — sportscaster-style headlines computed
 * from the existing data. No new scrape inputs needed.
 *
 * Each detector returns 0+ items. An item is:
 *   { id, headline, schoolId?, sport, priority }
 *
 * The dashboard sorts by priority (higher = more newsworthy) and
 * shows the top N. Phrasing variants are picked deterministically by
 * hashing the item id so the SAME storyline reads the same way
 * across page loads — no jitter, no surprise.
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
    ...detectCloseGames(games, sport),
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
    const isLossStreak = item.id?.startsWith("streak-l-");
    if (isLossStreak && lossStreakCount >= 1) continue;
    if (isLossStreak) lossStreakCount++;
    out.push(item);
    if (out.length >= NOTABLE_LIMIT) break;
  }
  return out;
}

/* ---------------- phrasing helpers ---------------- */

/**
 * Deterministic hash → 0..1 from a string. Same input always picks the
 * same variant; different teams get different variants. Tiny xorshift,
 * not crypto.
 */
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < (s ?? "").length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h / 0xffffffff;
}
function pick(seed, choices) {
  return choices[Math.floor(seed * choices.length) % choices.length];
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
    const streakEntries = [];
    for (const entry of list) {
      const kind = entry.won ? "W" : entry.lost ? "L" : null;
      if (!kind) break;
      if (streakKind === null) streakKind = kind;
      if (kind !== streakKind) break;
      streak++;
      streakEntries.push(entry);
    }
    if (streak < 4) continue;

    const name = list[0].teamName;
    const seed = hashSeed(`streak-${schoolId}-${streak}`);

    if (streakKind === "W") {
      // Average win margin — adds editorial color when convincing.
      const avgMargin = Math.round(
        streakEntries.reduce((acc, e) => acc + e.margin, 0) / streakEntries.length,
      );
      const dominant = avgMargin >= dominantMarginThreshold(sport);
      const variants = dominant
        ? [
            `${name} has reeled off ${streak} straight wins, averaging a ${avgMargin}-point margin.`,
            `${name}'s ${streak}-game winning streak has been a runaway — ${avgMargin} points per game on average.`,
            `${name} keeps stacking blowouts: ${streak} in a row by an average of ${avgMargin}.`,
            `${name} hasn't lost in ${streak}, winning by an average of ${avgMargin}.`,
          ]
        : [
            `${name} has won ${streak} straight.`,
            `${name} rides a ${streak}-game winning streak into ${nextWeekDescriptor()}.`,
            `${name} has stacked ${streak} consecutive victories.`,
            `${name}'s ${streak}-game heater shows no signs of slowing.`,
            `${name} keeps winning — ${streak} in a row now.`,
          ];
      out.push({
        id: `streak-w-${schoolId}`,
        headline: pick(seed, variants),
        schoolId,
        sport,
        priority: 60 + streak * 8 + (dominant ? 10 : 0),
      });
    } else {
      // Loss streak — sparser variants, no flair.
      const variants = [
        `${name} has dropped ${streak} in a row.`,
        `${name} is in a ${streak}-game skid.`,
        `${name} hasn't won in ${streak} games.`,
      ];
      out.push({
        id: `streak-l-${schoolId}`,
        headline: pick(seed, variants),
        schoolId,
        sport,
        priority: Math.min(20 + streak * 2, 45),
      });
    }
  }
  return out;
}

function dominantMarginThreshold(sport) {
  switch (sport) {
    case "football": return 21;
    case "boys_basketball":
    case "girls_basketball": return 20;
    case "volleyball": return 2; // average set margin (3-1 = 2)
    case "boys_hockey":
    case "girls_hockey": return 4;
    default: return 15;
  }
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
        const seed = hashSeed(`undef-${r.school_id}-${r.conference_wins}`);
        const variants = [
          `${r.name} is unbeaten in ${s.conference} play at ${r.conference_wins}-0.`,
          `${r.name} hasn't dropped a ${s.conference} game yet — ${r.conference_wins}-0 in conference.`,
          `${r.name} is rolling through ${s.conference}, undefeated at ${r.conference_wins}-0.`,
          `${r.name} owns ${s.conference} so far, sitting at ${r.conference_wins}-0.`,
        ];
        out.push({
          id: `undef-${sport}-${r.school_id}`,
          headline: pick(seed, variants),
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
  const cutoff = Date.now() - 14 * 86_400_000;
  const recent = (games ?? [])
    .filter((g) => g.status === "final" && new Date(g.date).getTime() > cutoff)
    .filter((g) => g.home.school_id || g.away.school_id)
    .filter((g) => {
      const a = g.home.score, b = g.away.score;
      return a != null && b != null && Math.abs(a - b) >= threshold;
    });
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
  const seed = hashSeed(`blowout-${g.id}`);
  const verb = pick(seed, ["routed", "blew out", "hammered", "ran past", "buried"]);
  return [{
    id: `blowout-${g.id}`,
    headline: `${winner.name} ${verb} ${loser.name} ${winner.score}-${loser.score}.`,
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
    case "volleyball": return 3;
    case "boys_hockey":
    case "girls_hockey": return 6;
    default: return 25;
  }
}

/** A recent, close finalized game between two tracked teams. */
function detectCloseGames(games, sport) {
  const threshold = closeGameThreshold(sport);
  const cutoff = Date.now() - 10 * 86_400_000;
  const recent = (games ?? [])
    .filter((g) => g.status === "final" && new Date(g.date).getTime() > cutoff)
    .filter((g) => g.home.school_id && g.away.school_id) // both tracked
    .filter((g) => {
      const a = g.home.score, b = g.away.score;
      return a != null && b != null && Math.abs(a - b) <= threshold && Math.abs(a - b) > 0;
    });
  if (recent.length === 0) return [];
  // Closest margin wins; break ties with most recent.
  recent.sort((a, b) => {
    const ma = Math.abs(a.home.score - a.away.score);
    const mb = Math.abs(b.home.score - b.away.score);
    if (ma !== mb) return ma - mb;
    return new Date(b.date) - new Date(a.date);
  });
  const g = recent[0];
  const winner = g.home.score > g.away.score ? g.home : g.away;
  const loser = g.home.score > g.away.score ? g.away : g.home;
  const margin = Math.abs(g.home.score - g.away.score);
  const seed = hashSeed(`close-${g.id}`);
  const variants = [
    `${winner.name} edged ${loser.name} ${winner.score}-${loser.score} in a ${margin}-point thriller.`,
    `${winner.name} survived ${loser.name} ${winner.score}-${loser.score} — decided by ${margin}.`,
    `${winner.name} took ${loser.name} to the wire, winning ${winner.score}-${loser.score}.`,
    `Just ${margin} ${margin === 1 ? "point" : "points"} separated ${winner.name} and ${loser.name} (${winner.score}-${loser.score}).`,
  ];
  return [{
    id: `close-${g.id}`,
    headline: pick(seed, variants),
    schoolId: winner.school_id,
    sport,
    priority: 32,
  }];
}

function closeGameThreshold(sport) {
  switch (sport) {
    case "football": return 7;
    case "boys_basketball":
    case "girls_basketball": return 5;
    case "volleyball": return 1; // 3-2
    case "boys_hockey":
    case "girls_hockey": return 1;
    default: return 5;
  }
}

/** Teams that won their state title. */
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
    const loser = g.home.score > g.away.score ? g.away : g.home;
    if (!winner.school_id) continue;
    const margin = Math.abs(g.home.score - g.away.score);
    const venue = sport === "football" ? "at Camp Randall" : "";
    const seed = hashSeed(`champ-${g.id}`);
    const titleNoun = championshipNoun(sport);
    const variants = margin >= 14
      ? [
          `${winner.name} captured the ${titleNoun}, ${margin} points clear of ${loser.name}${venue ? " " + venue : ""}.`,
          `${winner.name} lifted the ${titleNoun} with a dominant win over ${loser.name}, ${winner.score}-${loser.score}.`,
          `${winner.name} hoisted the ${titleNoun} trophy ${venue ? venue + " " : ""}after beating ${loser.name} ${winner.score}-${loser.score}.`,
        ]
      : [
          `${winner.name} captured the ${titleNoun}, edging ${loser.name} ${winner.score}-${loser.score}${venue ? " " + venue : ""}.`,
          `${winner.name} lifted the ${titleNoun} trophy with a ${winner.score}-${loser.score} win over ${loser.name}.`,
          `${winner.name} survived ${loser.name} ${winner.score}-${loser.score} to claim the ${titleNoun}.`,
        ];
    out.push({
      id: `champ-${g.id}`,
      headline: pick(seed, variants),
      schoolId: winner.school_id,
      sport,
      priority: 100,
    });
  }
  return out;
}

function championshipNoun(sport) {
  switch (sport) {
    case "football": return "state title";
    case "boys_basketball":
    case "girls_basketball": return "state championship";
    case "volleyball": return "state championship";
    case "boys_hockey":
    case "girls_hockey": return "state title";
    default: return "championship";
  }
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
  const seed = hashSeed(`bigweek-${g.id}`);
  const variants = [
    `${dateLabel}: ${g.away.name} at ${g.home.name} — two top-3 teams collide.`,
    `Mark the calendar — ${g.away.name} visits ${g.home.name} ${dateLabel}, both ranked top-3.`,
    `${dateLabel} brings a heavyweight matchup: ${g.away.name} at ${g.home.name}.`,
  ];
  return [{
    id: `bigweek-${g.id}`,
    headline: pick(seed, variants),
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
    if (!player || player === "Team") continue;
    const yds = asNum(s.YDS);
    const tds = asNum(s.TDS);
    const pts = asNum(s.PTS) || asNum(s.PPG);
    const seed = hashSeed(`mile-${row.school_id}-${player}-${row.category}`);

    if (row.category === "Passing" && Number.isFinite(yds) && yds >= 2000) {
      const tdClause = Number.isFinite(tds) && tds > 15 ? ` and ${tds} touchdowns` : "";
      out.push(mileItem(row, sport, pick(seed, [
        `${player} has thrown for ${yds.toLocaleString()} yards${tdClause} this season.`,
        `${player}'s ${yds.toLocaleString()}-yard passing season${tdClause} ranks among the area's best.`,
        `${player} is up to ${yds.toLocaleString()} passing yards${tdClause}.`,
      ]), 30));
    }
    if (row.category === "Rushing" && Number.isFinite(yds) && yds >= 1500) {
      const tdClause = Number.isFinite(tds) && tds > 15 ? ` (${tds} TDs)` : "";
      out.push(mileItem(row, sport, pick(seed, [
        `${player} has rushed for ${yds.toLocaleString()} yards${tdClause}.`,
        `${player} keeps grinding it out — ${yds.toLocaleString()} rushing yards${tdClause}.`,
        `${player} sits at ${yds.toLocaleString()} rushing yards${tdClause}.`,
      ]), 30));
    }
    if (row.category === "Receiving" && Number.isFinite(yds) && yds >= 1000) {
      out.push(mileItem(row, sport, pick(seed, [
        `${player} has piled up ${yds.toLocaleString()} receiving yards.`,
        `${player}'s ${yds.toLocaleString()}-yard receiving season is one of the area's loudest.`,
        `${player} is up to ${yds.toLocaleString()} receiving yards.`,
      ]), 28));
    }
    if (row.category === "Basketball" && Number.isFinite(pts) && pts >= 25) {
      out.push(mileItem(row, sport, pick(seed, [
        `${player} is averaging ${pts.toFixed(1)} points per game — one of the top scorers around.`,
        `${player} pours it in nightly, averaging ${pts.toFixed(1)} per game.`,
        `${player} is at ${pts.toFixed(1)} PPG and still climbing.`,
      ]), 28));
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

function nextWeekDescriptor() {
  // Reads natural without anchoring to a real date. "this week" is
  // fine year-round; the streak callout is about an ongoing run.
  return "this week";
}

function asNum(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}
