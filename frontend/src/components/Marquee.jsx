import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { schoolFor, primaryColor } from "../utils/schools.js";
import { useSportPrefix } from "../utils/links.js";
import { formatGameDay, formatGameDate } from "../utils/dates.js";

/**
 * Game of the Week — a compressed marquee strip on paper, under the
 * black hero lead. Two schools' colors carry it: a split top bar
 * (away | home) and small colored logo rings; the matchup runs on one
 * line with a right-aligned "View preview ›" CTA. The pre-distill
 * version was a full magazine card with big logos, big score numerals,
 * and a mascot subhead — a second hero shape competing with the hero.
 * Three critiques in a row flagged the dashboard's pinned strip as
 * three-of-the-same; compressing this to a strip differentiates it
 * from the hero and from Player of the Week without hiding the game.
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
      <div className="gotw__inner">
        <span className="gotw__eyebrow">{eyebrow}</span>

        <span className="gotw__matchup">
          <TeamLogo
            team={game.away}
            school={awaySchool}
            size="xs"
            className="gotw__logo gotw__logo--away"
          />
          <span className={"gotw__name" + (awayWon ? " gotw__name--won" : "")}>
            {game.away.name}
            {isFinal && (
              <span className="gotw__score">
                {" "}
                {game.away.score ?? "—"}
              </span>
            )}
          </span>
          <span className="gotw__vs" aria-hidden="true">
            {isFinal ? "–" : "at"}
          </span>
          <TeamLogo
            team={game.home}
            school={homeSchool}
            size="xs"
            className="gotw__logo gotw__logo--home"
          />
          <span className={"gotw__name" + (homeWon ? " gotw__name--won" : "")}>
            {game.home.name}
            {isFinal && (
              <span className="gotw__score">
                {" "}
                {game.home.score ?? "—"}
              </span>
            )}
          </span>
        </span>

        <span className="gotw__when">
          {dateBits}
          {game.playoff_round && (
            <> · <span className="gotw__round">{game.playoff_round}</span></>
          )}
        </span>

        <Sponsor
          slot={`marquee:${sportConfig?.id ?? "default"}`}
          sponsors={sponsors}
          variant="inline"
          className="gotw__sponsor"
        />

        <span className="gotw__cta">
          {/* Distinct from the Hero's "View preview ›" one row above —
              two adjacent CTAs saying the same thing read as the same
              link and made the reader hesitate. Marquee is about the
              matchup framing (a picked game of the week); Hero is
              about the game itself. */}
          See the matchup <span aria-hidden="true">›</span>
        </span>
      </div>
    </Link>
  );
}
