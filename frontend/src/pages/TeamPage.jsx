import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import NotFound from "../components/NotFound.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TeamLink from "../components/TeamLink.jsx";
import Sponsor from "../components/Sponsor.jsx";
import SeasonLeaders from "../components/SeasonLeaders.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import FavoriteButton from "../components/FavoriteButton.jsx";
import {
  formatGameDay,
  formatGameDate,
  formatGameTime,
  formatGameShortDay,
} from "../utils/dates.js";
import { isForfeitScore } from "../utils/games.js";
import { todaysGameFor, todayWord } from "../utils/gameDay.js";
import { recapForGame } from "../utils/recap.js";
import { seasonSummary, seasonState } from "../utils/seasonSummary.js";
import { useSportPrefix } from "../utils/links.js";
import { recordLabels } from "../config/sports.js";
import { rotatedBannerSlot } from "../utils/sponsorRotation.js";
import { SITE, SITE_TITLE } from "../config/site.js";
import ShareButton from "../components/ShareButton.jsx";
import useDocumentTitle from "../utils/useDocumentTitle.js";

export default function TeamPage({ dataset, schoolIndex, sponsors, sportConfig }) {
  const { schoolId } = useParams();
  const sportPrefix = useSportPrefix();
  const school = schoolIndex.get(schoolId);
  // "Edgar Football" in the tab and history; null (title untouched) until
  // the school resolves. Unconditional — it sits above the NotFound return.
  useDocumentTitle(
    school ? `${school.name} ${sportConfig?.label ?? ""}`.trim() : null,
  );
  // The unknown-school guard lives AFTER the hooks — the router keeps this
  // component instance mounted when only :schoolId changes, so returning
  // before the hooks on a bad id changes the hook count mid-lifecycle and
  // React throws (which the error boundary turns into a dead widget).

  const teamGames = useMemo(
    () =>
      dataset.games
        .filter(
          (g) =>
            g.home.school_id === schoolId || g.away.school_id === schoolId,
        )
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [dataset.games, schoolId],
  );

  const record = useMemo(() => computeRecord(teamGames, schoolId), [teamGames, schoolId]);
  // Game day (utils/gameDay.js): this school's game today, for the
  // "Tonight · vs Chippewa Falls · 7:00 PM" line under the name. Critique
  // run 17 found the Friday-evening team page saying nothing about that
  // night's kickoff, eight rows down in the schedule.
  const todayGame = useMemo(() => todaysGameFor(teamGames, schoolId), [teamGames, schoolId]);

  const seasonStatsForSchool = useMemo(
    () => (dataset.seasonStats ?? []).filter((r) => r.school_id === schoolId),
    [dataset.seasonStats, schoolId],
  );

  // The conference standing this team sits in (if any) — surfaced on the
  // team page so a visitor sees where the team ranks without hopping to
  // the dashboard's Standings tab.
  const conferenceStanding = useMemo(
    () =>
      (dataset.standings ?? []).find((s) =>
        (s.rows ?? []).some((r) => r.school_id === schoolId),
      ) ?? null,
    [dataset.standings, schoolId],
  );

  // Where the season stands (utils/seasonSummary.js seasonState): still
  // alive and when the next round is, out and to whom, or over. Without
  // it, Gilman's page read 9-0 / 3-0 with nothing saying it plays Level 4
  // next Friday, and Stratford's looked mid-season a day after its exit.
  const seasonNow = useMemo(
    () =>
      seasonState({
        teamGames,
        allGames: dataset.games,
        schoolId,
        schoolsById: schoolIndex,
        sportConfig,
      }),
    [teamGames, dataset.games, schoolId, schoolIndex, sportConfig],
  );

  const summary = useMemo(
    () =>
      school
        ? seasonSummary({
            teamGames,
            schoolId,
            school,
            schoolsById: schoolIndex,
            seasonStatsForSchool,
            sportConfig,
          })
        : null,
    [teamGames, schoolId, school, schoolIndex, seasonStatsForSchool, sportConfig],
  );

  // Try to find this school's logo from any of their home games (where the
  // home team's logo is theirs). Falls back to the colored monogram.
  const logoUrl = useMemo(() => {
    const homeGame = teamGames.find(
      (g) => g.home.school_id === schoolId && g.home.logo_url,
    );
    if (homeGame) return homeGame.home.logo_url;
    const awayGame = teamGames.find(
      (g) => g.away.school_id === schoolId && g.away.logo_url,
    );
    return awayGame?.away.logo_url ?? null;
  }, [teamGames, schoolId]);

  if (!school) {
    return <NotFound kind="team" sportPrefix={sportPrefix} sponsors={sponsors} />;
  }

  const heroTeam = {
    school_id: schoolId,
    name: school.name,
    logo_url: logoUrl,
  };

  const breadcrumb = (
    <>
      <Link to={sportPrefix} className="breadcrumb__back">
        <span aria-hidden="true" className="breadcrumb__back-arrow">‹</span>
        Back to {sportConfig?.label ?? "Teams"}
      </Link>
      <span aria-hidden="true" className="breadcrumb__sep">·</span>
      <span className="breadcrumb__current">{school.name}</span>
    </>
  );

  // School color emitted as a CSS variable so the hero rail picks up
  // each team's primary color, falling back gracefully to muted gray
  // when the manifest doesn't have one.
  const schoolColor = school?.colors?.[0] ?? null;
  const heroStyle = schoolColor ? { "--school-color": schoolColor } : undefined;

  return (
    <Layout breadcrumb={breadcrumb} sponsors={sponsors}>
      <section
        className={"team-hero" + (schoolColor ? " team-hero--colored" : "")}
        style={heroStyle}
      >
        <TeamLogo team={heroTeam} school={school} size="xl" />
        <div className="team-hero__meta">
          <span className="eyebrow">{school.full_name}</span>
          <h1 className="team-hero__name">{school.name}</h1>
          <p className="team-hero__mascot">
            {school.mascot} · {school.city}
          </p>
          {todayGame && (() => {
            const isHome = todayGame.home.school_id === schoolId;
            const opp = isHome ? todayGame.away : todayGame.home;
            const own = isHome ? todayGame.home.score : todayGame.away.score;
            const theirs = isHome ? todayGame.away.score : todayGame.home.score;
            const when = todayWord(todayGame.date);
            const label =
              todayGame.status === "final"
                ? `${when} · ${own > theirs ? "W" : own < theirs ? "L" : "T"} ${own}-${theirs} ${isHome ? "vs" : "at"} ${opp.name}`
                : todayGame.status === "in_progress"
                  ? `Live · ${isHome ? "vs" : "at"} ${opp.name} · ${own ?? 0}-${theirs ?? 0}`
                  : `${when} · ${isHome ? "vs" : "at"} ${opp.name} · ${formatGameTime(todayGame.date)}`;
            return (
              <Link to={`${sportPrefix}/game/${todayGame.id}`} className="team-hero__tonight">
                {label} <span aria-hidden="true">›</span>
              </Link>
            );
          })()}
          <span className="team-hero__actions">
            <FavoriteButton schoolId={schoolId} schoolName={school.name} />
            <ShareButton
              route={`${sportPrefix}/team/${schoolId}`}
              title={`${school.name} ${sportConfig?.label ?? ""} — ${SITE_TITLE}`.replace(
                /\s+/g,
                " ",
              )}
            />
          </span>
        </div>
        <div className="team-hero__record">
          <div className="record-stat">
            <span className="record-stat__num">
              {record.regWins}-{record.regLosses}
              {record.regTies > 0 ? `-${record.regTies}` : ""}
            </span>
            <span className="record-stat__label">
              {record.playedPlayoffs ? "Regular" : "Overall"}
            </span>
          </div>
          {record.playedPlayoffs && (
            <div className="record-stat">
              <span className="record-stat__num">
                {record.postWins}-{record.postLosses}
                {record.postTies > 0 ? `-${record.postTies}` : ""}
              </span>
              <span className="record-stat__label">Playoffs</span>
            </div>
          )}
          {record.pointsFor > 0 && (() => {
            const labels = recordLabels(sportConfig);
            return (
              <>
                <div className="record-stat">
                  <span className="record-stat__num">{record.pointsFor.toLocaleString("en-US")}</span>
                  <span className="record-stat__label">
                    <abbr title={labels.forTitle}>{labels.for}</abbr>
                  </span>
                </div>
                <div className="record-stat">
                  <span className="record-stat__num">{record.pointsAgainst.toLocaleString("en-US")}</span>
                  <span className="record-stat__label">
                    <abbr title={labels.againstTitle}>{labels.against}</abbr>
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      </section>

      {seasonNow && (
        <SeasonStateBanner
          state={seasonNow}
          record={record}
          schoolId={schoolId}
          schoolIndex={schoolIndex}
          sportPrefix={sportPrefix}
        />
      )}

      {summary && (
        <section className="season-summary" aria-label="Season summary">
          <span className="season-summary__label">Season Summary</span>
          <p className="season-summary__body">{summary}</p>
        </section>
      )}

      <section>
        <div className="section-header">
          <h2>{sportConfig.season} Schedule</h2>
          <span className="section-header__hint">
            {sportConfig.label} · {teamGames.length} games
          </span>
        </div>

        {teamGames.length === 0 ? (
          <div className="team-empty">No games scheduled.</div>
        ) : (
          <SeasonSchedule
            teamGames={teamGames}
            schoolId={schoolId}
            schoolIndex={schoolIndex}
            sportPrefix={sportPrefix}
            sportConfig={sportConfig}
          />
        )}
      </section>

      {conferenceStanding ? (
        <section>
          <div className="section-header">
            <h2>Conference Standings</h2>
            <span className="section-header__hint">
              {conferenceStanding.conference} · {sportConfig?.label}
            </span>
          </div>
          <StandingsTable
            standing={conferenceStanding}
            schoolIndex={schoolIndex}
            sponsors={sponsors}
            seasonStats={dataset.seasonStats}
            sportConfig={sportConfig}
            games={dataset.games}
            highlightSchoolId={schoolId}
          />
        </section>
      ) : (
        // Finals on the schedule but no standings row anywhere: the school
        // plays this sport in a conference the hub does not model (Gilman
        // and Black River Falls football). Say so, rather than leaving a
        // silent gap where every other team page has a table.
        teamGames.some((g) => g.status === "final") && (
          <section>
            <div className="section-header">
              <h2>Conference Standings</h2>
              <span className="section-header__hint">{sportConfig?.label}</span>
            </div>
            <p className="team-standings-note">
              {school.name} plays {(sportConfig?.label ?? "this sport").toLowerCase()} in a
              conference the hub doesn&rsquo;t track yet. Schedule and results above are
              complete.
            </p>
          </section>
        )
      )}

      <SeasonLeaders rows={seasonStatsForSchool} sportConfig={sportConfig} />

      <Sponsor slot={`school:${schoolId}`} sponsors={sponsors} variant="card" />

      {/* Anchor banner — cross-sport full-creative surface on every team
          page (data/sponsors.json "banner:team"). The per-school card
          above stays independently sellable; this is the network buy. */}
      <Sponsor slot={rotatedBannerSlot(sponsors, "banner:team")} sponsors={sponsors} variant="banner" />
    </Layout>
  );
}

/** "9-2", or "4-1-2" once a draw is on the books. */
function recordText(wins, losses, ties) {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/** "Fri Nov 6" in the home zone. */
function shortDayDate(iso) {
  // Same day as the hero's "Today · vs X" line: say "Today" (or "Tonight"
  // from 5 PM) instead of repeating the date.
  if (new Date(iso).toDateString() === new Date().toDateString()) return todayWord(iso);
  const day = formatGameShortDay(iso);
  return `${day.charAt(0)}${day.slice(1).toLowerCase()} ${formatGameDate(iso)}`;
}

/**
 * One line under the hero: "Still alive · Level 4 · Fri Nov 6 · vs
 * opponent TBD", "Season over · 9-2 · Lost Level 2 to Wrightstown 9-0",
 * or "Season over · 3-6". Over seasons get a "Share this season" link to
 * the wrapped card.
 */
function SeasonStateBanner({ state, record, schoolId, schoolIndex, sportPrefix }) {
  const overall = recordText(record.wins, record.losses, record.ties);
  const nameOf = (side) =>
    (side?.school_id ? schoolIndex.get(side.school_id)?.name : null) ?? side?.name ?? "opponent";
  const gameLink = (game, text) => (
    <Link to={`${sportPrefix}/game/${game.id}`} className="season-state__link">
      <span className="season-state__linktext">{text}</span> <span aria-hidden="true">›</span>
    </Link>
  );

  let status;
  let detail = null;
  if (state.kind === "alive") {
    status = "Still alive";
    const where = state.opponent
      ? `${state.isHome ? "vs" : "at"} ${nameOf(state.opponent)}`
      : `${state.isHome === false ? "at" : "vs"} opponent TBD`;
    const when = state.live ? "Live now" : shortDayDate(state.game.date);
    detail = gameLink(state.game, `${state.round} · ${when} · ${where}`);
  } else if (state.kind === "alive-tba") {
    status = "Still alive";
    const last = state.lastEntry;
    detail = (
      <>
        {last?.game ? gameLink(last.game, `won ${last.round}`) : <span>won {last?.round}</span>}
        <span>next round TBA</span>
      </>
    );
  } else {
    status = state.kind === "champion" ? "State champions" : "Season over";
    const last = state.lastEntry;
    let outcome = null;
    if (last?.game) {
      const opp = nameOf(last.opponent);
      const forfeit = isForfeitScore(last.game);
      const high = Math.max(last.ownScore, last.oppScore);
      const low = Math.min(last.ownScore, last.oppScore);
      outcome =
        state.kind === "champion"
          ? `Won ${last.round} over ${opp} ${forfeit ? "by forfeit" : `${high}-${low}`}`
          : last.ownScore === last.oppScore && !forfeit
            ? `Out in ${last.round} vs ${opp} ${high}-${low}`
            : `Lost ${last.round} to ${opp} ${forfeit ? "by forfeit" : `${high}-${low}`}`;
    }
    detail = (
      <>
        <span className="season-state__record">{overall}</span>
        {outcome && gameLink(last.game, outcome)}
      </>
    );
  }

  const over = state.kind === "eliminated" || state.kind === "complete" || state.kind === "champion";
  return (
    <div className="season-state-wrap">
      <p className="season-state">
        <span className="season-state__status">{status}</span>
        {detail}
      </p>
      {over && (
        <Link to={`${sportPrefix}/card/wrapped/${schoolId}`} className="season-state__share">
          Share this season <span aria-hidden="true">›</span>
        </Link>
      )}
    </div>
  );
}

function computeRecord(games, schoolId) {
  // Draws are real in soccer — counting them as losses misstates the
  // record and disagrees with the schedule rows below, which show "·".
  let wins = 0, losses = 0, ties = 0, pf = 0, pa = 0;
  let regWins = 0, regLosses = 0, regTies = 0;
  let postWins = 0, postLosses = 0, postTies = 0;
  for (const g of games) {
    if (g.status !== "final") continue;
    const isHome = g.home.school_id === schoolId;
    const own = isHome ? g.home.score : g.away.score;
    const opp = isHome ? g.away.score : g.home.score;
    if (own == null || opp == null) continue;
    pf += own;
    pa += opp;
    const won = own > opp;
    const tied = own === opp;
    if (won) wins++;
    else if (tied) ties++;
    else losses++;
    if (g.playoff) {
      if (won) postWins++;
      else if (tied) postTies++;
      else postLosses++;
    } else {
      if (won) regWins++;
      else if (tied) regTies++;
      else regLosses++;
    }
  }
  const playedPlayoffs = postWins + postLosses + postTies > 0;
  return {
    wins,
    losses,
    ties,
    regWins,
    regLosses,
    regTies,
    postWins,
    postLosses,
    postTies,
    playedPlayoffs,
    pointsFor: pf,
    pointsAgainst: pa,
  };
}

function SeasonSchedule({ teamGames, schoolId, schoolIndex, sportPrefix, sportConfig }) {
  const regular = teamGames.filter((g) => !g.playoff);
  const playoffs = teamGames.filter((g) => g.playoff);

  // When no playoff games exist, render as a single list with no
  // sub-headers — the existing layout. Same when the team got 0
  // regular-season games (unlikely but possible during a fresh scrape).
  if (playoffs.length === 0 || regular.length === 0) {
    return (
      <ol className="team-schedule">
        {teamGames.map((g, idx) => (
          <ScheduleRow
            key={g.id}
            game={g}
            index={idx + 1}
            schoolId={schoolId}
            schoolIndex={schoolIndex}
            allTeamGames={teamGames}
            sportPrefix={sportPrefix}
            sportConfig={sportConfig}
          />
        ))}
      </ol>
    );
  }

  return (
    <>
      <h3 className="schedule-divider">
        <span>Regular Season</span>
        <span className="schedule-divider__count">{regular.length} games</span>
      </h3>
      <ol className="team-schedule">
        {regular.map((g, idx) => (
          <ScheduleRow
            key={g.id}
            game={g}
            index={idx + 1}
            schoolId={schoolId}
            schoolIndex={schoolIndex}
            allTeamGames={teamGames}
            sportPrefix={sportPrefix}
            sportConfig={sportConfig}
          />
        ))}
      </ol>

      <h3 className="schedule-divider schedule-divider--playoffs">
        <span>{SITE.governingBody} Playoffs</span>
        <span className="schedule-divider__count">
          {playoffs.length} game{playoffs.length === 1 ? "" : "s"}
        </span>
      </h3>
      <ol className="team-schedule">
        {playoffs.map((g, idx) => (
          <ScheduleRow
            key={g.id}
            game={g}
            index={idx + 1}
            schoolId={schoolId}
            schoolIndex={schoolIndex}
            allTeamGames={teamGames}
            sportPrefix={sportPrefix}
            sportConfig={sportConfig}
          />
        ))}
      </ol>
    </>
  );
}

function ScheduleRow({ game, index, schoolId, schoolIndex, allTeamGames, sportPrefix, sportConfig }) {
  const isHome = game.home.school_id === schoolId;
  const opponent = isHome ? game.away : game.home;
  const opponentSchool = schoolIndex.get(opponent.school_id);
  const own = isHome ? game.home.score : game.away.score;
  const opp = isHome ? game.away.score : game.home.score;
  const isFinal = game.status === "final";
  const won = isFinal && own != null && opp != null && own > opp;
  const lost = isFinal && own != null && opp != null && own < opp;
  const forfeit = isFinal && isForfeitScore(game);
  const recap = recapForGame(game, {
    schoolsById: schoolIndex,
    teamGames: allTeamGames,
    perspectiveSchoolId: schoolId,
    contextGames: allTeamGames,
    sportConfig,
  });

  return (
    <li className={"schedule-row" + (game.playoff ? " schedule-row--playoff" : "")}>
      <span className="schedule-row__index">{index}</span>
      <div className="schedule-row__date">
        <span className="schedule-row__day">{formatGameDay(game.date)}</span>
        <span className="schedule-row__datelabel">{formatGameDate(game.date)}</span>
      </div>
      <div className="schedule-row__matchup">
        <span className="schedule-row__location">{isHome ? "vs" : "@"}</span>
        <TeamLogo team={opponent} school={opponentSchool} size="sm" />
        <TeamLink team={opponent} className="schedule-row__opponent">
          {opponent.name}
        </TeamLink>
        {game.playoff && game.playoff_round && (
          <span
            className="schedule-row__round"
            title={`${SITE.governingBody} tournament round`}
          >
            {game.playoff_round}
          </span>
        )}
      </div>
      <Link
        to={`${sportPrefix}/game/${game.id}`}
        className={
          "schedule-row__result schedule-row__result--link " +
          (won ? "schedule-row__result--win" : lost ? "schedule-row__result--loss" : "")
        }
        aria-label={`Game details${
          isFinal ? (forfeit ? ", forfeit" : `, final ${own}-${opp}`) : ""
        }`}
      >
        {isFinal ? (
          <>
            <span className="schedule-row__outcome">
              {won ? "W" : lost ? "L" : "·"}
            </span>
            <span className="schedule-row__score">
              {forfeit ? "Forfeit" : `${own}-${opp}`}
            </span>
          </>
        ) : (
          <span className="schedule-row__time">{formatGameTime(game.date)}</span>
        )}
      </Link>
      {recap && <p className="schedule-row__recap">{recap}</p>}
    </li>
  );
}
