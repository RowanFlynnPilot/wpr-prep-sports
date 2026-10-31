import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { fetchDataset } from "../data/fetchDataset.js";
import TeamLogo from "../components/TeamLogo.jsx";
import { indexSchools, primaryColor } from "../utils/schools.js";
import { configForDataset, formatSeasonLabel, isKnownSport, recordLabels } from "../config/sports.js";
import { formatGameDate } from "../utils/dates.js";
import { isForfeitScore } from "../utils/games.js";
import { buildTeamJourneys } from "../utils/bracket.js";
import { isTbdSide } from "../utils/postseason.js";
import { teamGamesFor } from "../utils/teamSummary.js";
import { formatStatsLine, teamSeasonLeaders } from "../utils/seasonStats.js";
import { displayPlayerName } from "../utils/players.js";
import { shareLink, shareUrlFor } from "../utils/share.js";
import { trackEvent } from "../utils/analytics.js";
import useDocumentTitle from "../utils/useDocumentTitle.js";
import { SITE, SITE_TITLE } from "../config/site.js";
import "../styles/WrappedCard.css";

/**
 * "Season Wrapped" — one school's season on a single shareable card.
 *
 * Two sizes, one component:
 *   default        1080×1920 (9:16, a phone story / Messages image)
 *   ?format=og     1200×630  (link-preview shape, same as OgCardPage)
 *
 * Route params are `:sport` and `:schoolId`. The page fetches its own
 * dataset when mounted outside SportShell (the top-level
 * `/card/wrapped/:sport/:schoolId` route, which is what the PNG generator
 * navigates to) and uses the props when mounted inside it, so the same
 * component serves both URL shapes.
 *
 * The generator (scraper/scripts/generate_wrapped_cards.py) adds
 * `?capture=1`, waits for `[data-wrapped-ready]`, and screenshots
 * `.wrapped-card`. Capture mode drops the hub toolbar and the fit-to-
 * viewport scaling so the element renders at its native pixel size.
 *
 * Every block is fed by the live dataset and is omitted when the data
 * behind it is missing — no placeholders on a card people will forward.
 */
export default function WrappedCardPage({
  dataset: datasetProp = null,
  schoolIndex: schoolIndexProp = null,
  sportConfig: sportConfigProp = null,
}) {
  const { sport, schoolId } = useParams();
  const location = useLocation();
  const [fetched, setFetched] = useState(null);
  const [error, setError] = useState(null);

  const needsFetch = !datasetProp || datasetProp.sport !== sport;
  useEffect(() => {
    if (!needsFetch) return;
    if (!isKnownSport(sport)) {
      setError(`Unknown sport: ${sport}`);
      return;
    }
    let cancelled = false;
    setFetched(null);
    setError(null);
    fetchDataset(sport)
      .then((d) => !cancelled && setFetched(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sport, needsFetch]);

  const dataset = needsFetch ? fetched : datasetProp;

  // `?format=og` and `?capture=1` may sit before the hash (the generator's
  // URL, alongside ?theme=light) or inside it (a link typed in the hub).
  const params = useMemo(() => {
    const merged = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    for (const [k, v] of new URLSearchParams(location.search)) merged.set(k, v);
    return merged;
  }, [location.search]);
  const format = params.get("format") === "og" ? "og" : "story";
  const capture = params.has("capture");

  const schoolIndex = useMemo(() => {
    if (!dataset) return null;
    if (!needsFetch && schoolIndexProp) return schoolIndexProp;
    return indexSchools(dataset.schools, dataset.games);
  }, [dataset, needsFetch, schoolIndexProp]);

  const sportConfig = useMemo(
    () =>
      !needsFetch && sportConfigProp
        ? sportConfigProp
        : configForDataset(sport, dataset?.meta?.season),
    [needsFetch, sportConfigProp, sport, dataset?.meta?.season],
  );

  const school = schoolIndex?.get(schoolId) ?? null;
  useDocumentTitle(
    school ? `${school.name} ${sportConfig?.label ?? ""} — Season Wrapped`.replace(/\s+/g, " ") : null,
  );

  const wrapped = useMemo(
    () => (dataset && school ? buildWrapped({ dataset, school, schoolId, schoolIndex, sportConfig }) : null),
    [dataset, school, schoolId, schoolIndex, sportConfig],
  );

  if (error) return <CardError message={error} format={format} />;
  if (!dataset) return <CardLoading format={format} />;
  if (!school) return <CardError message={`School not found: ${schoolId}`} format={format} />;
  if (!wrapped) return <CardError message={`No games on record for ${school.name}`} format={format} />;

  const card = <Card wrapped={wrapped} school={school} sportConfig={sportConfig} format={format} />;
  if (capture) return <div className="wrapped-capture">{card}</div>;

  return (
    <HubFrame
      wrapped={wrapped}
      school={school}
      sport={sport}
      schoolId={schoolId}
      sportConfig={sportConfig}
      format={format}
      routePath={location.pathname}
      version={dataset.meta?.last_updated}
    >
      {card}
    </HubFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const CARD_SIZE = {
  story: { width: 1080, height: 1920 },
  og: { width: 1200, height: 630 },
};

/** Same W/L/T split TeamPage's hero uses (its computeRecord isn't exported). */
function computeRecord(games, schoolId) {
  const rec = {
    wins: 0, losses: 0, ties: 0,
    regWins: 0, regLosses: 0, regTies: 0,
    postWins: 0, postLosses: 0, postTies: 0,
    pointsFor: 0, pointsAgainst: 0,
  };
  for (const g of games) {
    if (g.status !== "final") continue;
    const isHome = g.home.school_id === schoolId;
    const own = isHome ? g.home.score : g.away.score;
    const opp = isHome ? g.away.score : g.home.score;
    if (own == null || opp == null) continue;
    rec.pointsFor += own;
    rec.pointsAgainst += opp;
    const key = own > opp ? "Wins" : own === opp ? "Ties" : "Losses";
    rec[key.toLowerCase()] += 1;
    rec[(g.playoff ? "post" : "reg") + key] += 1;
  }
  rec.playedPlayoffs = rec.postWins + rec.postLosses + rec.postTies > 0;
  return rec;
}

function recordString(w, l, t = 0) {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

const ORDINAL_SUFFIX = { one: "st", two: "nd", few: "rd", other: "th" };
const ORDINAL_RULES = new Intl.PluralRules("en-US", { type: "ordinal" });
function ordinal(n) {
  return `${n}${ORDINAL_SUFFIX[ORDINAL_RULES.select(n)]}`;
}

/**
 * Conference record and place from standings.json, with StandingsTable's
 * shared-rank rule: rows tied on conference W-L-T and overall wins print
 * "T-1", and the next rank is skipped.
 */
function conferenceLine(standings, schoolId) {
  const table = (standings ?? []).find((s) => (s.rows ?? []).some((r) => r.school_id === schoolId));
  if (!table) return null;
  const rows = table.rows;
  const started = rows.some((r) => (r.overall_wins ?? 0) + (r.overall_losses ?? 0) > 0);
  const tieKey = (r) =>
    `${r.conference_wins ?? 0}-${r.conference_losses ?? 0}-${r.conference_ties ?? 0}|${r.overall_wins ?? 0}`;
  let rank = null;
  let tied = false;
  const ranks = [];
  rows.forEach((r, i) => {
    const sharesPrev = started && i > 0 && tieKey(rows[i - 1]) === tieKey(r);
    ranks.push(sharesPrev ? ranks[i - 1] : i + 1);
  });
  const idx = rows.findIndex((r) => r.school_id === schoolId);
  const row = rows[idx];
  if (idx >= 0) {
    rank = ranks[idx];
    tied = ranks.filter((x) => x === rank).length > 1;
  }
  const played = (row.conference_wins ?? 0) + (row.conference_losses ?? 0) + (row.conference_ties ?? 0);
  if (played === 0) return null;
  return {
    conference: table.conference,
    record: recordString(row.conference_wins ?? 0, row.conference_losses ?? 0, row.conference_ties ?? 0),
    place: rank && started ? `${tied ? "T-" : ""}${ordinal(rank)} of ${rows.length}` : null,
  };
}

/** "Level 2" stays; "State Semifinal" → "State semifinal" for prose. */
function roundForProse(round) {
  if (!round) return "the playoffs";
  if (/^level\s*\d/i.test(round)) return round;
  return round.charAt(0).toUpperCase() + round.slice(1).toLowerCase();
}

function opponentName(side, schoolIndex) {
  return schoolIndex?.get(side?.school_id)?.name ?? side?.name ?? "TBD";
}

/**
 * One line for the postseason, from the team's own playoff games:
 *   "Lost Level 2 to Wrightstown 9-0"
 *   "Won Level 3 over Lomira 28-7"            (season still going, next game not yet listed)
 *   "State semifinal, Nov 6 vs Lomira"        (next game scheduled)
 *   "State champions — beat X 21-14"
 * Built directly on bracket.js rather than postseasonState(), whose
 * "active" window closes a week after the last final — this card is
 * mostly looked at after that.
 */
function playoffLine(teamGames, schoolId, schoolIndex) {
  const journey = buildTeamJourneys(teamGames.filter((g) => g.playoff), schoolIndex).find(
    (j) => j.schoolId === schoolId,
  );
  if (!journey || journey.games.length === 0) return null;
  const entries = journey.games;
  const last = entries[entries.length - 1];
  const wins = entries.filter((e) => e.won).length;
  const next = entries.find((e) => !e.isFinal);

  if (next) {
    const opp = isTbdSide(next.opponent) ? null : opponentName(next.opponent, schoolIndex);
    const where = opp ? ` ${next.isHome ? "vs" : "at"} ${opp}` : "";
    return {
      headline: `${roundForProse(next.round)}, ${formatGameDate(next.game.date)}${where}`,
      detail: wins > 0 ? `${wins} playoff win${wins === 1 ? "" : "s"} so far` : "Playoffs",
      alive: true,
    };
  }
  if (last.ownScore == null || last.oppScore == null) return null;
  const opp = opponentName(last.opponent, schoolIndex);
  if (last.won) {
    const title = /state\s+(final|championship)/i.test(last.round);
    return {
      headline: title
        ? `State champions — beat ${opp} ${last.ownScore}-${last.oppScore}`
        : `Won ${roundForProse(last.round)} over ${opp} ${last.ownScore}-${last.oppScore}`,
      detail: title ? `${wins} playoff wins` : "Awaiting the next round",
      alive: true,
    };
  }
  if (last.ownScore === last.oppScore) return null;
  return {
    headline: `Lost ${roundForProse(last.round)} to ${opp} ${last.oppScore}-${last.ownScore}`,
    detail: wins > 0 ? `${wins} playoff win${wins === 1 ? "" : "s"}` : null,
    alive: false,
  };
}

/** Finals with both scores, from this team's side; forfeits excluded. */
function scoredGames(teamGames, schoolId) {
  const out = [];
  for (const g of teamGames) {
    if (g.status !== "final" || isForfeitScore(g)) continue;
    const isHome = g.home.school_id === schoolId;
    const own = isHome ? g.home.score : g.away.score;
    const opp = isHome ? g.away.score : g.home.score;
    if (own == null || opp == null) continue;
    out.push({ game: g, isHome, own, opp, margin: own - opp });
  }
  return out;
}

function gameLine(entry, schoolIndex) {
  const { game, isHome, own, opp } = entry;
  const oppName = opponentName(isHome ? game.away : game.home, schoolIndex);
  const outcome = own > opp ? "W" : own < opp ? "L" : "T";
  return {
    outcome,
    score: `${own}-${opp}`,
    opponent: `${isHome ? "vs" : "at"} ${oppName}`,
    date: formatGameDate(game.date),
    round: game.playoff ? game.playoff_round : null,
  };
}

/** Calendar years the team played in: "2026" or "2026–27". */
function seasonEyebrow(teamGames, metaSeason) {
  const years = new Set(teamGames.map((g) => String(g.date).slice(0, 4)));
  if (years.size === 1) return `${[...years][0]} season`;
  return `${formatSeasonLabel(metaSeason) ?? [...years].sort().join("–")} season`;
}

function buildWrapped({ dataset, school, schoolId, schoolIndex, sportConfig }) {
  const teamGames = teamGamesFor(dataset.games, schoolId);
  if (teamGames.length === 0) return null;
  const record = computeRecord(teamGames, schoolId);
  if (record.wins + record.losses + record.ties === 0) return null;

  const scored = scoredGames(teamGames, schoolId);
  const wins = scored.filter((e) => e.margin > 0);
  const biggestWin = wins.length
    ? wins.reduce((best, e) => (e.margin > best.margin ? e : best))
    : null;
  const decided = scored.filter((e) => e.margin !== 0);
  let closest = decided.length
    ? decided.reduce((best, e) => (Math.abs(e.margin) < Math.abs(best.margin) ? e : best))
    : null;
  if (closest && biggestWin && closest.game.id === biggestWin.game.id) closest = null;

  const seasonRows = (dataset.seasonStats ?? []).filter((r) => r.school_id === schoolId);
  const leaders = teamSeasonLeaders(seasonRows, sportConfig)
    .map(({ category, row }) => {
      const line = formatStatsLine(category, row.stats);
      if (!line) return null;
      const [headline, ...rest] = line.split(" · ");
      return {
        id: category.id,
        label: category.displayLabel,
        name: displayPlayerName(row.player_name),
        year: row.player_year ?? null,
        headline,
        rest: rest.join(" · "),
      };
    })
    .filter(Boolean)
    .slice(0, 3);

  const seasonComplete = !teamGames.some(
    (g) => g.status !== "final" && new Date(g.date).getTime() > Date.now(),
  );

  return {
    eyebrow: seasonEyebrow(teamGames, dataset.meta?.season),
    record,
    overall: recordString(record.wins, record.losses, record.ties),
    regular: recordString(record.regWins, record.regLosses, record.regTies),
    postseason: record.playedPlayoffs
      ? recordString(record.postWins, record.postLosses, record.postTies)
      : null,
    conference: conferenceLine(dataset.standings, schoolId),
    playoff: playoffLine(teamGames, schoolId, schoolIndex),
    leaders,
    biggestWin: biggestWin ? gameLine(biggestWin, schoolIndex) : null,
    closest: closest ? gameLine(closest, schoolIndex) : null,
    gamesPlayed: record.wins + record.losses + record.ties,
    seasonComplete,
    schoolName: school.name,
  };
}

/** The sentence that travels with the link in a share sheet. */
function shareText(wrapped, school, sportConfig) {
  const bits = [`${school.name} ${sportConfig.label}, ${wrapped.eyebrow}: ${wrapped.overall}`];
  if (wrapped.conference) bits.push(`${wrapped.conference.record} ${wrapped.conference.conference}`);
  if (wrapped.playoff && !wrapped.playoff.alive) bits.push(wrapped.playoff.headline.toLowerCase());
  return `${bits.join(" · ")}. Season Wrapped from ${SITE_TITLE}.`;
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

function Card({ wrapped, school, sportConfig, format }) {
  const color = primaryColor(school) || "#1f2937";
  const labels = recordLabels(sportConfig);
  const { record } = wrapped;
  const hubHost = SITE.hubUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <article
      className={`wrapped-card wrapped-card--${format}`}
      style={{ "--school-color": color }}
      data-wrapped-ready="true"
      aria-label={`${school.name} ${sportConfig.label} season wrapped`}
    >
      <div className="wrapped-card__band" aria-hidden="true" />

      <header className="wrapped-card__head">
        <TeamLogo team={{ school_id: school.id, name: school.name, logo_url: school.logo_url }} school={school} size="xl" className="wrapped-card__logo" />
        <div className="wrapped-card__ident">
          <span className="wrapped-card__eyebrow">
            {wrapped.eyebrow} · {sportConfig.label}
          </span>
          <h1 className="wrapped-card__school">{school.name}</h1>
          {(school.mascot || wrapped.conference?.conference) && (
            <p className="wrapped-card__sub">
              {[school.mascot, wrapped.conference?.conference].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </header>

      <section className="wrapped-card__record" aria-label="Record">
        <div className="wrapped-card__stat wrapped-card__stat--lead">
          <span className="wrapped-card__num">{wrapped.overall}</span>
          <span className="wrapped-card__label">Overall</span>
          {wrapped.postseason && (
            <span className="wrapped-card__split">
              {wrapped.regular} regular · {wrapped.postseason} playoffs
            </span>
          )}
        </div>
        {wrapped.conference && (
          <div className="wrapped-card__stat">
            <span className="wrapped-card__num">{wrapped.conference.record}</span>
            <span className="wrapped-card__label">{wrapped.conference.conference}</span>
            {wrapped.conference.place && (
              <span className="wrapped-card__split">{wrapped.conference.place}</span>
            )}
          </div>
        )}
        {record.pointsFor > 0 && (
          <div className="wrapped-card__stat wrapped-card__stat--pts">
            <span className="wrapped-card__num">
              {record.pointsFor.toLocaleString("en-US")}
              <span className="wrapped-card__num-sep">–</span>
              {record.pointsAgainst.toLocaleString("en-US")}
            </span>
            <span className="wrapped-card__label">
              {labels.for} / {labels.against}
            </span>
          </div>
        )}
      </section>

      {wrapped.playoff && (
        <section className="wrapped-card__playoff" aria-label="Playoffs">
          <span className="wrapped-card__kicker">{SITE.governingBody} playoffs</span>
          <p className="wrapped-card__playoff-line">{wrapped.playoff.headline}</p>
          {wrapped.playoff.detail && (
            <span className="wrapped-card__playoff-detail">{wrapped.playoff.detail}</span>
          )}
        </section>
      )}

      <div className="wrapped-card__body">
        {wrapped.leaders.length > 0 && (
          <section className="wrapped-card__leaders" aria-label="Season leaders">
            <span className="wrapped-card__kicker">Season leaders</span>
            <ol className="wrapped-card__leader-list">
              {wrapped.leaders.map((l) => (
                <li key={l.id} className="wrapped-card__leader">
                  <span className="wrapped-card__leader-stat">{l.headline}</span>
                  <span className="wrapped-card__leader-who">
                    <span className="wrapped-card__leader-name">
                      {l.name}
                      {l.year && <span className="wrapped-card__leader-year"> {l.year}</span>}
                    </span>
                    <span className="wrapped-card__leader-cat">
                      {l.label}
                      {l.rest ? ` · ${l.rest}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {(wrapped.biggestWin || wrapped.closest) && (
          <section className="wrapped-card__games" aria-label="Notable games">
            {wrapped.biggestWin && <GameBlock kicker="Biggest win" line={wrapped.biggestWin} />}
            {wrapped.closest && <GameBlock kicker="Closest game" line={wrapped.closest} />}
          </section>
        )}
      </div>

      <footer className="wrapped-card__foot">
        <span className="wrapped-card__pub">
          <img src={`${import.meta.env.BASE_URL}${SITE.logoFile}`} alt="" className="wrapped-card__pub-logo" />
          <span className="wrapped-card__pub-text">
            <span className="wrapped-card__pub-name">{SITE.orgName}</span>
            <span className="wrapped-card__pub-title">{SITE_TITLE}</span>
          </span>
        </span>
        <span className="wrapped-card__url">{hubHost}</span>
      </footer>
    </article>
  );
}

function GameBlock({ kicker, line }) {
  return (
    <div className="wrapped-card__game">
      <span className="wrapped-card__kicker">{kicker}</span>
      <p className="wrapped-card__game-line">
        <span className={`wrapped-card__outcome wrapped-card__outcome--${line.outcome}`}>
          {line.outcome}
        </span>
        <span className="wrapped-card__game-score">{line.score}</span>
        <span className="wrapped-card__game-opp">{line.opponent}</span>
      </p>
      <span className="wrapped-card__game-meta">
        {line.date}
        {line.round ? ` · ${line.round}` : ""}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hub frame — the page a reader sees                                  */
/* ------------------------------------------------------------------ */

const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ?? `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

function HubFrame({ wrapped, school, sport, schoolId, sportConfig, format, routePath, version, children }) {
  const size = CARD_SIZE[format];
  const scale = useFitScale(size.width);
  const [shareState, setShareState] = useState("idle"); // idle | shared | copied | manual
  const pngUrl = `${DATA_BASE}/og/wrapped/${sport}/${schoolId}${format === "og" ? "-og" : ""}.png`;
  const pngReady = useImageExists(`${pngUrl}?v=${encodeURIComponent(version ?? "")}`);

  // The link shares whatever route rendered this page, so it round-trips
  // whether the hub reached it via the sport-prefixed or top-level path.
  const url = shareUrlFor(routePath);
  const title = `${school.name} ${sportConfig.label} — Season Wrapped`;
  const text = shareText(wrapped, school, sportConfig);

  useEffect(() => {
    if (shareState !== "shared" && shareState !== "copied") return;
    const id = window.setTimeout(() => setShareState("idle"), 2600);
    return () => window.clearTimeout(id);
  }, [shareState]);

  const onShare = async () => {
    // share.js's shareLink() carries title + url; the Web Share sheet also
    // takes a text line, which is where the record goes in a text message.
    let result;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        result = "shared";
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    result ??= await shareLink({ url, title });
    if (result === "dismissed") return;
    trackEvent("share", { via: result });
    setShareState(result);
  };

  const otherFormat = format === "og" ? "" : "?format=og";

  return (
    <div className="wrapped-page">
      <nav className="wrapped-page__bar" aria-label="Season Wrapped">
        <Link to={`/${sport}/team/${schoolId}`} className="wrapped-page__back">
          <span aria-hidden="true">‹</span> {school.name}
        </Link>
        <div className="wrapped-page__actions">
          <Link
            to={`${routePath}${otherFormat}`}
            className="wrapped-page__btn wrapped-page__btn--quiet"
            title={format === "og" ? "Switch to the phone (9:16) card" : "Switch to the link-preview (1200×630) card"}
          >
            {format === "og" ? "Phone size" : "Link-preview size"}
          </Link>
          <button type="button" className="wrapped-page__btn" onClick={onShare}>
            <span aria-hidden="true">↗</span>{" "}
            {shareState === "copied" ? "Link copied" : shareState === "shared" ? "Shared" : "Share"}
          </button>
          {pngReady ? (
            <a className="wrapped-page__btn wrapped-page__btn--quiet" href={pngUrl} download>
              Save image
            </a>
          ) : null}
        </div>
        <span className="sr-only" role="status">
          {shareState === "copied" ? "Link copied to clipboard" : shareState === "shared" ? "Shared" : ""}
        </span>
      </nav>

      {shareState === "manual" && (
        <p className="wrapped-page__manual">
          <label className="sr-only" htmlFor="wrapped-share-url">Link to this card</label>
          <input
            id="wrapped-share-url"
            className="wrapped-page__url"
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            autoFocus
          />
        </p>
      )}

      <div
        className="wrapped-page__stage"
        style={{
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          "--wrapped-scale": scale,
        }}
      >
        {children}
      </div>

      <p className="wrapped-page__hint">
        {pngReady
          ? "Save image downloads this card as a PNG — share it anywhere a link won't paste."
          : "On a phone, screenshot the card to share it as an image. A Save image button appears here once this card has been rendered as a PNG."}
      </p>
    </div>
  );
}

/** Scale so a 1080-wide card fits a phone, with a 16px gutter each side. */
function fitScale(cardWidth) {
  return typeof window === "undefined" ? 1 : Math.min(1, (window.innerWidth - 32) / cardWidth);
}

function useFitScale(cardWidth) {
  const [scale, setScale] = useState(() => fitScale(cardWidth));
  useEffect(() => {
    const onResize = () => setScale(fitScale(cardWidth));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [cardWidth]);
  return scale;
}

/** True once the image at `src` has loaded; false while unknown or missing. */
function useImageExists(src) {
  const [exists, setExists] = useState(false);
  useEffect(() => {
    let live = true;
    setExists(false);
    const img = new Image();
    img.onload = () => live && setExists(true);
    img.onerror = () => live && setExists(false);
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return exists;
}

/* ------------------------------------------------------------------ */
/* Loading / error — still card-sized so the generator's crop holds    */
/* ------------------------------------------------------------------ */

function CardLoading({ format }) {
  return (
    <div className={`wrapped-card wrapped-card--${format} wrapped-card--loading`}>
      <span>Loading…</span>
    </div>
  );
}

function CardError({ message, format }) {
  return (
    <div
      className={`wrapped-card wrapped-card--${format} wrapped-card--error`}
      data-wrapped-ready="true"
      data-wrapped-error="true"
    >
      <strong>Season Wrapped</strong>
      <span>{message}</span>
    </div>
  );
}
