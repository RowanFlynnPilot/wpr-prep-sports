import { useMemo, useState } from "react";
import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import Sponsor from "./Sponsor.jsx";
import {
  formatStatsLine,
  positionFor,
  teamSeasonLeaders,
} from "../utils/seasonStats.js";
import { recordLabels } from "../config/sports.js";

/**
 * One conference's standings. Editorial-table look — bold rank column,
 * tabular figures, alternating row tint.
 *
 * On row hover, an overlay card slides in from the bottom-right with a
 * fuller picture of the team's season — point differential, big-margin
 * counts, etc. Pure data, no interpretation.
 */
export default function StandingsTable({
  standing,
  schoolIndex,
  sponsors,
  seasonStats = [],
  sportConfig,
}) {
  const [hovered, setHovered] = useState(null);

  // Pre-bucket season stats by school_id once per render, so each hover
  // is just a Map lookup rather than a re-filter of the full list.
  const seasonByTeam = useMemo(() => {
    const map = new Map();
    for (const row of seasonStats ?? []) {
      if (!row.school_id) continue;
      if (!map.has(row.school_id)) map.set(row.school_id, []);
      map.get(row.school_id).push(row);
    }
    return map;
  }, [seasonStats]);

  if (!standing || !standing.rows || standing.rows.length === 0) return null;

  const hoveredRow = hovered
    ? standing.rows.find((r) => r.school_id === hovered)
    : null;
  const hoveredSchool = hoveredRow ? schoolIndex.get(hoveredRow.school_id) : null;
  const hoveredLeaders = hoveredRow
    ? teamSeasonLeaders(seasonByTeam.get(hoveredRow.school_id) ?? [])
    : [];

  const labels = recordLabels(sportConfig);

  return (
    <section
      className="standings"
      onMouseLeave={() => setHovered(null)}
    >
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
              <th className="num">{labels.for}</th>
              <th className="num">{labels.against}</th>
            </tr>
          </thead>
          <tbody>
            {standing.rows.map((row, idx) => {
              const school = schoolIndex.get(row.school_id);
              const stub = {
                name: row.name,
                school_id: row.school_id,
                logo_url: school?.logo_url ?? null,
              };
              return (
                <tr
                  key={row.school_id || row.name}
                  onMouseEnter={() => setHovered(row.school_id || row.name)}
                >
                  <td className="rank">{idx + 1}</td>
                  <td className="team">
                    <TeamLogo team={stub} school={school} size="sm" />
                    <TeamLink team={stub}>{row.name}</TeamLink>
                  </td>
                  <td className="num">{row.conference_wins}-{row.conference_losses}</td>
                  <td className="num">{row.overall_wins}-{row.overall_losses}</td>
                  <td className="num">{fmtInt(row.points_for)}</td>
                  <td className="num">{fmtInt(row.points_against)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <HoverCard
        row={hoveredRow}
        school={hoveredSchool}
        conference={standing.conference}
        leaders={hoveredLeaders}
        labels={labels}
      />
    </section>
  );
}

function fmtInt(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US");
}

function HoverCard({ row, school, conference, leaders, labels }) {
  if (!row) return null;
  const pf = row.points_for ?? 0;
  const pa = row.points_against ?? 0;
  const diff = pf - pa;
  const diffLabel = labels?.diff ?? "Point diff.";
  const totalGames = row.overall_wins + row.overall_losses;
  const winPct =
    totalGames > 0 ? Math.round((row.overall_wins / totalGames) * 100) : null;

  return (
    <div className="standings__hover" role="status" aria-live="polite">
      <div className="standings__hover-name">
        {row.name}
        {school?.mascot && (
          <span className="standings__hover-mascot">{school.mascot}</span>
        )}
      </div>
      <dl className="standings__hover-stats">
        <div>
          <dt>Overall</dt>
          <dd>{row.overall_wins}-{row.overall_losses}{winPct != null && <span className="standings__hover-pct"> · {winPct}%</span>}</dd>
        </div>
        <div>
          <dt>{conference}</dt>
          <dd>{row.conference_wins}-{row.conference_losses}</dd>
        </div>
        <div>
          <dt>{diffLabel}</dt>
          <dd className={diff > 0 ? "pos" : diff < 0 ? "neg" : ""}>
            {diff > 0 ? "+" : ""}
            {diff.toLocaleString("en-US")}
            <span className="standings__hover-pct"> ({fmtInt(pf)}/{fmtInt(pa)})</span>
          </dd>
        </div>
      </dl>

      {leaders && leaders.length > 0 && (
        <ul className="standings__hover-leaders">
          {leaders.map(({ category, row: leader }) => (
            <li key={category}>
              <span className="standings__hover-leader-pos">
                {positionFor(category)}
              </span>
              <span className="standings__hover-leader-name">
                {leader.player_name}
                {leader.player_year && (
                  <span className="standings__hover-leader-year">
                    {" "}
                    ({leader.player_year})
                  </span>
                )}
              </span>
              <span className="standings__hover-leader-stats">
                {formatStatsLine(category, leader.stats)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
