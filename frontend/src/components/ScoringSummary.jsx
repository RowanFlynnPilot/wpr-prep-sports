import { useMemo } from "react";
import { initials, primaryColor } from "../utils/schools.js";

const PERIOD_ORDER = ["1st", "2nd", "3rd", "OT", "2OT", "3OT", "SO"];

function periodSortKey(p) {
  const idx = PERIOD_ORDER.indexOf(p);
  return idx === -1 ? 99 : idx;
}

/**
 * Hockey scoring summary — period-by-period goal log with running
 * score per side. Mirrors what wisconsinprephockey.net shows on a
 * game page. Renders nothing if game.scoring is empty.
 */
export default function ScoringSummary({ game, schoolIndex }) {
  const goals = game?.scoring ?? [];
  const grouped = useMemo(() => {
    const byPeriod = new Map();
    for (const g of goals) {
      if (!byPeriod.has(g.period)) byPeriod.set(g.period, []);
      byPeriod.get(g.period).push(g);
    }
    return [...byPeriod.entries()]
      .sort(([a], [b]) => periodSortKey(a) - periodSortKey(b))
      .map(([period, list]) => ({ period, goals: list }));
  }, [goals]);

  if (goals.length === 0) return null;

  const awaySchool = game.away?.school_id
    ? schoolIndex?.get?.(game.away.school_id)
    : null;
  const homeSchool = game.home?.school_id
    ? schoolIndex?.get?.(game.home.school_id)
    : null;

  // Short, distinct column abbreviations — derived from the manifest
  // mascots when available, falling back to initials of the WIAA name.
  const awayAbbr = abbrFor(game.away?.name, awaySchool);
  const homeAbbr = abbrFor(game.home?.name, homeSchool);
  const awayColor = awaySchool ? primaryColor(awaySchool) : null;
  const homeColor = homeSchool ? primaryColor(homeSchool) : null;

  return (
    <section
      className="scoring-summary"
      aria-label="Scoring summary"
      style={{
        "--away-color": awayColor || "var(--muted-2)",
        "--home-color": homeColor || "var(--muted-2)",
      }}
    >
      <header className="scoring-summary__header">
        <h3>Scoring Summary</h3>
        <span className="scoring-summary__hint">{goals.length} goals</span>
      </header>

      {grouped.map(({ period, goals: periodGoals }) => (
        <div key={period} className="scoring-summary__period">
          <div className="scoring-summary__period-header">
            <span className="scoring-summary__period-label">{period} Period</span>
            <span className="scoring-summary__score-cols">
              <span className="scoring-summary__abbr scoring-summary__abbr--away">
                {awayAbbr}
              </span>
              <span className="scoring-summary__abbr scoring-summary__abbr--home">
                {homeAbbr}
              </span>
            </span>
          </div>
          <ul className="scoring-summary__goals">
            {periodGoals.map((g, idx) => (
              <GoalRow
                key={`${period}-${idx}-${g.time}`}
                goal={g}
                awaySchoolId={game.away?.school_id}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function GoalRow({ goal, awaySchoolId }) {
  const isAway = goal.team_school_id
    ? goal.team_school_id === awaySchoolId
    : false;
  const strengthBadge = strengthLabel(goal.strength);
  return (
    <li
      className={
        "scoring-summary__goal" +
        (isAway ? " scoring-summary__goal--away" : " scoring-summary__goal--home")
      }
    >
      <span className="scoring-summary__time">{goal.time}</span>
      <span className="scoring-summary__rail" aria-hidden="true" />
      <div className="scoring-summary__play">
        <div className="scoring-summary__scorer">
          {goal.scorer_jersey && (
            <span className="scoring-summary__jersey">#{goal.scorer_jersey}</span>
          )}
          <span className="scoring-summary__scorer-name">{goal.scorer_name}</span>
          {strengthBadge && (
            <span
              className={
                "scoring-summary__strength" +
                ` scoring-summary__strength--${strengthBadge.cls}`
              }
            >
              {strengthBadge.label}
            </span>
          )}
        </div>
        {goal.assists?.length > 0 && (
          <div className="scoring-summary__assists">
            Assists:{" "}
            {goal.assists.map((a, i) => (
              <span key={i} className="scoring-summary__assist">
                {a.jersey && <span className="scoring-summary__a-jersey">#{a.jersey}</span>}
                {a.name}
                {i < goal.assists.length - 1 && ", "}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="scoring-summary__running">
        <span className="scoring-summary__running-num scoring-summary__running-num--away">
          {goal.away_score}
        </span>
        <span className="scoring-summary__running-num scoring-summary__running-num--home">
          {goal.home_score}
        </span>
      </span>
    </li>
  );
}

function strengthLabel(strength) {
  const s = (strength || "").toLowerCase();
  if (s.includes("power")) return { label: "PP", cls: "pp" };
  if (s.includes("short")) return { label: "SH", cls: "sh" };
  if (s.includes("empty")) return { label: "EN", cls: "en" };
  return null; // even strength = no badge
}

function abbrFor(name, school) {
  if (school?.mascot) {
    return school.mascot.slice(0, 4).toUpperCase();
  }
  return initials(name);
}
