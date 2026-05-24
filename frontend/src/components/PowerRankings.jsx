import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Sponsor from "./Sponsor.jsx";
import { useSportPrefix } from "../utils/links.js";
import { primaryColor } from "../utils/schools.js";

const DEFAULT_VISIBLE = 10;

/**
 * Power Rankings — cross-conference algorithmic team ranking. Renders
 * a sortable list with the top N visible by default, expandable to the
 * full ranked field. Each row shows record + 0–100 index score with a
 * small horizontal bar visualizing the gap to #1.
 *
 * Hidden when the dataset has no rankings (off-season or sport with
 * too few finalized games to qualify).
 */
export default function PowerRankings({
  rankings,
  method,
  schoolIndex,
  sponsors,
  sportConfig,
}) {
  const sportPrefix = useSportPrefix();
  const [expanded, setExpanded] = useState(false);

  if (!rankings || rankings.length === 0) return null;

  const topScore = rankings[0]?.score ?? 100;
  const visible = expanded ? rankings : rankings.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = rankings.length - visible.length;

  return (
    <section className="power-rankings" aria-label="Power Rankings">
      <div className="section-header">
        <h2>Power Rankings</h2>
        <Sponsor slot="power-rankings" sponsors={sponsors} variant="inline" />
      </div>

      <p className="power-rankings__lede">
        Every tracked {sportConfig?.shortLabel?.toLowerCase() ?? ""} team,
        ranked across conferences. {" "}
        <span className="power-rankings__method">
          {method ?? "WPR Power Index"}
        </span>
      </p>

      <ol className="power-rankings__list">
        {visible.map((row) => (
          <PowerRow
            key={row.school_id}
            row={row}
            topScore={topScore}
            sportPrefix={sportPrefix}
            schoolIndex={schoolIndex}
          />
        ))}
      </ol>

      {hiddenCount > 0 && (
        <button
          type="button"
          className="power-rankings__expand"
          onClick={() => setExpanded(true)}
        >
          Show all {rankings.length} ranked teams →
        </button>
      )}
      {expanded && rankings.length > DEFAULT_VISIBLE && (
        <button
          type="button"
          className="power-rankings__expand power-rankings__expand--collapse"
          onClick={() => setExpanded(false)}
        >
          ← Show top {DEFAULT_VISIBLE}
        </button>
      )}
    </section>
  );
}

function PowerRow({ row, topScore, sportPrefix, schoolIndex }) {
  const school = schoolIndex?.get?.(row.school_id);
  const teamForLogo = {
    school_id: row.school_id,
    name: school?.name ?? row.school_name,
    logo_url: school?.logo_url ?? null,
  };
  // Bar width scales to the topScore so #1 fills the bar; everyone
  // else shows their gap to the leader at a glance.
  const widthPct = topScore > 0 ? Math.max(8, (row.score / topScore) * 100) : 0;
  const accent = primaryColor(school) || "var(--accent)";

  return (
    <li className="power-row">
      <span className="power-row__rank">{row.rank}</span>
      <TeamLogo team={teamForLogo} school={school} size="sm" />
      <div className="power-row__team">
        <Link to={`${sportPrefix}/team/${row.school_id}`} className="power-row__name">
          {row.school_name}
        </Link>
        <span className="power-row__meta">
          {row.wins}-{row.losses}
          {" · "}
          <span className="power-row__sos" title="Strength of Schedule (avg opponent W%)">
            SOS .{padDecimals(row.sos)}
          </span>
        </span>
      </div>
      <div className="power-row__score">
        <span className="power-row__score-num">{row.score.toFixed(1)}</span>
        <span
          className="power-row__bar"
          aria-hidden="true"
          style={{ width: `${widthPct}%`, background: accent }}
        />
      </div>
    </li>
  );
}

function padDecimals(num) {
  // ".567" style rendering for SOS — strip the leading zero so it
  // reads compactly inline.
  if (num == null || Number.isNaN(num)) return "—";
  const s = num.toFixed(3);
  return s.startsWith("0.") ? s.slice(2) : s.replace(".", "");
}
