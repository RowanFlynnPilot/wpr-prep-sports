import { useMemo } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import Sponsor from "../components/Sponsor.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { useSportPrefix } from "../utils/links.js";
import { displayPlayerName, playerProfileHref, playerSlug } from "../utils/players.js";
import { primaryColor } from "../utils/schools.js";
import useDocumentTitle from "../utils/useDocumentTitle.js";
import { SPORT_IDS } from "../config/sports.js";
import "../styles/AllArea.css";

/**
 * The editorial All-Area team (#/<sport>/all-area) — Player and Coach of
 * the Year, first team, second team, honorable mention — from
 * data/all_area.json (docs/all-area.md). The season-ending honors page:
 * the one families screenshot and frame, so it is laid out as a printed
 * honors list rather than a stats table.
 *
 * Shows the newest entry for this sport whose `published` date has
 * arrived. Nothing published yet (the normal state for most of the year)
 * renders a quiet empty state instead of a blank page.
 */
export default function AllAreaPage({ dataset, schoolIndex, sponsors, sportConfig }) {
  const sportPrefix = useSportPrefix();
  const label = sportConfig?.label ?? "Sports";

  const { entry, season } = useMemo(
    () => pickAllAreaEntry(dataset?.allArea, { archiveSeason: dataset?.archiveSeason }),
    [dataset?.allArea, dataset?.archiveSeason],
  );

  // Which (school, player) pairs have a profile page this season — a
  // link to an empty player page is worse than no link.
  const knownPlayers = useMemo(
    () => indexKnownPlayers(dataset?.seasonStats, dataset?.games),
    [dataset?.seasonStats, dataset?.games],
  );

  useDocumentTitle(entry?.title ?? `All-Area ${label}`);

  const breadcrumb = (
    <>
      <Link to={sportPrefix} className="breadcrumb__back">
        <span aria-hidden="true" className="breadcrumb__back-arrow">‹</span>
        Back to {label}
      </Link>
      <span aria-hidden="true" className="breadcrumb__sep">·</span>
      <span className="breadcrumb__current">All-Area team</span>
    </>
  );

  const ctx = { sportPrefix, schoolIndex, knownPlayers };
  const sponsorSlot = entry?.sponsor_slot || "all-area";

  return (
    <Layout
      breadcrumb={breadcrumb}
      sponsors={sponsors}
      footerStats={{
        sports: SPORT_IDS.length,
        games: dataset?.games?.length ?? 0,
        schools: dataset?.schools?.length ?? 0,
      }}
    >
      <article className="all-area">
        <header className="all-area__head">
          <p className="eyebrow eyebrow--accent all-area__eyebrow">
            All-Area · {label}
            {season ? ` · ${season}` : ""}
          </p>
          <h1 className="all-area__title">{entry?.title ?? `All-Area ${label} Team`}</h1>
          <div className="all-area__byline">
            {entry?.published && (
              <span className="all-area__published">
                Announced {formatPublished(entry.published)}
              </span>
            )}
            <Sponsor
              slot={sponsorSlot}
              sponsors={sponsors}
              variant="inline"
              className="all-area__sponsor"
            />
          </div>
          {entry?.intro && <p className="all-area__intro">{entry.intro}</p>}
        </header>

        {!entry ? (
          <EmptyState label={label} sportPrefix={sportPrefix} />
        ) : (
          <>
            {(entry.player_of_year || entry.coach_of_year) && (
              <section className="all-area__honors" aria-label="Season honors">
                {entry.player_of_year && (
                  <HonorCard kind="Player of the Year" honoree={entry.player_of_year} ctx={ctx} />
                )}
                {entry.coach_of_year && (
                  <HonorCard kind="Coach of the Year" honoree={entry.coach_of_year} ctx={ctx} />
                )}
              </section>
            )}

            <TeamSection
              id="first-team"
              heading="First team"
              players={entry.first_team}
              ctx={ctx}
            />
            <TeamSection
              id="second-team"
              heading="Second team"
              players={entry.second_team}
              ctx={ctx}
            />
            <TeamSection
              id="honorable-mention"
              heading="Honorable mention"
              players={entry.honorable_mention}
              ctx={ctx}
              compact
            />
          </>
        )}
      </article>
    </Layout>
  );
}

/* ---------- selection ---------- */

/**
 * Newest entry whose `published` date has arrived. With an archive
 * season selected, that season's entry wins when it exists, so the
 * archive view reads as that year's honors page. Returns
 * { entry, season } or { entry: null, season: null }.
 */
export function pickAllAreaEntry(bySeason, { archiveSeason = null, now = new Date() } = {}) {
  const none = { entry: null, season: null };
  if (!bySeason || typeof bySeason !== "object") return none;
  const live = Object.entries(bySeason)
    .filter(([, e]) => e && typeof e === "object" && isPublished(e.published, now))
    .sort((a, b) => publishedMs(b[1].published) - publishedMs(a[1].published));
  if (!live.length) return none;
  if (archiveSeason) {
    const hit = live.find(([season]) => season === archiveSeason);
    if (hit) return { entry: hit[1], season: hit[0] };
  }
  return { entry: live[0][1], season: live[0][0] };
}

function publishedMs(iso) {
  // Date-only strings parse as UTC midnight; anchor to local midnight so
  // an editor's "2026-11-23" means that morning in central Wisconsin.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function isPublished(iso, now) {
  const ms = publishedMs(iso);
  return Number.isFinite(ms) && ms <= now.getTime();
}

function formatPublished(iso) {
  const ms = publishedMs(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Set of "<school_id>|<player-slug>" for every player with a stat row
 * this season (season totals or a per-game stat line), so honoree names
 * link only to a player page that will have something on it.
 */
export function indexKnownPlayers(seasonStats, games) {
  const known = new Set();
  for (const r of seasonStats ?? []) {
    if (r?.school_id && r?.player_name) known.add(`${r.school_id}|${playerSlug(r.player_name)}`);
  }
  for (const g of games ?? []) {
    for (const l of g?.stat_leaders ?? []) {
      if (l?.team_school_id && l?.player_name) {
        known.add(`${l.team_school_id}|${playerSlug(l.player_name)}`);
      }
    }
  }
  return known;
}

/* ---------- pieces ---------- */

function schoolStyle(school) {
  const color = school ? primaryColor(school) : null;
  return color ? { "--school-color": color } : undefined;
}

function PlayerName({ player, ctx, className }) {
  const name = displayPlayerName(player.player_name);
  const key = `${player.school_id}|${playerSlug(player.player_name)}`;
  if (player.school_id && ctx.knownPlayers.has(key)) {
    return (
      <Link to={playerProfileHref(ctx.sportPrefix, player.school_id, player.player_name)} className={className}>
        {name}
      </Link>
    );
  }
  return <span className={className}>{name}</span>;
}

function SchoolLink({ schoolId, ctx, className }) {
  const school = ctx.schoolIndex?.get?.(schoolId);
  if (!schoolId) return null;
  return (
    <Link to={`${ctx.sportPrefix}/team/${schoolId}`} className={className}>
      {school?.name ?? schoolId}
    </Link>
  );
}

function Logo({ schoolId, ctx, size = "sm", className }) {
  const school = ctx.schoolIndex?.get?.(schoolId);
  return (
    <TeamLogo
      team={{ school_id: schoolId, name: school?.name ?? schoolId ?? "", logo_url: school?.logo_url ?? null }}
      school={school}
      size={size}
      className={className}
    />
  );
}

function HonorCard({ kind, honoree, ctx }) {
  const school = ctx.schoolIndex?.get?.(honoree.school_id);
  const isCoach = !honoree.player_name && honoree.name;
  const meta = [honoree.position, honoree.year].filter(Boolean).join(" · ");
  return (
    <section className="all-area__honor" style={schoolStyle(school)} aria-label={kind}>
      <span className="all-area__honor-bar" aria-hidden="true" />
      <Logo schoolId={honoree.school_id} ctx={ctx} size="lg" className="all-area__honor-logo" />
      <div className="all-area__honor-body">
        <h2 className="all-area__honor-kind">{kind}</h2>
        <p className="all-area__honor-name">
          {isCoach ? (
            <span>{displayPlayerName(honoree.name)}</span>
          ) : (
            <PlayerName player={honoree} ctx={ctx} />
          )}
          {meta && <span className="all-area__honor-meta"> {meta}</span>}
        </p>
        <p className="all-area__honor-school">
          <SchoolLink schoolId={honoree.school_id} ctx={ctx} />
        </p>
        {honoree.line && <p className="all-area__honor-line">{honoree.line}</p>}
      </div>
    </section>
  );
}

function TeamSection({ id, heading, players, ctx, compact = false }) {
  const list = Array.isArray(players) ? players.filter((p) => p && p.player_name) : [];
  if (!list.length) return null;
  return (
    <section className="all-area__team" aria-labelledby={id}>
      <header className="section-header all-area__team-head">
        <h2 id={id}>{heading}</h2>
        <span className="section-header__hint">
          {list.length} {list.length === 1 ? "player" : "players"}
        </span>
      </header>
      <ol className={`all-area__list${compact ? " all-area__list--compact" : ""}`}>
        {list.map((p, i) => {
          const school = ctx.schoolIndex?.get?.(p.school_id);
          return (
            <li
              key={`${p.school_id}-${playerSlug(p.player_name)}-${i}`}
              className="all-area__row"
              style={schoolStyle(school)}
            >
              <span className="all-area__row-bar" aria-hidden="true" />
              <Logo schoolId={p.school_id} ctx={ctx} size="sm" className="all-area__row-logo" />
              <div className="all-area__row-main">
                <span className="all-area__row-top">
                  {p.position && (
                    <span className="all-area__pos">{p.position}</span>
                  )}
                  <PlayerName player={p} ctx={ctx} className="all-area__name" />
                  {p.year && <span className="all-area__year">{p.year}</span>}
                </span>
                <span className="all-area__row-sub">
                  <SchoolLink schoolId={p.school_id} ctx={ctx} className="all-area__school" />
                  {!compact && p.line && (
                    <span className="all-area__line"> · {p.line}</span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function EmptyState({ label, sportPrefix }) {
  return (
    <section className="all-area__empty" role="status">
      <h2 className="all-area__empty-title">Not announced yet</h2>
      <p className="all-area__empty-text">
        The All-Area team is announced after the state tournament. Until then, the season&rsquo;s
        leaders are on the {label} dashboard.
      </p>
      <Link to={`${sportPrefix}?tab=leaders`} className="all-area__empty-cta">
        Season leaders <span aria-hidden="true">›</span>
      </Link>
    </section>
  );
}
