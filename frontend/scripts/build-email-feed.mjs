/**
 * Email feed for the Sports Update — the weekly (Tuesday) sports edition of
 * the Wausau Pilot & Review newsletter.
 *
 * The newsletter repo (wpr-newsletter) owns the email's layout; this script
 * owns the sports judgment, so the email reads exactly like the site: the
 * same home-region cut (SITE.homeRegionCities), the same deterministic
 * recap sentences (utils/recap.js), the same Player of the Week and Central
 * Wisconsin Ten pickers (and their editor overrides in data/potw.json and
 * data/regional_top10.json). It writes one JSON file the newsletter build
 * reads.
 *
 * Windows, for a Tuesday edition D:
 *   last week = D-7 .. D-1 (Tuesday through Monday): finals, with box-score
 *               stats that have had the weekend to arrive
 *   this week = D .. D+6: the schedule, Friday football included
 *
 * Usage (from frontend/):
 *   node scripts/build-email-feed.mjs                        # edition = today
 *   node scripts/build-email-feed.mjs --date 2026-10-13
 *   node scripts/build-email-feed.mjs --out /tmp/email.json  # default data/digest/email.json
 */

process.env.TZ ||= "America/Chicago";   // see build-digest.mjs: dates and day groupings are Central

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SPORTS, SPORT_IDS } from "../src/config/sports.js";
import { SITE } from "../src/config/site.js";
import { recapForGame, playerLineForGame, gameSummaryLine } from "../src/utils/recap.js";
import { indexSchools, homeRegionSchoolIds } from "../src/utils/schools.js";
import { pickPlayerOfWeek, resolveOverridePotw } from "../src/utils/playerOfWeek.js";
import { pickRegionalTop10 } from "../src/utils/regionalTop10.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const ORIGIN = SITE.widgetOrigin.replace(/\/$/, "");

// ---- args ------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const edition = arg("--date") ? new Date(`${arg("--date")}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
const outPath = path.resolve(arg("--out") ?? path.join(DATA_DIR, "digest", "email.json"));

const day = (offset, h = 0, m = 0, s = 0) => {
  const d = new Date(edition);
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, s, 0);
  return d;
};
const lastStart = day(-7), lastEnd = day(-1, 23, 59, 59);
const aheadStart = day(0), aheadEnd = day(6, 23, 59, 59);

const fmtDay = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const fmtTime = (d) => {
  const h = d.getHours(), m = d.getMinutes();
  if (h === 0 && m === 0) return null;                 // a date-only listing, no start time
  const ap = h < 12 ? "a.m." : "p.m.";
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${ap}`;
};

// ---- load --------------------------------------------------------------------

const readJson = async (p) => JSON.parse(await readFile(p, "utf-8"));
const readOptional = async (p) => (existsSync(p) ? readJson(p) : null);

const schools = await readJson(path.join(DATA_DIR, "schools.json"));
const area = homeRegionSchoolIds(schools);
const potwOverrides = (await readOptional(path.join(DATA_DIR, "potw.json"))) ?? {};
const top10Overrides = (await readOptional(path.join(DATA_DIR, "regional_top10.json"))) ?? {};
const sponsors = await readOptional(path.join(DATA_DIR, "sponsors.json"));
const emailSponsor = sponsors?.slots?.email ?? sponsors?.slots?.digest ?? null;

const isArea = (side) => Boolean(side?.school_id) && area.has(side.school_id);
const touchesArea = (g) => isArea(g.home) || isArea(g.away);
const gameUrl = (sportId, g) => `${ORIGIN}/#/${sportId}/game/${g.id}`;
const team = (side) => ({ school_id: side.school_id || null, name: side.name, score: side.score, area: isArea(side) });

function isForfeit(sportId, g) {
  const hi = Math.max(g.home.score ?? 0, g.away.score ?? 0), lo = Math.min(g.home.score ?? 0, g.away.score ?? 0);
  return (sportId === "football" || sportId.includes("basketball")) && (hi === 1 || hi === 2) && lo === 0;
}

// ---- per sport -----------------------------------------------------------------

const sports = [];
for (const sportId of SPORT_IDS) {
  const sportConfig = SPORTS[sportId];
  const base = path.join(DATA_DIR, sportId);
  const games = (await readOptional(path.join(base, "games.json"))) ?? [];
  if (games.length === 0) continue;
  const standings = (await readOptional(path.join(base, "standings.json"))) ?? [];
  const powerRankings = await readOptional(path.join(base, "power_rankings.json"));
  const schoolIndex = indexSchools(schools, games);
  const when = (g) => new Date(g.date);

  const finals = games
    .filter((g) => g.status === "final" && touchesArea(g) && when(g) >= lastStart && when(g) <= lastEnd)
    .sort((a, b) => when(a) - when(b));
  const upcoming = games
    .filter((g) => touchesArea(g) && when(g) >= aheadStart && when(g) <= aheadEnd && g.status !== "cancelled")
    .sort((a, b) => when(a) - when(b));
  if (finals.length === 0 && upcoming.length === 0) continue;   // out of season

  const results = finals.map((g) => {
    const hs = g.home.score, as = g.away.score;
    const winnerSide = hs > as ? "home" : as > hs ? "away" : null;
    const perspective =
      (winnerSide && isArea(g[winnerSide]) && g[winnerSide].school_id) ||
      (isArea(g.home) ? g.home.school_id : g.away.school_id);
    const teamGames = games
      .filter((x) => x.status === "final" && (x.home.school_id === perspective || x.away.school_id === perspective))
      .sort((a, b) => when(a) - when(b));
    const forfeit = isForfeit(sportId, g);
    return {
      id: g.id,
      date: isoDate(when(g)),
      day_label: fmtDay(when(g)),
      home: team(g.home),
      away: team(g.away),
      winner: winnerSide,
      both_area: isArea(g.home) && isArea(g.away),
      conference_game: Boolean(g.conference_game),
      playoff: g.playoff ? (g.playoff_round ?? `${SITE.governingBody} Tournament`) : null,
      forfeit,
      set_scores: g.set_scores?.length ? g.set_scores : null,
      summary: forfeit ? null : gameSummaryLine(g, { sportConfig }),
      recap: forfeit ? null : recapForGame(g, { schoolsById: schoolIndex, teamGames, perspectiveSchoolId: perspective, sportConfig }),
      player_line: forfeit ? null : (playerLineForGame(g, { contextGames: games, sportConfig })?.text ?? null),
      url: gameUrl(sportId, g),
    };
  });

  // Player of the Week, as the site shows it (editor override first, home-region auto-pick otherwise)
  let potw = null;
  const pick = resolveOverridePotw(potwOverrides[sportId] ?? null, games) ??
    pickPlayerOfWeek(games, { eligibleSchoolIds: area.size ? area : null });
  if (pick) {
    const { line, game, schoolId } = pick;
    const own = game.home.school_id === schoolId ? game.home : game.away;
    const opp = game.home.school_id === schoolId ? game.away : game.home;
    potw = {
      player_name: line.player_name,
      player_year: line.player_year ?? null,
      position: line.position ?? null,
      school_id: schoolId,
      school_name: schoolIndex.get(schoolId)?.name ?? own.name,
      line: line.headline ?? sportConfig?.stats?.gameLine?.format?.(line, { tone: "default" }) ?? null,
      game: { date: isoDate(when(game)), opponent: opp.name, own_score: own.score, opp_score: opp.score, home: game.home.school_id === schoolId },
      week_start: pick.weekStart ? isoDate(new Date(pick.weekStart)) : null,
      source: pick.source ?? "algorithm",
      url: gameUrl(sportId, game),
    };
  }

  // The Central Wisconsin Ten (home-region cut of the Power Index, with each team's latest-final lede)
  const poll = pickRegionalTop10({
    dataset: { schools, games, powerRankings, standings },
    schoolIndex,
    sportConfig,
    override: top10Overrides[sportId] ?? null,
  });
  const top10 = poll?.teams?.map((t) => ({
    rank: t.rank, school_id: t.school_id, name: t.school_name,
    record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
    conference: t.conference, movement: t.movement, lede: t.lede,
  })) ?? null;

  // Conference standings that include a home-region school
  const tables = standings
    .filter((s) => (s.rows ?? []).some((r) => area.has(r.school_id)))
    .map((s) => ({
      conference: s.conference,
      division: s.division ?? null,
      rows: s.rows.map((r) => ({
        school_id: r.school_id, name: r.name, area: area.has(r.school_id),
        conf: `${r.conference_wins}-${r.conference_losses}${r.conference_ties ? `-${r.conference_ties}` : ""}`,
        overall: `${r.overall_wins}-${r.overall_losses}${r.overall_ties ? `-${r.overall_ties}` : ""}`,
      })),
    }));

  sports.push({
    id: sportId,
    label: sportConfig?.label ?? sportId,
    results,
    player_of_week: potw,
    top10,
    standings: tables,
    upcoming: upcoming.map((g) => ({
      id: g.id,
      date: isoDate(when(g)),
      day_label: fmtDay(when(g)),
      time: fmtTime(when(g)),
      home: team(g.home),
      away: team(g.away),
      both_area: isArea(g.home) && isArea(g.away),
      conference_game: Boolean(g.conference_game),
      playoff: g.playoff ? (g.playoff_round ?? `${SITE.governingBody} Tournament`) : null,
      status: g.status,
      url: gameUrl(sportId, g),
    })),
    links: { scores: `${ORIGIN}/#/${sportId}`, standings: `${ORIGIN}/#/${sportId}/standings` },
  });
}

const feed = {
  version: 1,
  generated_at: new Date().toISOString(),
  edition: isoDate(edition),
  last_week: { start: isoDate(lastStart), end: isoDate(lastEnd) },
  this_week: { start: isoDate(aheadStart), end: isoDate(aheadEnd) },
  region: { label: SITE.regionLabel, schools: area.size },
  sponsor: emailSponsor?.name && !/^sample/i.test(emailSponsor.name)
    ? { name: emailSponsor.name, label: emailSponsor.label ?? "Presented by", url: emailSponsor.url ?? null, logo: emailSponsor.logo ?? null }
    : null,
  site: ORIGIN + "/",
  sports,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(feed, null, 1) + "\n", "utf-8");
console.log(
  `email feed for ${feed.edition}: ` +
    sports.map((s) => `${s.label} ${s.results.length} results / ${s.upcoming.length} ahead${s.player_of_week ? " / POTW" : ""}${s.top10 ? " / Top 10" : ""}`).join("; ") +
    ` -> ${outPath}`,
);
