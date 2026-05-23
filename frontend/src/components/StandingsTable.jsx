import { useState } from "react";
import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import Sponsor from "./Sponsor.jsx";

/**
 * One conference's standings. Editorial-table look — bold rank column,
 * tabular figures, alternating row tint.
 *
 * On row hover, an overlay card slides in from the bottom-right with a
 * fuller picture of the team's season — point differential, big-margin
 * counts, etc. Pure data, no interpretation.
 */
export default function StandingsTable({ standing, schoolIndex, sponsors }) {
  const [hovered, setHovered] = useState(null);

  if (!standing || !standing.rows || standing.rows.length === 0) return null;

  const hoveredRow = hovered
    ? standing.rows.find((r) => r.school_id === hovered)
    : null;
  const hoveredSchool = hoveredRow ? schoolIndex.get(hoveredRow.school_id) : null;

  return (
    <section
      className="standings"
      onMouseLeave={() => setHovered(null)}
    >
      <header className="standings__header">
        <h3>{standing.conference}</h3>
        <span className="standings__hint">2025–26 · Football</span>
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
              <th className="num">PF</th>
              <th className="num">PA</th>
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
                  <td className="num">{row.points_for ?? "—"}</td>
                  <td className="num">{row.points_against ?? "—"}</td>
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
      />
    </section>
  );
}

function HoverCard({ row, school, conference }) {
  if (!row) return null;
  const pf = row.points_for ?? 0;
  const pa = row.points_against ?? 0;
  const diff = pf - pa;
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
          <dt>Point diff.</dt>
          <dd className={diff > 0 ? "pos" : diff < 0 ? "neg" : ""}>
            {diff > 0 ? "+" : ""}
            {diff}
            <span className="standings__hover-pct"> ({pf}/{pa})</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
