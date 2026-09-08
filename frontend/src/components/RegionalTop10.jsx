import { useMemo } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Sponsor from "./Sponsor.jsx";
import Icon from "./Icon.jsx";
import { pickRegionalTop10 } from "../utils/regionalTop10.js";
import { useSportPrefix } from "../utils/links.js";
import { formatWeekRange } from "../utils/dates.js";
import { startOfSchoolWeek } from "../utils/weeks.js";
import { SITE } from "../config/site.js";

/**
 * The Central Wisconsin Ten — a weekly hyperlocal poll rendered as
 * newspaper agate: dense, ruled dividers, one-sentence lede per team,
 * Monday-morning cadence. Lives inside the Standings & Stats tab as
 * the editorial companion to the algorithmic Power Rankings.
 *
 * Renders nothing when the sport has no home-region cut yet (no rankings,
 * or no configured region), so a rolled-over sport's tab stays clean.
 */
export default function RegionalTop10({
  dataset,
  schoolIndex,
  sportConfig,
  sponsors,
  override = null,
}) {
  const poll = useMemo(
    () => pickRegionalTop10({ dataset, schoolIndex, sportConfig, override }),
    [dataset, schoolIndex, sportConfig, override],
  );
  const sportPrefix = useSportPrefix();

  const weekLabel = useMemo(() => {
    // The poll describes the week that JUST FINISHED — Monday's paper
    // ranks last week's games. Roll back one week from this Monday.
    const thisMonday = startOfSchoolWeek(new Date()).getTime();
    return formatWeekRange(thisMonday - 7 * 86_400_000);
  }, []);

  if (!poll || poll.teams.length === 0) return null;

  // Capitalized region name for the masthead ("Central Wisconsin").
  const regionTitle = titleCase(SITE.regionLabel);

  return (
    <section className="top-ten" aria-label={`The ${regionTitle} Ten`}>
      <header className="top-ten__masthead">
        <div className="top-ten__title-block">
          <span className="top-ten__eyebrow">Poll · {sportConfig?.label ?? "Football"}</span>
          <h2 className="top-ten__title">
            The <em>{regionTitle}</em> Ten
          </h2>
          <span className="top-ten__dateline">Week of {weekLabel}</span>
        </div>
        <Sponsor slot="top-ten" sponsors={sponsors} variant="inline" className="top-ten__sponsor" />
      </header>

      {/* Dek: one line explaining what the artifact IS, before the reader
          hits the first row. Detail lives in .top-ten__method at the end;
          this is the up-top one-liner three critiques asked for. */}
      <p className="top-ten__dek">
        A weekly {poll.editorial ? "editor's" : "algorithm-plus-editor"} ranking of the {SITE.regionLabel}{" "}
        schools that mattered most last week.
      </p>

      <ol className="top-ten__list">
        {poll.teams.map((t) => (
          <TopTenRow
            key={t.school_id}
            team={t}
            school={schoolIndex?.get?.(t.school_id) ?? null}
            sportPrefix={sportPrefix}
          />
        ))}
      </ol>

      <p className="top-ten__method">
        {poll.editorial ? "Editor's ballot" : "Algorithmic ballot"} · {poll.method}{" "}
        A new poll lands each Monday morning.
      </p>
    </section>
  );
}

function TopTenRow({ team, school, sportPrefix }) {
  const record = team.ties > 0
    ? `${team.wins}-${team.losses}-${team.ties}`
    : `${team.wins}-${team.losses}`;
  const schoolColor = school?.colors?.[0] ?? null;
  const style = schoolColor ? { "--school-color": schoolColor } : undefined;
  const stub = {
    school_id: team.school_id,
    name: school?.name ?? team.school_name,
    logo_url: school?.logo_url ?? null,
  };

  return (
    <li className="top-ten__row" style={style} data-school={team.school_id}>
      <span className="top-ten__rank" aria-hidden="true">
        {team.rank}
      </span>
      <Movement value={team.movement} />
      <TeamLogo team={stub} school={school} size="sm" />
      <div className="top-ten__meta">
        <Link to={`${sportPrefix}/team/${team.school_id}`} className="top-ten__name">
          <span className="sr-only">Rank {team.rank}: </span>
          {school?.name ?? team.school_name}
        </Link>
        <span className="top-ten__ancillary">
          {record}
          {team.conference ? ` · ${team.conference}` : ""}
          {team.division ? ` · ${team.division}` : ""}
          {team.isEditorPick ? " · editor's pick" : ""}
        </span>
      </div>
      {team.lede && <p className="top-ten__lede">{team.lede}</p>}
    </li>
  );
}

/**
 * Week-over-week movement chip. Small, colored by direction, printed
 * with an SVG chevron for the arrow so the announcement is clean:
 * "up 2", "down 1", "held" (no chip), or "new" for a debut.
 */
function Movement({ value }) {
  if (value == null) {
    return (
      <span className="top-ten__movement top-ten__movement--new" aria-label="new to the poll">
        NEW
      </span>
    );
  }
  if (value === 0) {
    return <span className="top-ten__movement top-ten__movement--flat" aria-label="held rank">—</span>;
  }
  const up = value > 0;
  return (
    <span
      className={`top-ten__movement top-ten__movement--${up ? "up" : "down"}`}
      aria-label={`${up ? "up" : "down"} ${Math.abs(value)}`}
    >
      <span className={`top-ten__movement-arrow top-ten__movement-arrow--${up ? "up" : "down"}`} aria-hidden="true">
        <Icon name="chevron" />
      </span>
      {Math.abs(value)}
    </span>
  );
}

function titleCase(s) {
  return String(s ?? "")
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
