import { useMemo } from "react";
import { useParams } from "react-router-dom";
import TeamLogo from "../components/TeamLogo.jsx";
import Sponsor from "../components/Sponsor.jsx";
import { formatGameDate } from "../utils/dates.js";
import { SITE, SITE_TITLE } from "../config/site.js";

/**
 * Conference embed — a compact, chrome-free scores + standings module
 * for one OR SEVERAL conferences, for publisher article bodies and
 * sidebars:
 *
 *   <iframe src=".../#/football/embed/conference/wisconsin-valley" ...>
 *   <iframe src=".../#/football/embed/conference/wisconsin-valley+great-northern" ...>
 *
 * Conference segments are slugified conference names as they appear in
 * standings.json, joined with "+" for the multi-conference form (the
 * WPR football audience spans Wisconsin Valley AND Great Northern —
 * Wausau East's football home — so the combined module is the natural
 * article unit). Latest scores pool every listed conference's teams;
 * each conference renders its own standings table carrying its own
 * `standings:<conference>` sponsor slot, so the module doubles as
 * fulfillment inventory for the per-conference sale. Like the
 * per-school module: no masthead, links open a new tab, every
 * placement funnels back into the full widget.
 */
const FULL_WIDGET_URL = SITE.widgetOrigin;

// Latest-scores window: long enough that a Tuesday story still shows
// Friday's slate, short enough to stay "latest".
const SCORES_WINDOW_DAYS = 8;

function confSlugOf(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function fmtRecord(wins, losses, ties) {
  const t = ties ?? 0;
  return t > 0 ? `${wins}-${losses}-${t}` : `${wins}-${losses}`;
}

export default function ConferenceEmbedPage({ dataset, schoolIndex, sportConfig }) {
  const { confSlug } = useParams();

  const tables = useMemo(() => {
    const slugs = (confSlug ?? "").split("+").filter(Boolean);
    const all = dataset.standings ?? [];
    return slugs
      .map((slug) => all.find((s) => confSlugOf(s.conference) === slug))
      .filter(Boolean);
  }, [dataset.standings, confSlug]);

  const memberIds = useMemo(() => {
    const ids = new Set();
    for (const t of tables) {
      for (const r of t.rows ?? []) {
        if (r.school_id) ids.add(r.school_id);
      }
    }
    return ids;
  }, [tables]);

  const recentFinals = useMemo(() => {
    if (memberIds.size === 0) return [];
    const cutoff = Date.now() - SCORES_WINDOW_DAYS * 86_400_000;
    const maxRows = tables.length > 1 ? 12 : 8;
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
      .slice(0, maxRows);
  }, [dataset.games, memberIds, tables.length]);

  if (tables.length === 0) {
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
  const single = tables.length === 1;
  const title = tables.map((t) => t.conference).join(" · ");

  return (
    <div className="embed embed--conference" data-conference={confSlug}>
      <header className="embed__header embed__header--conf">
        <div className="embed__title">
          <h1>{title}</h1>
          <p>
            {sportConfig.label}
            {dataset.meta?.season ? ` · ${dataset.meta.season}` : ""}
          </p>
        </div>
        {single && (
          <Sponsor
            slot={`standings:${tables[0].conference}`}
            sponsors={dataset.sponsors}
            variant="inline"
            className="embed__sponsor"
          />
        )}
      </header>

      {recentFinals.length > 0 && (
        <section aria-label="Latest scores" className="embed-conf__scores">
          <h2 className="embed-conf__heading">Latest scores</h2>
          {recentFinals.map((g) => (
            <ScoreRow key={g.id} game={g} schoolIndex={schoolIndex} />
          ))}
        </section>
      )}

      {tables.map((standing) => (
        <section
          key={standing.conference}
          aria-label={`${standing.conference} standings`}
          className="embed-conf__standings"
        >
          <div className="embed-conf__standings-head">
            <h2 className="embed-conf__heading">
              {single ? "Standings" : `${standing.conference} standings`}
            </h2>
            {!single && (
              <Sponsor
                slot={`standings:${standing.conference}`}
                sponsors={dataset.sponsors}
                variant="inline"
                className="embed__sponsor"
              />
            )}
          </div>
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
      ))}

      <footer className="embed__footer">
        <a href={hubUrl} target="_blank" rel="noopener noreferrer">
          Full {sportConfig.shortLabel ?? sportConfig.label} coverage →
        </a>
        <span className="embed__credit">{SITE.orgName}</span>
      </footer>
    </div>
  );
}

function ScoreRow({ game, schoolIndex }) {
  const gameUrl = `${FULL_WIDGET_URL}#/${game.sport}/game/${game.id}`;
  const homeWon = game.home.score > game.away.score;
  const awayWon = game.away.score > game.home.score;
  const awaySchool = game.away.school_id ? schoolIndex?.get?.(game.away.school_id) : null;
  const homeSchool = game.home.school_id ? schoolIndex?.get?.(game.home.school_id) : null;
  return (
    <a className="embed-conf__score" href={gameUrl} target="_blank" rel="noopener noreferrer">
      <span className="embed-conf__score-date">{formatGameDate(game.date)}</span>
      <span className="embed-conf__score-line">
        <span className={`embed-conf__side ${awayWon ? "embed-conf__winner" : ""}`}>
          <TeamLogo team={game.away} school={awaySchool} size="xs" />
          {game.away.name} {game.away.score}
        </span>
        <span className="embed-conf__at">at</span>
        <span className={`embed-conf__side ${homeWon ? "embed-conf__winner" : ""}`}>
          <TeamLogo team={game.home} school={homeSchool} size="xs" />
          {game.home.name} {game.home.score}
        </span>
        {game.conference_game && <span className="embed-conf__tag">conf</span>}
      </span>
    </a>
  );
}
