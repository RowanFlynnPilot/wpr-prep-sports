/**
 * Football season totals vs the game log on the same player page.
 *
 * Season totals come from Bound's per-team season pages; per-game lines
 * come from Bound AND MaxPreps and refresh daily. The two drift apart:
 * on 2026-10-09 Marshfield's QB showed 454 passing yards above a game
 * log that summed to 854, because the season file had frozen at the
 * last full Bound fetch and two games had MaxPreps-only lines. A parent
 * checks these numbers to the yard, and the Player of the Week credit
 * links straight here.
 *
 * Rule: a season total can never be smaller than what the game log
 * already shows. For every counting stat (yards, touchdowns, carries,
 * receptions, tackles, sacks, interceptions) take the larger of the
 * season figure and the game-log sum; recompute the ratios that depend
 * on them; drop the ones that can't be rebuilt (passer rating). Rows
 * that changed carry `reconciled: { games }` so the page can say so.
 *
 * Football only. Basketball season rows are per-game averages (PPG,
 * RPG) and volleyball's are already aggregated from the same game lines.
 */

const CATEGORY_MAP = {
  Passing: {
    perGame: "Passing Yards",
    counts: [["YDS", ["YDS", "Yds"]], ["TDS", ["TDS", "TD"]], ["INT", ["INT", "Int"]]],
  },
  Rushing: {
    perGame: "Rushing Yards",
    counts: [["YDS", ["YDS", "Yds"]], ["TDS", ["TDS", "TD"]], ["CAR", ["ATT", "Car"]]],
  },
  Receiving: {
    perGame: "Receiving Yards",
    counts: [["YDS", ["YDS", "Yds"]], ["TDS", ["TDS", "TD"]], ["REC", ["REC", "Rec"]]],
  },
  Defense: {
    perGame: "Total Tackles",
    counts: [["TOT", ["TKL", "Tot Tckls"]], ["SACKS", ["SKS"]], ["SOLO", ["SOLO", "Solo"]], ["TFL", ["TFL"]]],
  },
};

function num(v) {
  if (v == null || v === "") return NaN;
  const n = parseFloat(String(v).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function pick(stats, keys) {
  for (const k of keys) {
    const n = num(stats?.[k]);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/** "6/9" or COMP + ATT from a passing line → [completions, attempts]. */
function compAtt(stats) {
  const ca = stats?.["C/A"] ?? stats?.["C/ATT"];
  if (typeof ca === "string" && ca.includes("/")) {
    const [c, a] = ca.split("/").map(num);
    if (Number.isFinite(c) && Number.isFinite(a)) return [c, a];
  }
  const c = pick(stats, ["COMP", "C"]);
  const a = pick(stats, ["ATT", "Att"]);
  if (Number.isFinite(c) && Number.isFinite(a)) return [c, a];
  return null;
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * @param {Array} seasonRows  rows from season_stats.json for one player
 * @param {Array} gameLog     [{ game, lines }] from findPlayerGameLog
 * @param {string} sportId
 * @returns {Array} rows, with any corrected row replaced by a copy
 */
export function reconcileSeasonTotals(seasonRows, gameLog, sportId) {
  if (sportId !== "football" || !seasonRows?.length || !gameLog?.length) {
    return seasonRows ?? [];
  }
  return seasonRows.map((row) => {
    const map = CATEGORY_MAP[row.category];
    if (!map) return row;
    const lines = [];
    for (const entry of gameLog) {
      for (const l of entry.lines ?? []) {
        if (l.category === map.perGame) lines.push(l);
      }
    }
    if (lines.length === 0) return row;

    const stats = { ...(row.stats ?? {}) };
    let changed = false;
    for (const [seasonKey, perGameKeys] of map.counts) {
      let sum = 0;
      let seen = false;
      for (const l of lines) {
        const n = pick(l.stats, perGameKeys);
        if (Number.isFinite(n)) {
          sum += n;
          seen = true;
        }
      }
      if (!seen) continue;
      const have = num(stats[seasonKey]);
      if (!Number.isFinite(have) || sum > have) {
        stats[seasonKey] = fmt(sum);
        changed = true;
      }
    }
    if (!changed) return row;

    // Ratios that depend on the counts we just raised.
    if (row.category === "Passing") {
      let c = 0;
      let a = 0;
      let complete = true;
      for (const l of lines) {
        const pair = compAtt(l.stats);
        if (!pair) {
          complete = false;
          break;
        }
        c += pair[0];
        a += pair[1];
      }
      const seasonPair = compAtt(stats);
      if (complete && a > 0 && (!seasonPair || a > seasonPair[1])) {
        stats["C/ATT"] = `${c}/${a}`;
        stats.PCT = `${((c / a) * 100).toFixed(1)}%`;
        if (c > 0) stats.YPC = (num(stats.YDS) / c).toFixed(1);
      }
      delete stats.RTG; // can't be rebuilt from a box score
    } else if (row.category === "Rushing") {
      const car = num(stats.CAR);
      if (car > 0) stats.YPC = (num(stats.YDS) / car).toFixed(1);
    } else if (row.category === "Receiving") {
      const rec = num(stats.REC);
      if (rec > 0) stats.YPC = (num(stats.YDS) / rec).toFixed(1);
    }
    return { ...row, stats, reconciled: { games: lines.length } };
  });
}
