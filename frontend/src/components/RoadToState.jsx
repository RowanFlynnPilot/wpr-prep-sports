import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Sponsor from "./Sponsor.jsx";
import { useSportPrefix } from "../utils/links.js";
import { isTbdSide } from "../utils/postseason.js";
import { isScorePending, isStaleScheduled } from "../utils/games.js";
import { formatGameTime } from "../utils/dates.js";
import { SITE } from "../config/site.js";
import "../styles/RoadToState.css";

/** Rows before the strip hands off to the bracket on the Standings tab. */
const ROW_CAP = 8;

const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: SITE.timeZone,
});
const SHORT_DAY_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: SITE.timeZone,
});

/** "Today · 1:00 PM", "Tomorrow · 7:00 PM", or "Fri, Nov 6" (home zone). */
function whenLabel(iso, now) {
  const d = new Date(iso);
  const day = DAY_KEY.format(d);
  if (day === DAY_KEY.format(new Date(now))) return `Today · ${formatGameTime(iso)}`;
  if (day === DAY_KEY.format(new Date(now + 86_400_000))) return `Tomorrow · ${formatGameTime(iso)}`;
  return SHORT_DAY_DATE.format(d);
}

/**
 * Football is the one sport with two brackets: 8-player schools carry an
 * "8P-" WIAA division, and their Level 3/4 are not the same rounds as the
 * 11-player ones played the same weekend.
 */
function isEightPlayer(school, sportId) {
  return sportId === "football" && /^8P/i.test(school?.wiaa_division?.football ?? "");
}

/**
 * Road to State: every tracked team still alive in the bracket, one row
 * each, with where it plays next. Sits above Player of the Week on the
 * Scores tab while the postseason is on, so "are we still in it, and when
 * do we play?" is answered before the reader scrolls. Home-region schools
 * lead; the rest follow alphabetically. Built on utils/postseason.js so
 * "alive" means what the bracket and team pages mean by it.
 */
export default function RoadToState({
  state,
  homeRegion,
  sponsors,
  sportConfig,
  now = Date.now(),
  onShowBracket,
}) {
  const prefix = useSportPrefix();
  if (!state?.active || state.alive.length === 0) return null;

  const isLocal = (t) => !!homeRegion?.has?.(t.schoolId);
  const nameOf = (t) => t.school?.name ?? t.schoolId;
  const ordered = [...state.alive].sort(
    (a, b) =>
      (isLocal(b) ? 1 : 0) - (isLocal(a) ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)),
  );
  const shown = ordered.slice(0, ROW_CAP);
  const total = ordered.length;
  const sportId = sportConfig?.id;

  return (
    <section className="rts" aria-labelledby="rts-heading">
      <div className="rts__head">
        <h2 id="rts-heading" className="rts__title">
          Road to State
        </h2>
        <span className="rts__hint">
          {total} {total === 1 ? "team" : "teams"} still alive
        </span>
        <Sponsor slot="road" sponsors={sponsors} variant="inline" className="rts__sponsor" />
      </div>

      <ul className="rts__list">
        {shown.map((t) => (
          <RoadRow
            key={t.schoolId}
            team={t}
            prefix={prefix}
            now={now}
            eightPlayer={isEightPlayer(t.school, sportId)}
          />
        ))}
      </ul>

      {onShowBracket && (
        <button type="button" className="rts__all" onClick={onShowBracket}>
          {total > shown.length ? `All ${total} in the bracket` : "Full bracket"}
          <span aria-hidden="true"> ›</span>
        </button>
      )}
    </section>
  );
}

function RoadRow({ team, prefix, now, eightPlayer }) {
  const name = team.school?.name ?? team.schoolId;
  const g = team.nextGame;

  let next;
  if (g) {
    const opp = team.nextOpponent;
    const oppLabel = isTbdSide(opp) || !opp?.name
      ? "opponent TBD"
      : `${team.nextIsHome ? "vs" : "@"} ${opp.name}`;
    const live = g.status === "in_progress";
    const pending = !live && isScorePending(g, now);
    const unreported = !live && !pending && isStaleScheduled(g, now);
    const when = live
      ? "Live"
      : pending
        ? "Score pending"
        : unreported
          ? "Not reported"
          : whenLabel(g.date, now);
    next = (
      <Link to={`${prefix}/game/${g.id}`} className="rts__next">
        {/* Two unbreakable chunks — "Sectional Final ·" and "Today · 7:00
            PM" — so a narrow column wraps between them, never inside a time. */}
        <span className="rts__when">
          <span className="rts__round">
            {team.nextRound}
            <span className="rts__sep" aria-hidden="true"> ·</span>
            <span className="sr-only">,</span>
          </span>{" "}
          <span className={`rts__at${live ? " rts__live" : ""}`}>{when}</span>
        </span>
        <span className="rts__opp">{oppLabel}</span>
      </Link>
    );
  } else {
    const won = team.lastEntry?.round ?? "last round";
    next = (
      <span className="rts__next rts__next--tba">
        <span className="rts__when">
          <span className="rts__round">Won {won}</span>
        </span>
        <span className="rts__opp">next game TBA</span>
      </span>
    );
  }

  return (
    <li className="rts__row">
      <Link to={`${prefix}/team/${team.schoolId}`} className="rts__team">
        <TeamLogo team={{ school_id: team.schoolId, name }} school={team.school} size="sm" />
        <span className="rts__team-text">
          <span className="rts__name">{name}</span>
          {eightPlayer && <span className="rts__tag">8-player</span>}
        </span>
      </Link>
      {next}
    </li>
  );
}
