/**
 * Weekly digest export — the Friday roundup for the WPR newsletter.
 *
 * Reuses the frontend's deterministic recap generator (utils/recap.js:
 * every word comes from scraped data, no embellishment) so the digest
 * reads exactly like the widget. Emits markdown (for editors to paste /
 * tweak) and a self-contained HTML fragment (for the email tool) to
 * data/digest/.
 *
 * Usage (from frontend/):
 *   node scripts/build-digest.mjs                       # week ending most recent Friday
 *   node scripts/build-digest.mjs --week-ending 2025-11-14
 *   node scripts/build-digest.mjs --sport football volleyball
 *
 * The "Weekly Roundup presented by ___" line renders when
 * data/sponsors.json has a `digest` slot with a name.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SPORTS, SPORT_IDS } from "../src/config/sports.js";
import { recapForGame } from "../src/utils/recap.js";
import { indexSchools } from "../src/utils/schools.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const OUT_DIR = path.join(DATA_DIR, "digest");
const WIDGET_URL = "https://rowanflynnpilot.github.io/wpr-prep-sports/";

// ---- args ----------------------------------------------------------------

const argv = process.argv.slice(2);
function argValues(flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const vals = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) vals.push(argv[j]);
  return vals;
}

const sports = argValues("--sport") ?? SPORT_IDS;
const weekEndingArg = argValues("--week-ending")?.[0] ?? null;

// Week window: 7 days ending on --week-ending (inclusive), which
// defaults to the most recent Friday. All comparisons in local time —
// game dates carry Central offsets and the digest is a Central-time
// product.
function mostRecentFriday(from = new Date()) {
  const d = new Date(from);
  d.setHours(23, 59, 59, 999);
  while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
  return d;
}
const weekEnd = weekEndingArg
  ? new Date(`${weekEndingArg}T23:59:59`)
  : mostRecentFriday();
const weekStart = new Date(weekEnd);
weekStart.setDate(weekStart.getDate() - 6);
weekStart.setHours(0, 0, 0, 0);

const fmtDay = (d) =>
  d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const fmtShort = (d) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
// Local-time date stamp — toISOString would roll a Central 23:59 into
// the next UTC day.
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---- load ----------------------------------------------------------------

async function readJson(p) {
  return JSON.parse(await readFile(p, "utf-8"));
}
async function readJsonOptional(p) {
  return existsSync(p) ? readJson(p) : null;
}

const schoolsRaw = await readJson(path.join(DATA_DIR, "schools.json"));
const schoolsById = indexSchools(schoolsRaw);
const sponsors = await readJsonOptional(path.join(DATA_DIR, "sponsors.json"));
const digestSponsor = sponsors?.slots?.digest;
const sponsorLine =
  digestSponsor?.name && !/^sample/i.test(digestSponsor.name)
    ? `${digestSponsor.label ?? "Weekly Roundup presented by"} ${digestSponsor.name}`
    : null;

// ---- build per-sport sections ---------------------------------------------

function winnerSchoolId(g) {
  const h = g.home.score ?? null;
  const a = g.away.score ?? null;
  if (h === null || a === null || h === a) return null;
  return h > a ? g.home.school_id || null : g.away.school_id || null;
}

const sections = [];

for (const sportId of sports) {
  const sportConfig = SPORTS[sportId];
  if (!sportConfig) {
    console.warn(`unknown sport '${sportId}' — skipping`);
    continue;
  }
  const base = path.join(DATA_DIR, sportId);
  const games = (await readJsonOptional(path.join(base, "games.json"))) ?? [];
  const standings = (await readJsonOptional(path.join(base, "standings.json"))) ?? [];
  const rankingsRaw = await readJsonOptional(path.join(base, "power_rankings.json"));
  const rankings = Array.isArray(rankingsRaw) ? rankingsRaw : (rankingsRaw?.rankings ?? []);

  const inWindow = games
    .filter((g) => {
      if (g.status !== "final") return false;
      const t = new Date(g.date);
      return t >= weekStart && t <= weekEnd;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (inWindow.length === 0) continue;

  // Group by calendar day.
  const byDay = new Map();
  for (const g of inWindow) {
    const key = isoDate(new Date(g.date));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(g);
  }

  const days = [...byDay.entries()].map(([key, dayGames]) => ({
    label: fmtDay(new Date(`${key}T12:00:00`)),
    games: dayGames.map((g) => {
      const perspective = winnerSchoolId(g) ?? g.home.school_id ?? g.away.school_id;
      const teamGames = perspective
        ? games
            .filter(
              (x) =>
                x.status === "final" &&
                (x.home.school_id === perspective || x.away.school_id === perspective),
            )
            .sort((a, b) => new Date(a.date) - new Date(b.date))
        : null;
      return {
        line: `${g.away.name} ${g.away.score}, ${g.home.name} ${g.home.score}`,
        recap: recapForGame(g, {
          schoolsById,
          teamGames,
          perspectiveSchoolId: perspective,
          sportConfig,
        }),
        url: `${WIDGET_URL}#/${sportId}/game/${g.id}`,
        playoff: g.playoff ? (g.playoff_round ?? "WIAA Tournament") : null,
      };
    }),
  }));

  // Standings snapshot: leaders of each conference that had a game this week.
  const activeConfs = new Set(inWindow.map((g) => g.conference).filter(Boolean));
  const leaders = standings
    .filter((s) => activeConfs.has(s.conference))
    .map((s) => ({
      conference: s.conference,
      top: s.rows.slice(0, 3).map((r, i) => ({
        rank: i + 1,
        name: r.name,
        conf: `${r.conference_wins}-${r.conference_losses}`,
        overall: `${r.overall_wins}-${r.overall_losses}`,
      })),
    }));

  sections.push({
    sportId,
    label: sportConfig.label,
    gameCount: inWindow.length,
    days,
    leaders,
    top5: rankings.slice(0, 5).map((r, i) => ({
      rank: i + 1,
      name: r.name ?? r.school_name ?? r.school_id,
      record: r.record ?? (r.wins != null ? `${r.wins}-${r.losses}` : ""),
    })),
  });
}

if (sections.length === 0) {
  console.log(
    `No final games between ${fmtShort(weekStart)} and ${fmtShort(weekEnd)} — no digest written.`,
  );
  process.exit(0);
}

// ---- render ----------------------------------------------------------------

const title = `Central Wisconsin Prep Sports Weekly — week of ${fmtShort(weekStart)}–${fmtShort(weekEnd)}, ${weekEnd.getFullYear()}`;

let md = `# ${title}\n\n`;
if (sponsorLine) md += `*${sponsorLine}*\n\n`;
md += `The week in central Wisconsin high school sports, from the [WPR scoreboard](${WIDGET_URL}).\n\n`;
for (const s of sections) {
  md += `## ${s.label} — ${s.gameCount} game${s.gameCount === 1 ? "" : "s"}\n\n`;
  for (const day of s.days) {
    md += `**${day.label}**\n\n`;
    for (const g of day.games) {
      md += `- [${g.line}](${g.url})${g.playoff ? ` *(${g.playoff})*` : ""}`;
      if (g.recap) md += ` — ${g.recap}`;
      md += `\n`;
    }
    md += `\n`;
  }
  for (const l of s.leaders) {
    md += `**${l.conference} leaders:** `;
    md += l.top
      .map((t) => `${t.rank}. ${t.name} (${t.conf} conf, ${t.overall} overall)`)
      .join(" · ");
    md += `\n\n`;
  }
  if (s.top5.length > 0) {
    md += `**Power Rankings top 5:** `;
    md += s.top5.map((t) => `${t.rank}. ${t.name}${t.record ? ` (${t.record})` : ""}`).join(" · ");
    md += `\n\n`;
  }
}
md += `---\n\nScores, stats, and standings all season: ${WIDGET_URL}\n`;

const esc = (t) =>
  String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let html = `<div style="font-family: Georgia, 'Times New Roman', serif; color: #0e0f12; max-width: 640px;">\n`;
html += `<h1 style="font-family: 'Arial Narrow', Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.02em; font-size: 22px; color: #004a59;">${esc(title)}</h1>\n`;
if (sponsorLine) html += `<p style="font-style: italic; color: #6b7280;">${esc(sponsorLine)}</p>\n`;
for (const s of sections) {
  html += `<h2 style="font-family: 'Arial Narrow', Arial, sans-serif; text-transform: uppercase; font-size: 17px; border-bottom: 2px solid #f59e0b; padding-bottom: 4px;">${esc(s.label)} — ${s.gameCount} game${s.gameCount === 1 ? "" : "s"}</h2>\n`;
  for (const day of s.days) {
    html += `<p style="font-weight: bold; margin-bottom: 4px;">${esc(day.label)}</p>\n<ul style="margin-top: 0;">\n`;
    for (const g of day.games) {
      html += `<li style="margin-bottom: 6px;"><a href="${g.url}" style="color: #007cba; font-weight: bold; text-decoration: none;">${esc(g.line)}</a>`;
      if (g.playoff) html += ` <em>(${esc(g.playoff)})</em>`;
      if (g.recap) html += ` — ${esc(g.recap)}`;
      html += `</li>\n`;
    }
    html += `</ul>\n`;
  }
  for (const l of s.leaders) {
    html += `<p><strong>${esc(l.conference)} leaders:</strong> ${l.top.map((t) => `${t.rank}. ${esc(t.name)} (${t.conf} conf, ${t.overall} overall)`).join(" · ")}</p>\n`;
  }
  if (s.top5.length > 0) {
    html += `<p><strong>Power Rankings top 5:</strong> ${s.top5.map((t) => `${t.rank}. ${esc(t.name)}${t.record ? ` (${esc(t.record)})` : ""}`).join(" · ")}</p>\n`;
  }
}
html += `<p style="border-top: 1px solid #e7e2d6; padding-top: 8px;">Scores, stats, and standings all season: <a href="${WIDGET_URL}" style="color: #007cba;">the WPR prep sports scoreboard</a></p>\n</div>\n`;

// ---- write ----------------------------------------------------------------

await mkdir(OUT_DIR, { recursive: true });
const stamp = isoDate(weekEnd);
await writeFile(path.join(OUT_DIR, `digest-${stamp}.md`), md, "utf-8");
await writeFile(path.join(OUT_DIR, `digest-${stamp}.html`), html, "utf-8");
await writeFile(path.join(OUT_DIR, "latest.md"), md, "utf-8");
await writeFile(path.join(OUT_DIR, "latest.html"), html, "utf-8");
console.log(
  `Digest written for ${fmtShort(weekStart)}–${fmtShort(weekEnd)}: ${sections
    .map((s) => `${s.label} ${s.gameCount}`)
    .join(", ")} → data/digest/digest-${stamp}.{md,html} (+latest.*)`,
);
