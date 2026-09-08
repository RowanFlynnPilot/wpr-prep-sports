import { useMemo } from "react";
import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";
import { pickPlayerOfWeek, resolveOverridePotw } from "../utils/playerOfWeek.js";
import { homeRegionSchoolIds, primaryColor } from "../utils/schools.js";
import { useSportPrefix } from "../utils/links.js";
import { displayPlayerName, playerProfileHref } from "../utils/players.js";
import { formatWeekRange } from "../utils/dates.js";

/**
 * Player of the Week — a compressed strip on paper, mirroring the
 * Marquee's shape. Was a full magazine card with a 64px avatar, a
 * stacked name/school/stat block, and a separate game-result panel
 * on the right — the last hero-shape on the pinned strip after the
 * Marquee distill, so run 9 flagged it as still competing with the
 * hero. Now: eyebrow row + one-line body with rank number, name (year,
 * position), school, stat line, and a "View player ›" CTA. The whole
 * strip is one Link to the player page; game details reach through
 * the player page's own game log.
 *
 * Renders nothing when no qualifying line exists.
 */
export default function PlayerOfWeek({ games, schoolIndex, sponsors, sportConfig, override }) {
  // Editorial radius: the auto-pick only crowns home-region athletes
  // (~60 miles of Wausau via SITE.homeRegionCities). The editor override
  // is exempt — an explicit pick is an editorial decision either way.
  const eligible = useMemo(
    () => homeRegionSchoolIds([...(schoolIndex?.values?.() ?? [])]),
    [schoolIndex],
  );
  const pick = useMemo(
    () =>
      resolveOverridePotw(override, games) ??
      pickPlayerOfWeek(games, { eligibleSchoolIds: eligible.size ? eligible : null }),
    [override, games, eligible],
  );
  const sportPrefix = useSportPrefix();
  if (!pick) return null;

  const { line, game, schoolId } = pick;
  const school = schoolIndex.get(schoolId);
  const opponent = game.home.school_id === schoolId ? game.away : game.home;
  const ownScore = game.home.school_id === schoolId ? game.home.score : game.away.score;
  const oppScore = game.home.school_id === schoolId ? game.away.score : game.home.score;
  const tied = ownScore != null && oppScore != null && ownScore === oppScore;
  const won = !tied && (ownScore ?? -1) > (oppScore ?? -1);
  const isHome = game.home.school_id === schoolId;
  // Which week this is — the Monday cadence can hold a pick into the
  // following weekend; an unlabeled card then reads as stale.
  const weekLabel = pick.weekStart ? formatWeekRange(pick.weekStart) : null;

  const schoolColor = school ? primaryColor(school) : null;
  const style = schoolColor ? { "--school-color": schoolColor } : undefined;
  // Editor-supplied headline wins; otherwise format the algorithmic stat line.
  const formatted =
    line.headline
    ?? sportConfig?.stats?.gameLine?.format?.(line, { tone: "default" })
    ?? null;

  const playerHref = playerProfileHref(sportPrefix, schoolId, line.player_name);
  const resultLabel = won ? "W" : tied ? "T" : "L";
  const resultCls = won ? "potw__result--won" : tied ? "potw__result--tie" : "potw__result--loss";

  return (
    <section className="potw" aria-label="Player of the Week" style={style}>
      {/* School-color rail — identity, not decoration. Same pattern the
          team hero and standings use. */}
      <div className="potw__bar" aria-hidden="true" />

      <header className="potw__masthead">
        <span className="potw__eyebrow">
          Player of the Week
          {weekLabel && <span className="potw__eyebrow-week"> · Week of {weekLabel}</span>}
        </span>
        <Sponsor slot="potw" sponsors={sponsors} variant="inline" className="potw__sponsor" />
      </header>

      <div className="potw__row">
        <Link
          to={playerHref}
          className="potw__name"
          onClick={(e) => e.stopPropagation()}
        >
          {displayPlayerName(line.player_name)}
          {line.player_year && (
            <span className="potw__year"> ({line.player_year})</span>
          )}
        </Link>
        {line.position && (
          <span className="potw__pos" aria-hidden="true">
            {line.position}
          </span>
        )}
        <Link
          to={`${sportPrefix}/team/${schoolId}`}
          className="potw__school"
          onClick={(e) => e.stopPropagation()}
        >
          {school?.name ?? schoolId}
        </Link>
        {formatted && <span className="potw__line">{formatted}</span>}
        <Link
          to={`${sportPrefix}/game/${game.id}`}
          className={`potw__result ${resultCls}`.trim()}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Game result: ${resultLabel} ${ownScore}-${oppScore} ${isHome ? "at home vs" : "at"} ${opponent.name}`}
        >
          <span className="potw__result-mark">{resultLabel}</span>{" "}
          <span className="potw__result-score">{ownScore}-{oppScore}</span>
          <span className="potw__result-opp">
            {" "}{isHome ? "vs" : "at"} {opponent.name}
          </span>
        </Link>
        <Link to={playerHref} className="potw__cta">
          Full stats <span aria-hidden="true">›</span>
        </Link>
      </div>
    </section>
  );
}
