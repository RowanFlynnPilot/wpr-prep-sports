import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";
import { useSportPrefix } from "../utils/links.js";
import { formatGameDay, formatGameDate } from "../utils/dates.js";

/**
 * Slim editorial banner above the dashboard hero. Single marquee game
 * (Game of the Week in-season, Match of the Season off-season) with a
 * sport-specific sponsor slot. Designed to add an obvious premium
 * placement above the fold without competing with the hero card.
 */
export default function Marquee({ pick, sportConfig, sponsors }) {
  const sportPrefix = useSportPrefix();
  if (!pick) return null;

  const { kind, game, eyebrow, headline } = pick;
  const dateBits = `${formatGameDay(game.date)} · ${formatGameDate(game.date)}`;

  return (
    <Link
      to={`${sportPrefix}/game/${game.id}`}
      className="marquee"
      aria-label={`${eyebrow}: ${headline}`}
    >
      <div className="marquee__inner">
        <div className="marquee__primary">
          <span className="marquee__eyebrow">{eyebrow}</span>
          <span className="marquee__headline">{headline}</span>
          <span className="marquee__meta">
            {dateBits}
            {game.playoff_round && (
              <>
                {" "}
                · <span className="marquee__round">{game.playoff_round}</span>
              </>
            )}
          </span>
        </div>
        <Sponsor
          slot={`marquee:${sportConfig?.id ?? "default"}`}
          sponsors={sponsors}
          variant="inline"
          className="marquee__sponsor"
        />
        <span aria-hidden="true" className="marquee__chevron">›</span>
      </div>
      {/* Reference kind so the linter doesn't grumble — kind is reserved
          for future per-kind styling (e.g. live game indicator). */}
      <span className="marquee__kind-marker" data-kind={kind} hidden />
    </Link>
  );
}
