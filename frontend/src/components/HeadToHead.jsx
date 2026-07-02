import { useEffect, useMemo, useState } from "react";
import Sponsor from "./Sponsor.jsx";
import { fetchHistory } from "../data/fetchDataset.js";
import { formatGameDate } from "../utils/dates.js";

const SHOWN = 5;

/**
 * Head-to-head history between the two teams on a game page, sourced
 * from archived seasons (data/history/<sport>.json). Complements
 * GamePreview's same-season "last meeting": this is the multi-season
 * series — "Edgar leads the all-time series 3-1" — and it renders for
 * scheduled AND final games. Archived meetings have no live game route,
 * so rows are plain (not links).
 */
export default function HeadToHead({ game, dataset }) {
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
    for (const m of meetings) {
      const winner = winnerKey(m);
      if (winner === null) continue;
      if (winner === homeKey) homeWins++;
      else awayWins++;
    }
    return { homeWins, awayWins };
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
          {meetings.length} meeting{meetings.length === 1 ? "" : "s"} on
          record · {seriesLine}
        </span>
      </div>

      <Sponsor
        slot="rivalry"
        sponsors={dataset.sponsors}
        variant="inline"
        className="h2h__sponsor"
      />

      <ol className="h2h__list">
        {meetings.slice(0, SHOWN).map((m) => (
          <MeetingRow key={m.id ?? m.date} meeting={m} />
        ))}
      </ol>
      {meetings.length > SHOWN && (
        <p className="h2h__more">
          Showing the last {SHOWN} of {meetings.length} meetings.
        </p>
      )}
    </section>
  );
}

function MeetingRow({ meeting }) {
  const homeWon = (meeting.home.score ?? -1) > (meeting.away.score ?? -1);
  const awayWon = (meeting.away.score ?? -1) > (meeting.home.score ?? -1);
  return (
    <li className="h2h__row">
      <span className="h2h__when">
        <span className="h2h__season">{meeting.season}</span>
        <span className="h2h__date">{formatGameDate(meeting.date)}</span>
      </span>
      <span className="h2h__score">
        <span className={"h2h__team" + (awayWon ? " h2h__team--won" : "")}>
          {meeting.away.name} {meeting.away.score}
        </span>
        <span className="h2h__at">at</span>
        <span className={"h2h__team" + (homeWon ? " h2h__team--won" : "")}>
          {meeting.home.name} {meeting.home.score}
        </span>
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
