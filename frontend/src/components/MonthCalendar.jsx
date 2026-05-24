import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  MONTH_NAMES,
  WEEKDAY_SHORT,
  buildMonthGrid,
  groupGamesByDate,
  pickFocusMonth,
} from "../utils/calendar.js";
import { useSportPrefix } from "../utils/links.js";

/**
 * Month-at-a-glance calendar. Each cell shows the day number and a count
 * of games; the cell becomes clickable when there are games, opening a
 * day-detail panel below the grid.
 *
 * Anchors to the current month if it has games (in-season case) and to
 * the most-recent month with games otherwise (off-season fallback so
 * the section is never empty).
 */
export default function MonthCalendar({ games, schoolIndex, sportConfig }) {
  const initial = useMemo(() => pickFocusMonth(games), [games]);
  const [focus, setFocus] = useState(initial);
  const [selectedDay, setSelectedDay] = useState(null);

  const gamesByDate = useMemo(() => groupGamesByDate(games), [games]);
  const cells = useMemo(
    () => buildMonthGrid(focus.year, focus.month),
    [focus.year, focus.month],
  );

  const monthLabel = `${MONTH_NAMES[focus.month]} ${focus.year}`;

  const step = (direction) => {
    setFocus(({ year, month }) => {
      const m = month + direction;
      if (m < 0) return { year: year - 1, month: 11 };
      if (m > 11) return { year: year + 1, month: 0 };
      return { year, month: m };
    });
    setSelectedDay(null);
  };

  const selectedGames = selectedDay ? gamesByDate.get(selectedDay) ?? [] : [];

  return (
    <div className="month-cal">
      <header className="month-cal__header">
        <button
          type="button"
          className="month-cal__nav"
          onClick={() => step(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <h3 className="month-cal__title">{monthLabel}</h3>
        <button
          type="button"
          className="month-cal__nav"
          onClick={() => step(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </header>

      <div className="month-cal__weekdays" aria-hidden="true">
        {WEEKDAY_SHORT.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div className="month-cal__grid" role="grid">
        {cells.map((cell) => {
          const dayGames = gamesByDate.get(cell.iso) ?? [];
          const count = dayGames.length;
          const isSelected = selectedDay === cell.iso;
          const isClickable = count > 0;
          const className = [
            "month-cal__cell",
            cell.inMonth ? "" : "month-cal__cell--out",
            cell.isToday ? "month-cal__cell--today" : "",
            isClickable ? "month-cal__cell--has-games" : "",
            isSelected ? "month-cal__cell--selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={cell.iso}
              className={className}
              onClick={() => isClickable && setSelectedDay(cell.iso)}
              disabled={!isClickable}
              aria-pressed={isSelected}
              aria-label={`${cell.iso}${count ? ` — ${count} game${count === 1 ? "" : "s"}` : ""}`}
            >
              <span className="month-cal__day-num">{cell.date.getDate()}</span>
              {count > 0 && (
                <span className="month-cal__count">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDay && selectedGames.length > 0 && (
        <DaySheet
          dateIso={selectedDay}
          games={selectedGames}
          schoolIndex={schoolIndex}
          sportConfig={sportConfig}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

function DaySheet({ dateIso, games, schoolIndex, onClose }) {
  const sportPrefix = useSportPrefix();
  const dateLabel = new Date(dateIso + "T12:00:00").toLocaleDateString(
    undefined,
    { weekday: "long", month: "long", day: "numeric" },
  );

  return (
    <div className="month-cal__sheet" role="region" aria-label={`Games on ${dateLabel}`}>
      <div className="month-cal__sheet-header">
        <h4>{dateLabel}</h4>
        <button
          type="button"
          className="month-cal__sheet-close"
          onClick={onClose}
          aria-label="Close day details"
        >
          ×
        </button>
      </div>
      <ul className="month-cal__sheet-list">
        {games.map((g) => (
          <li key={g.id} className="month-cal__sheet-game">
            <Link to={`${sportPrefix}/game/${g.id}`} className="month-cal__sheet-link">
              <span className="month-cal__sheet-matchup">
                {g.away.name} <span className="month-cal__sheet-sep">@</span> {g.home.name}
              </span>
              <span className="month-cal__sheet-result">
                {g.status === "final"
                  ? `${g.away.score}-${g.home.score}`
                  : g.status === "in_progress"
                  ? "Live"
                  : timeFor(g.date)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function timeFor(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
