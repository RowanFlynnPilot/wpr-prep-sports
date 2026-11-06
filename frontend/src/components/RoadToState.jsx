import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Sponsor from "./Sponsor.jsx";
import { useSportPrefix } from "../utils/links.js";
import { isNeutralSite, isTbdSide, roundLabel } from "../utils/postseason.js";
import { playoffResultLabel } from "../utils/bracket.js";
import { humanizeVenue, isForfeitScore, isScorePending, isStaleScheduled } from "../utils/games.js";
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
 * each, with where it plays next — and, once the title games are played,
 * the state champions first with the result that won it. Sits above
 * Player of the Week on the Scores tab while the postseason is on, so
 * "are we still in it, and when do we play?" is answered before the
 * reader scrolls. Home-region schools lead; the rest follow
 * alphabetically. Built on utils/postseason.js so "alive" and "champion"
 * mean what the bracket and team pages mean by them.
 *
 * `schoolIndex` is optional: the neutral-site check needs school names
 * and cities, and the postseason state already carries every tracked
 * school's manifest entry.
 */
export default function RoadToState({
  state,
  homeRegion,
  sponsors,
  sportConfig,
  schoolIndex = null,
  now = Date.now(),
  onShowBracket,
}) {
  const prefix = useSportPrefix();
  const champions = state?.champions ?? [];
  const alive = state?.alive ?? [];
  if (!state?.active || (alive.length === 0 && champions.length === 0)) return null;

  const isLocal = (t) => !!homeRegion?.has?.(t.schoolId);
  const nameOf = (t) => t.school?.name ?? t.schoolId;
  const byLocalThenName = (a, b) =>
    (isLocal(b) ? 1 : 0) - (isLocal(a) ? 1 : 0) || nameOf(a).localeCompare(nameOf(b));
  const ordered = [...[...champions].sort(byLocalThenName), ...[...alive].sort(byLocalThenName)];
  const shown = ordered.slice(0, ROW_CAP);
  const total = ordered.length;
  const sportId = sportConfig?.id;
  const schools = schoolIndex ?? new Map((state.teams ?? []).map((t) => [t.schoolId, t.school]));

  // "1 state champion · 2 still alive" — singular/plural on each count.
  const tally = [
    champions.length > 0
      ? `${champions.length} state champion${champions.length === 1 ? "" : "s"}`
      : null,
    alive.length > 0
      ? champions.length > 0
        ? `${alive.length} still alive`
        : `${alive.length} ${alive.length === 1 ? "team" : "teams"} still alive`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rts" aria-labelledby="rts-heading">
      <div className="rts__head">
        <h2 id="rts-heading" className="rts__title">
          Road to State
        </h2>
        <span className="rts__hint">{tally}</span>
        <Sponsor slot="road" sponsors={sponsors} variant="inline" className="rts__sponsor" />
      </div>

      <ul className="rts__list">
        {shown.map((t) =>
          t.champion ? (
            <ChampionRow
              key={t.schoolId}
              team={t}
              prefix={prefix}
              sportId={sportId}
              schools={schools}
              eightPlayer={isEightPlayer(t.school, sportId)}
            />
          ) : (
            <RoadRow
              key={t.schoolId}
              team={t}
              prefix={prefix}
              now={now}
              sportId={sportId}
              schools={schools}
              eightPlayer={isEightPlayer(t.school, sportId)}
            />
          ),
        )}
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

function TeamCell({ team, prefix, eightPlayer, champion = false }) {
  const name = team.school?.name ?? team.schoolId;
  return (
    <Link to={`${prefix}/team/${team.schoolId}`} className="rts__team">
      <TeamLogo team={{ school_id: team.schoolId, name }} school={team.school} size="sm" />
      <span className="rts__team-text">
        <span className="rts__name">
          {champion && (
            <span className="rts__trophy" aria-hidden="true" title="State champion">
              🏆
            </span>
          )}
          {name}
        </span>
        {eightPlayer && <span className="rts__tag">8-player</span>}
      </span>
    </Link>
  );
}

/** Neutral-site venue line, or null when the game is at one school. */
function venueLine(game, schools) {
  if (!game?.venue || !isNeutralSite(game, schools)) return null;
  const v = humanizeVenue(game.venue);
  return (
    <span className="rts__venue" title={v}>
      {v}
    </span>
  );
}

/**
 * A state champion: the trophy, and the result that won it in place of a
 * next game ("Beat Heritage Christian 3-1 in the State Final"). The
 * result links to that game's page; there is no next game to link to.
 */
function ChampionRow({ team, prefix, sportId, schools, eightPlayer }) {
  const last = team.lastEntry;
  const g = last?.game ?? team.lastGame;
  const opp = last?.opponent;
  const oppName = (opp?.school_id ? schools?.get?.(opp.school_id)?.name : null) ?? opp?.name;
  const round = roundLabel(last?.round, sportId) || "the final";
  let result = null;
  if (last) {
    const hi = Math.max(last.ownScore, last.oppScore);
    const lo = Math.min(last.ownScore, last.oppScore);
    if (isForfeitScore(g)) result = `Won the ${round} over ${oppName} by forfeit`;
    else if (last.shootout)
      result = `Beat ${oppName} on penalty kicks after a ${hi}-${lo} draw in the ${round}`;
    else result = `Beat ${oppName} ${hi}-${lo} in the ${round}`;
  }
  const body = (
    <>
      <span className="rts__when">
        <span className="rts__round rts__round--champ">State champions</span>
      </span>
      {result && (
        <>
          <span className="sr-only">, </span>
          <span className="rts__opp">{result}</span>
        </>
      )}
      {venueLine(g, schools)}
    </>
  );
  return (
    <li className="rts__row rts__row--champ">
      <TeamCell team={team} prefix={prefix} eightPlayer={eightPlayer} champion />
      {g ? (
        <Link to={`${prefix}/game/${g.id}`} className="rts__next rts__next--champ">
          {body}
        </Link>
      ) : (
        <span className="rts__next rts__next--champ">{body}</span>
      )}
    </li>
  );
}

function RoadRow({ team, prefix, now, sportId, schools, eightPlayer }) {
  const g = team.nextGame;

  let next;
  if (g) {
    const opp = team.nextOpponent;
    // State and sectional games are at neutral arenas; "home" is only
    // WIAA's listing order, so the row says "vs" and names the venue.
    const neutral = isNeutralSite(g, schools);
    const oppLabel = isTbdSide(opp) || !opp?.name
      ? "opponent TBD"
      : `${team.nextIsHome || neutral ? "vs" : "@"} ${opp.name}`;
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
            {roundLabel(team.nextRound, sportId)}
            <span className="rts__sep" aria-hidden="true"> ·</span>
            <span className="sr-only">,</span>
          </span>{" "}
          <span className={`rts__at${live ? " rts__live" : ""}`}>{when}</span>
        </span>
        {/* The stacked spans ran together for screen readers ("7:00 PMvs
            Lomira"); the hidden comma separates them. */}
        <span className="sr-only">, </span>
        <span className="rts__opp">{oppLabel}</span>
        {neutral && venueLine(g, schools)}
      </Link>
    );
  } else {
    const last = team.lastEntry;
    const round = roundLabel(last?.round, sportId) || "last round";
    const pk = last?.shootout ? playoffResultLabel(last) : null;
    next = (
      <span className="rts__next rts__next--tba">
        <span className="rts__when">
          <span className="rts__round">{last?.undecided ? round : `Won ${round}`}</span>
        </span>
        <span className="sr-only">, </span>
        <span className="rts__opp">
          {last?.undecided
            ? `${pk} · shootout result pending`
            : pk
              ? `${pk} · next game TBA`
              : "next game TBA"}
        </span>
      </span>
    );
  }

  return (
    <li className="rts__row">
      <TeamCell team={team} prefix={prefix} eightPlayer={eightPlayer} />
      {next}
    </li>
  );
}
