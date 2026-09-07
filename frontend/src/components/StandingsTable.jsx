import { Fragment, useMemo, useState } from "react";
import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import Sponsor from "./Sponsor.jsx";
import Icon from "./Icon.jsx";
import {
  formatStatsLine,
  positionFor,
  teamSeasonLeaders,
} from "../utils/seasonStats.js";
import { displayPlayerName } from "../utils/players.js";
import { recordLabels } from "../config/sports.js";

/**
 * One conference's standings. Editorial-table look — bold rank column,
 * tabular figures, alternating row tint.
 *
 * Each row expands — tap or click anywhere on it, or the chevron button
 * by keyboard — into a details row directly beneath: full record with
 * win %, conference mark, point differential with the PF/PA that phones
 * drop from the table, and the team's season leaders. This replaced a
 * mouse-only hover card that was also a polite live region: every row
 * hover announced to screen readers, while touch and keyboard users
 * could never reach the content at all.
 */
export default function StandingsTable({
  standing,
  schoolIndex,
  sponsors,
  seasonStats = [],
  sportConfig,
  games = [],
  highlightSchoolId = null,
}) {
  const [expanded, setExpanded] = useState(null);

  // Pre-bucket season stats by school_id once per render, so opening a
  // row is a Map lookup rather than a re-filter of the full list.
  const seasonByTeam = useMemo(() => {
    const map = new Map();
    for (const row of seasonStats ?? []) {
      if (!row.school_id) continue;
      if (!map.has(row.school_id)) map.set(row.school_id, []);
      map.get(row.school_id).push(row);
    }
    return map;
  }, [seasonStats]);

  // Most recent 3 conference results per team, oldest → newest. Used for
  // the "Last 3" form pill in each row. Computed BEFORE the empty-table
  // return below — a live refresh can shrink a table's rows on a mounted
  // instance, and a hook after a conditional return crashes React.
  const recentFormByTeam = useMemo(() => {
    const map = new Map();
    if (!games || games.length === 0) return map;
    for (const row of standing?.rows ?? []) {
      const sid = row.school_id;
      if (!sid) continue;
      // Conference results preferred; before any conference play exists
      // (volleyball tournament season, soccer non-conference Augusts)
      // fall back to all finals — a 9-0 team showing "—" under "Last 3"
      // reads broken next to a full Overall column.
      const teamFinals = games.filter(
        (g) =>
          g.status === "final" &&
          (g.home.school_id === sid || g.away.school_id === sid) &&
          g.home.score != null &&
          g.away.score != null,
      );
      const confFinals = teamFinals.filter((g) => g.conference_game);
      const last3 = (confFinals.length > 0 ? confFinals : teamFinals)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3)
        .reverse()
        .map((g) => {
          const isHome = g.home.school_id === sid;
          const own = isHome ? g.home.score : g.away.score;
          const opp = isHome ? g.away.score : g.home.score;
          return own > opp ? "W" : own < opp ? "L" : "T";
        });
      map.set(sid, last3);
    }
    return map;
  }, [games, standing?.rows]);

  if (!standing || !standing.rows || standing.rows.length === 0) return null;

  const labels = recordLabels(sportConfig);

  // Any results in this table yet? Governs the leader pip below.
  // Standings rows carry overall_wins/overall_losses — there are no
  // wins/losses/ties fields (the guard shipped reading those and was
  // silently always-false for a month).
  const tableStarted = standing.rows.some(
    (r) => (r.overall_wins ?? 0) + (r.overall_losses ?? 0) > 0,
  );

  const toggle = (id) => setExpanded((cur) => (cur === id ? null : id));
  const confSlug = slug(standing.conference);

  return (
    <section className="standings">
      <header className="standings__header">
        <h3>{standing.conference}</h3>
        <span className="standings__hint">
          {sportConfig?.season ?? ""}
          {sportConfig?.season && sportConfig?.label ? " · " : ""}
          {sportConfig?.label ?? ""}
        </span>
      </header>
      <Sponsor
        slot={`standings:${standing.conference}`}
        sponsors={sponsors}
        variant="inline"
        className="standings__sponsor"
      />

      <div className="standings__table-wrap">
        <table className="standings__table">
          <thead>
            <tr>
              <th className="rank">#</th>
              <th>Team</th>
              <th className="num">Conf</th>
              <th className="num">Overall</th>
              <th className="num points">{labels.for}</th>
              <th className="num points">{labels.against}</th>
              <th className="form">Last 3</th>
              <th className="more">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {standing.rows.map((row, idx) => {
              const rowId = row.school_id || row.name;
              const school = schoolIndex.get(row.school_id);
              const stub = {
                name: row.name,
                school_id: row.school_id,
                logo_url: school?.logo_url ?? null,
              };
              // No leader pip on a preseason table — every row is 0-0 in
              // arbitrary order, and marking row 1 crowns someone at random.
              const isLeader = idx === 0 && tableStarted;
              const isHighlight = highlightSchoolId && row.school_id === highlightSchoolId;
              const form = recentFormByTeam.get(row.school_id) ?? [];
              const schoolColor = school?.colors?.[0] ?? null;
              const isOpen = expanded === rowId;
              const detailsId = `standings-details-${confSlug}-${slug(rowId)}`;
              return (
                <Fragment key={rowId}>
                  <tr
                    className={
                      "standings__row" +
                      // Striping by class, not nth-child: an open details
                      // row would otherwise flip every stripe below it.
                      (idx % 2 === 0 ? " standings__row--odd" : "") +
                      (isLeader ? " standings__row--leader" : "") +
                      (isHighlight ? " standings__row--highlight" : "") +
                      (isOpen ? " standings__row--open" : "")
                    }
                    style={schoolColor ? { "--school-color": schoolColor } : undefined}
                    onClick={(e) => {
                      // Links and the button handle themselves; the rest
                      // of the row is one big toggle target.
                      if (e.target.closest("a, button")) return;
                      toggle(rowId);
                    }}
                  >
                    <td className="rank">
                      {isLeader && (
                        <span className="standings__leader-pip" aria-hidden="true" />
                      )}
                      {idx + 1}
                    </td>
                    <td className="team">
                      {schoolColor && (
                        <span
                          className="standings__school-bar"
                          aria-hidden="true"
                        />
                      )}
                      <TeamLogo team={stub} school={school} size="sm" />
                      <TeamLink team={stub}>{row.name}</TeamLink>
                    </td>
                    <td className="num">{fmtRecord(row.conference_wins, row.conference_losses, row.conference_ties)}</td>
                    <td className="num">{fmtRecord(row.overall_wins, row.overall_losses, row.overall_ties)}</td>
                    <td className="num points">{fmtInt(row.points_for)}</td>
                    <td className="num points">{fmtInt(row.points_against)}</td>
                    <td className="form">
                      {form.length > 0 ? (
                        <span className="standings__form" aria-label={`Last ${form.length} games: ${form.join(", ")}`}>
                          {form.map((r, i) => (
                            <span
                              key={i}
                              className={
                                "standings__form-chip standings__form-chip--" +
                                r.toLowerCase()
                              }
                            >
                              {r}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="standings__form-empty">—</span>
                      )}
                    </td>
                    <td className="more">
                      <button
                        type="button"
                        className="standings__toggle"
                        aria-expanded={isOpen}
                        aria-controls={detailsId}
                        aria-label={`${isOpen ? "Hide" : "Show"} season details for ${row.name}`}
                        onClick={() => toggle(rowId)}
                      >
                        <Icon name="chevron" />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="standings__details-row" id={detailsId}>
                      <td colSpan={8}>
                        <DetailsPanel
                          row={row}
                          stub={stub}
                          school={school}
                          conference={standing.conference}
                          leaders={teamSeasonLeaders(
                            seasonByTeam.get(row.school_id) ?? [],
                            sportConfig,
                          )}
                          labels={labels}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function slug(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function fmtInt(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US");
}

// W-L, or W-L-T once a draw exists (soccer). Football tables never
// show a phantom "-0" tail.
function fmtRecord(wins, losses, ties) {
  const t = ties ?? 0;
  return t > 0 ? `${wins}-${losses}-${t}` : `${wins}-${losses}`;
}

/**
 * The expanded row: full record, differential with PF/PA, season
 * leaders, and a link on to the team page. Plain data, no
 * interpretation — the recap voice lives on the game and team pages.
 */
function DetailsPanel({ row, stub, school, conference, leaders, labels }) {
  const pf = row.points_for ?? 0;
  const pa = row.points_against ?? 0;
  const diff = pf - pa;
  const diffLabel = labels?.diff ?? "Point diff.";
  // Ties (soccer) count as half a win — the conventional weighting —
  // so a 4-2-2 side reads 62%, not 67%.
  const ties = row.overall_ties ?? 0;
  const totalGames = (row.overall_wins ?? 0) + (row.overall_losses ?? 0) + ties;
  const winPct =
    totalGames > 0
      ? Math.round((((row.overall_wins ?? 0) + ties / 2) / totalGames) * 100)
      : null;

  return (
    <div className="standings__details">
      <div className="standings__details-head">
        <span className="standings__details-name">
          {row.name}
          {school?.mascot && (
            <span className="standings__details-mascot">{school.mascot}</span>
          )}
        </span>
        <TeamLink team={stub} className="standings__details-link">
          Team page <span aria-hidden="true">›</span>
        </TeamLink>
      </div>
      <dl className="standings__details-stats">
        <div>
          <dt>Overall</dt>
          <dd>
            {fmtRecord(row.overall_wins, row.overall_losses, row.overall_ties)}
            {winPct != null && <span className="standings__details-pct"> · {winPct}%</span>}
          </dd>
        </div>
        <div>
          <dt>{conference}</dt>
          <dd>{fmtRecord(row.conference_wins, row.conference_losses, row.conference_ties)}</dd>
        </div>
        <div>
          <dt>{diffLabel}</dt>
          <dd className={diff > 0 ? "pos" : ""}>
            {diff > 0 ? "+" : ""}
            {diff.toLocaleString("en-US")}
            <span className="standings__details-pct">
              {" "}
              ({labels?.for ?? "PF"} {fmtInt(pf)} · {labels?.against ?? "PA"} {fmtInt(pa)})
            </span>
          </dd>
        </div>
      </dl>

      {leaders && leaders.length > 0 && (
        <ul className="standings__details-leaders">
          {leaders.map(({ category, row: leader }) => (
            <li key={category.id}>
              <span className="standings__details-leader-pos">
                {positionFor(category)}
              </span>
              <span className="standings__details-leader-name">
                {displayPlayerName(leader.player_name)}
                {leader.player_year && (
                  <span className="standings__details-leader-year">
                    {" "}
                    ({leader.player_year})
                  </span>
                )}
              </span>
              <span className="standings__details-leader-stats">
                {formatStatsLine(category, leader.stats)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
