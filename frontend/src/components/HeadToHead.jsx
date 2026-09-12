import { useEffect, useMemo, useState } from "react";
import Sponsor from "./Sponsor.jsx";
import { fetchHistory } from "../data/fetchDataset.js";
import { formatGameDate } from "../utils/dates.js";
import { isForfeitScore } from "../utils/games.js";

const SHOWN = 5;

/**
 * Head-to-head history between the two teams on a game page, sourced
 * from archived seasons (data/history/<sport>.json). Complements
 * GamePreview's same-season "last meeting": this is the multi-season
 * series — "Edgar leads the all-time series 3-1" — and it renders for
 * scheduled AND final games. Archived meetings have no live game route,
 * so rows are plain (not links).
 */
export default function HeadToHead({ game, dataset, schoolIndex }) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchHistory(dataset.sport, dataset.meta?.last_updated).then((h) => {
      if (!cancelled) setHistory(h);
    });
    return () => {
      cancelled = true;
    };
  }, [dataset.sport, dataset.meta?.last_updated]);

  const meetings = useMemo(() => {
    if (!history?.matchups || !game) return [];
    const key = [sideKey(game.home), sideKey(game.away)].sort().join("|");
    // The current dataset's season may itself be archived (off-season),
    // so this exact game can appear in its own history — drop it.
    return (history.matchups[key] ?? []).filter((m) => m.id !== game.id);
  }, [history, game]);

  const series = useMemo(() => {
    if (!game) return null;
    const homeKey = sideKey(game.home);
    let homeWins = 0;
    let awayWins = 0;
    // The current game counts once it's final — otherwise the line reads
    // "Tomahawk leads 1-0" directly under a Wausau East win.
    const thisFinal =
      game.status === "final" && game.home.score != null && game.away.score != null;
    const counted = thisFinal ? [...meetings, game] : meetings;
    for (const m of counted) {
      const winner = winnerKey(m);
      if (winner === null) continue;
      if (winner === homeKey) homeWins++;
      else awayWins++;
    }
    // The series record includes this game once it's final; the hint says
    // so explicitly, and the headline count describes only the listed
    // rows — "4 meetings on record" over three visible rows read as a
    // data error (critique run 12).
    return { homeWins, awayWins, includesThis: thisFinal };
  }, [meetings, game]);

  if (meetings.length === 0) return null;

  const seriesLine =
    series.homeWins === series.awayWins
      ? `Series tied ${series.homeWins}-${series.awayWins}`
      : series.homeWins > series.awayWins
        ? `${game.home.name} leads ${series.homeWins}-${series.awayWins}`
        : `${game.away.name} leads ${series.awayWins}-${series.homeWins}`;

  return (
    <section className="h2h" aria-label="Head-to-head history">
      <div className="section-header">
        <h2>Head-to-Head</h2>
        <span className="section-header__hint">
          {meetings.length} previous meeting{meetings.length === 1 ? "" : "s"} ·{" "}
          {seriesLine}
          {series.includesThis ? " incl. this game" : ""}
        </span>
      </div>

      <ol className="h2h__list">
        {meetings.slice(0, SHOWN).map((m) => (
          <MeetingRow
            key={m.id ?? m.date}
            meeting={m}
            sport={dataset.sport}
            schoolIndex={schoolIndex}
          />
        ))}
      </ol>
      {meetings.length > SHOWN && (
        <p className="h2h__more">
          Showing the last {SHOWN} of {meetings.length} meetings.
        </p>
      )}

      {/* After the rows, not between the heading and its first row: a
          sponsor at the section boundary is inventory, one inside the
          section is an interruption (critique run 12). */}
      <Sponsor
        slot="rivalry"
        sponsors={dataset.sponsors}
        variant="inline"
        className="h2h__sponsor"
      />
    </section>
  );
}

function MeetingRow({ meeting, sport, schoolIndex }) {
  const homeWon = (meeting.home.score ?? -1) > (meeting.away.score ?? -1);
  const awayWon = (meeting.away.score ?? -1) > (meeting.home.score ?? -1);
  // History rows are keyed by sport at the file level and don't carry it.
  const forfeit = isForfeitScore({ ...meeting, sport });
  // Archived rows keep WIAA's name ("Stevens Point"); the manifest's display
  // name ("SPASH") is what the scorebug above prints for the same school.
  const displayName = (side) => schoolIndex?.get?.(side.school_id)?.name ?? side.name;
  return (
    <li className="h2h__row">
      <span className="h2h__when">
        <span className="h2h__season">{meeting.season}</span>
        <span className="h2h__date">{formatGameDate(meeting.date)}</span>
      </span>
      <span className="h2h__score">
        <span className={"h2h__team" + (awayWon ? " h2h__team--won" : "")}>
          {displayName(meeting.away)}
          {!forfeit && ` ${meeting.away.score}`}
        </span>
        <span className="h2h__at">at</span>
        <span className={"h2h__team" + (homeWon ? " h2h__team--won" : "")}>
          {displayName(meeting.home)}
          {!forfeit && ` ${meeting.home.score}`}
        </span>
        {forfeit && <span className="h2h__at">· forfeit</span>}
      </span>
      {meeting.playoff && (
        <span className="h2h__playoff">
          {meeting.playoff_round ?? "Playoffs"}
        </span>
      )}
    </li>
  );
}

// Mirrors side_key() in scraper/scripts/build_history.py — keep in sync.
function sideKey(side) {
  return (
    side.school_id || `name:${(side.name ?? "").trim().replace(/\s+/g, " ").toLowerCase()}`
  );
}

function winnerKey(meeting) {
  const h = meeting.home.score ?? null;
  const a = meeting.away.score ?? null;
  if (h === null || a === null || h === a) return null;
  return h > a ? sideKey(meeting.home) : sideKey(meeting.away);
}
