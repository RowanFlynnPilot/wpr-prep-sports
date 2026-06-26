import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { schoolFor, primaryColor } from "../utils/schools.js";
import { useSportPrefix } from "../utils/links.js";
import { formatGameDay, formatGameDate } from "../utils/dates.js";

/**
 * Game of the Week hero — the magazine-style showcase above the dashboard
 * hero. Both teams' logos and colors, a "Presented by" lockup, and the
 * matchup/score. In-season it's the next high-stakes game; off-season it's
 * the match of the season (with the final score). Pinned above the tabs.
 */
export default function Marquee({ pick, sportConfig, sponsors, schoolIndex }) {
  const sportPrefix = useSportPrefix();
  if (!pick) return null;

  const { kind, game, eyebrow } = pick;
  const isFinal = game.status === "final";
  const awaySchool = schoolFor(game.away, schoolIndex);
  const homeSchool = schoolFor(game.home, schoolIndex);
  const awayWon = isFinal && (game.away.score ?? -1) > (game.home.score ?? -1);
  const homeWon = isFinal && (game.home.score ?? -1) > (game.away.score ?? -1);

  const dateBits = `${formatGameDay(game.date)} · ${formatGameDate(game.date)}`;
  const style = {
    "--away-color": primaryColor(awaySchool),
    "--home-color": primaryColor(homeSchool),
  };

  return (
    <Link
      to={`${sportPrefix}/game/${game.id}`}
      className="gotw"
      style={style}
      aria-label={`${eyebrow}: ${game.away.name} versus ${game.home.name}`}
      data-kind={kind}
    >
      <div className="gotw__bar" aria-hidden="true" />
      <div className="gotw__top">
        <span className="gotw__eyebrow">{eyebrow}</span>
        <Sponsor
          slot={`marquee:${sportConfig?.id ?? "default"}`}
          sponsors={sponsors}
          variant="inline"
          className="gotw__sponsor"
        />
      </div>

      <div className="gotw__teams">
        <div className={`gotw__team gotw__team--away${awayWon ? " gotw__team--won" : ""}`}>
          <TeamLogo team={game.away} school={awaySchool} size="lg" className="gotw__logo" />
          <span className="gotw__team-text">
            <span className="gotw__team-name">{game.away.name}</span>
            {awaySchool?.mascot && <span className="gotw__team-mascot">{awaySchool.mascot}</span>}
          </span>
          {isFinal && <span className="gotw__score">{game.away.score ?? "—"}</span>}
        </div>

        <span className="gotw__vs" aria-hidden="true">{isFinal ? "–" : "vs"}</span>

        <div className={`gotw__team gotw__team--home${homeWon ? " gotw__team--won" : ""}`}>
          {isFinal && <span className="gotw__score">{game.home.score ?? "—"}</span>}
          <span className="gotw__team-text">
            <span className="gotw__team-name">{game.home.name}</span>
            {homeSchool?.mascot && <span className="gotw__team-mascot">{homeSchool.mascot}</span>}
          </span>
          <TeamLogo team={game.home} school={homeSchool} size="lg" className="gotw__logo" />
        </div>
      </div>

      <div className="gotw__meta">
        <span className="gotw__when">
          {dateBits}
          {game.playoff_round && (
            <> · <span className="gotw__round">{game.playoff_round}</span></>
          )}
        </span>
        <span className="gotw__cta">
          View game <span aria-hidden="true">›</span>
        </span>
      </div>
    </Link>
  );
}
