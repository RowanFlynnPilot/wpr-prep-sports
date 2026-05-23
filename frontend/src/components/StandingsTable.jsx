import TeamLogo from "./TeamLogo.jsx";
import TeamLink from "./TeamLink.jsx";
import Sponsor from "./Sponsor.jsx";

/**
 * One conference's standings. Editorial-table look — bold rank column,
 * tabular figures, alternating row tint.
 */
export default function StandingsTable({ standing, schoolIndex, sponsors }) {
  if (!standing || !standing.rows || standing.rows.length === 0) return null;

  return (
    <section className="standings">
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
                <tr key={row.school_id || row.name}>
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
    </section>
  );
}
