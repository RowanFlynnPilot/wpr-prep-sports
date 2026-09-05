import { useMemo } from "react";
import { useParams } from "react-router-dom";
import TeamLogo from "../components/TeamLogo.jsx";
import Sponsor from "../components/Sponsor.jsx";
import { formatGameDate } from "../utils/dates.js";
import { SITE, SITE_TITLE } from "../config/site.js";

/**
 * Conference embed — a compact, chrome-free scores + standings module
 * for one conference, for publisher article bodies and sidebars:
 *
 *   <iframe src=".../#/football/embed/conference/wisconsin-valley" ...>
 *
 * The conference segment is the slugified conference name as it appears
 * in standings.json. Carries the same per-conference sponsor slot the
 * main standings tables use (`standings:<conference>`), so the module
 * doubles as fulfillment inventory for the per-conference sale. Like
 * the per-school module: no masthead, links open a new tab, every
 * placement funnels back into the full widget.
 */
const FULL_WIDGET_URL = SITE.widgetOrigin;

// Latest-scores window: long enough that a Tuesday story still shows
// Friday's slate, short enough to stay "latest".
const SCORES_WINDOW_DAYS = 8;
const MAX_SCORE_ROWS = 8;

function confSlugOf(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function fmtRecord(wins, losses, ties) {
  const t = ties ?? 0;
  return t > 0 ? `${wins}-${losses}-${t}` : `${wins}-${losses}`;
}

export default function ConferenceEmbedPage({ dataset, schoolIndex, sportConfig }) {
  const { confSlug } = useParams();

  const standing = useMemo(
    () => (dataset.standings ?? []).find((s) => confSlugOf(s.conference) === confSlug) ?? null,
    [dataset.standings, confSlug],
  );

  const memberIds = useMemo(
    () => new Set((standing?.rows ?? []).map((r) => r.school_id).filter(Boolean)),
    [standing],
  );

  const recentFinals = useMemo(() => {
    if (memberIds.size === 0) return [];
    const cutoff = Date.now() - SCORES_WINDOW_DAYS * 86_400_000;
    return (dataset.games ?? [])
      .filter(
        (g) =>
          g.status === "final" &&
          g.home.score != null &&
          g.away.score != null &&
          new Date(g.date).getTime() >= cutoff &&
          new Date(g.date).getTime() <= Date.now() &&
          (memberIds.has(g.home.school_id) || memberIds.has(g.away.school_id)),
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, MAX_SCORE_ROWS);
  }, [dataset.games, memberIds]);

  if (!standing) {
    return (
      <div className="embed embed--unknown">
        <p>
          Conference not found.{" "}
          <a href={FULL_WIDGET_URL} target="_blank" rel="noopener noreferrer">
            {SITE_TITLE} →
          </a>
        </p>
      </div>
    );
  }

  const hubUrl = `${FULL_WIDGET_URL}#/${dataset.sport}`;

  return (
    <div className="embed embed--conference" data-conference={confSlug}>
      <header className="embed__header embed__header--conf">
        <div className="embed__title">
          <h1>{standing.conference}</h1>
          <p>
            {sportConfig.label}
            {dataset.meta?.season ? ` · ${dataset.meta.season}` : ""}
          </p>
        </div>
        <Sponsor
          slot={`standings:${standing.conference}`}
          sponsors={dataset.sponsors}
          variant="inline"
          className="embed__sponsor"
        />
      </header>

      {recentFinals.length > 0 && (
        <section aria-label="Latest scores" className="embed-conf__scores">
          <h2 className="embed-conf__heading">Latest scores</h2>
          {recentFinals.map((g) => (
            <ScoreRow key={g.id} game={g} />
          ))}
        </section>
      )}

      <section aria-label="Standings" className="embed-conf__standings">
        <h2 className="embed-conf__heading">Standings</h2>
        <table>
          <thead>
            <tr>
              <th className="num" aria-label="Rank">#</th>
              <th>Team</th>
              <th className="num">Conf</th>
              <th className="num">Overall</th>
            </tr>
          </thead>
          <tbody>
            {standing.rows.map((row, i) => {
              const school = schoolIndex?.get?.(row.school_id);
              return (
                <tr key={row.school_id}>
                  <td className="num embed-conf__rank">{i + 1}</td>
                  <td className="embed-conf__team">
                    <TeamLogo
                      team={{ school_id: row.school_id, name: row.name }}
                      school={school}
                      size="sm"
                    />
                    <a
                      href={`${FULL_WIDGET_URL}#/${dataset.sport}/team/${row.school_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.name}
                    </a>
                  </td>
                  <td className="num">
                    {fmtRecord(row.conference_wins, row.conference_losses, row.conference_ties)}
                  </td>
                  <td className="num">
                    {fmtRecord(row.overall_wins, row.overall_losses, row.overall_ties)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <footer className="embed__footer">
        <a href={hubUrl} target="_blank" rel="noopener noreferrer">
          Full {sportConfig.shortLabel ?? sportConfig.label} coverage →
        </a>
        <span className="embed__credit">{SITE.orgName}</span>
      </footer>
    </div>
  );
}

function ScoreRow({ game }) {
  const gameUrl = `${FULL_WIDGET_URL}#/${game.sport}/game/${game.id}`;
  const homeWon = game.home.score > game.away.score;
  const awayWon = game.away.score > game.home.score;
  return (
    <a className="embed-conf__score" href={gameUrl} target="_blank" rel="noopener noreferrer">
      <span className="embed-conf__score-date">{formatGameDate(game.date)}</span>
      <span className="embed-conf__score-line">
        <span className={awayWon ? "embed-conf__winner" : undefined}>
          {game.away.name} {game.away.score}
        </span>
        {" at "}
        <span className={homeWon ? "embed-conf__winner" : undefined}>
          {game.home.name} {game.home.score}
        </span>
        {game.conference_game && <span className="embed-conf__tag">conf</span>}
      </span>
    </a>
  );
}
