import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Sponsor from "./Sponsor.jsx";
import { useSportPrefix } from "../utils/links.js";
import { primaryColor } from "../utils/schools.js";
import { trackEvent } from "../utils/analytics.js";

const DEFAULT_VISIBLE = 10;

/**
 * Power Rankings — cross-conference algorithmic team ranking. Renders
 * a sortable list with the top N visible by default, expandable to the
 * full ranked field. Each row shows record + 0–100 index score with a
 * small horizontal bar visualizing the gap to #1.
 *
 * A division chip row (WIAA tournament divisions from the manifest)
 * filters the list while PRESERVING each team's overall rank — "the
 * D5 schools and where they sit in the whole region" reads better than
 * renumbering within the division.
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
  const [activeDiv, setActiveDiv] = useState("ALL");
  const sportId = sportConfig?.id;

  const divisionFor = (schoolId) =>
    schoolIndex?.get?.(schoolId)?.wiaa_division?.[sportId] ?? null;

  const divisions = useMemo(() => {
    const set = new Set();
    for (const row of rankings ?? []) {
      const div = schoolIndex?.get?.(row.school_id)?.wiaa_division?.[sportId];
      if (div) set.add(div);
    }
    return [...set].sort(
      (a, b) =>
        (a.startsWith("8P") ? 1 : 0) - (b.startsWith("8P") ? 1 : 0) ||
        a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [rankings, schoolIndex, sportId]);

  if (!rankings || rankings.length === 0) return null;

  const filtered =
    activeDiv === "ALL"
      ? rankings
      : rankings.filter((row) => divisionFor(row.school_id) === activeDiv);

  // Bars stay scaled to the OVERALL #1 so a filtered view keeps the
  // same visual meaning ("gap to the region's best").
  const topScore = rankings[0]?.score ?? 100;
  const visible = expanded ? filtered : filtered.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = filtered.length - visible.length;

  const pickDivision = (d) => {
    setActiveDiv(d);
    trackEvent("division-filter", {
      sport: sportId ?? "unknown",
      division: d,
    });
  };

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
          {method ?? "Power Index"}
        </span>
      </p>

      {divisions.length > 1 && (
        <div
          className="power-rankings__filter"
          role="group"
          aria-label="Filter by WIAA division"
        >
          <DivisionChip
            label="All divisions"
            active={activeDiv === "ALL"}
            onClick={() => pickDivision("ALL")}
          />
          {divisions.map((d) => (
            <DivisionChip
              key={d}
              label={d}
              active={activeDiv === d}
              onClick={() => pickDivision(d)}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="power-rankings__empty">
          No ranked teams in {activeDiv} yet this season.
        </p>
      ) : (
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
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          className="power-rankings__expand"
          onClick={() => setExpanded(true)}
        >
          Show all {filtered.length} ranked teams →
        </button>
      )}
      {expanded && filtered.length > DEFAULT_VISIBLE && (
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

function DivisionChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      className={`power-rankings__chip ${active ? "power-rankings__chip--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
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
      <MovementChip movement={row.movement} />
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

/**
 * Tiny chip next to the rank showing weekly movement.
 *   movement > 0  — improved (e.g. was #5, now #2 → +3) — green ▲
 *   movement < 0  — dropped — red ▼
 *   movement = 0  — held — neutral dash
 *   movement null — wasn't ranked last snapshot — "NEW"
 */
function MovementChip({ movement }) {
  if (movement == null) {
    return (
      <span
        className="power-row__move power-row__move--new"
        title="Newly ranked this week"
      >
        NEW
      </span>
    );
  }
  if (movement === 0) {
    return (
      <span
        className="power-row__move power-row__move--flat"
        title="Unchanged from last week"
        aria-label="Unchanged from last week"
      >
        —
      </span>
    );
  }
  const up = movement > 0;
  return (
    <span
      className={`power-row__move ${up ? "power-row__move--up" : "power-row__move--down"}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(movement)} from last week`}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      {Math.abs(movement)}
    </span>
  );
}

function padDecimals(num) {
  // ".567" style rendering for SOS — strip the leading zero so it
  // reads compactly inline.
  if (num == null || Number.isNaN(num)) return "—";
  const s = num.toFixed(3);
  return s.startsWith("0.") ? s.slice(2) : s.replace(".", "");
}
