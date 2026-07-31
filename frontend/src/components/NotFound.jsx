import { Link } from "react-router-dom";
import Layout from "./Layout.jsx";
import { archiveLocationForGame, selectedSeason } from "../utils/season.js";

const LABELS = {
  game: "game",
  team: "team",
  player: "player",
};

/**
 * Shown when a deep link points at something the current dataset doesn't
 * hold — most often a link shared during a season that has since rolled
 * over into data/archive/.
 *
 * Replaces a silent <Navigate> to the sport dashboard. The redirect wasn't
 * broken, but a reader who followed a link to their kid's game and landed
 * on today's front page has no way to tell whether the link was wrong, the
 * site was, or the game was never covered. Say which it is.
 *
 * For games we can do better than apologise: the id carries its own date,
 * so if it belongs to a season we archived, link straight to it there.
 *
 * Renders inside Layout deliberately. The pages this replaces returned a
 * bare <Navigate>, so the chrome came from wherever the reader was sent;
 * returning a naked card instead would strand them on a blank page with no
 * masthead, no sport switcher and no footer — a worse landing than the
 * silent redirect it improves on.
 */
export default function NotFound({ kind = "game", sportPrefix, id, sponsors }) {
  const label = LABELS[kind] ?? "page";
  // A miss on a known route shape ("that game") usually means an archived
  // season; a miss on the route itself means a bad address — "isn't in the
  // current season" would be the wrong diagnosis to offer for a typo.
  const isEntity = kind in LABELS;
  // Don't offer the archive we're already viewing — if the game isn't in
  // that dataset either, the offer is a link straight back to this page.
  const located = kind === "game" && id ? archiveLocationForGame(id, sportPrefix) : null;
  const archive = located && located.season !== selectedSeason() ? located : null;

  return (
    <Layout sponsors={sponsors}>
      <section className="not-found" aria-labelledby="not-found-title">
        {/* h1, not h2: this is the page's own title. Every other view has
            exactly one h1 (the dashboards carry an sr-only one), and a page
            with none breaks a screen reader's heading walk. */}
        <h1 className="not-found__title" id="not-found-title">
          {isEntity ? <>That {label} isn&rsquo;t in the current season</> : <>That page doesn&rsquo;t exist</>}
        </h1>
        <p className="not-found__body">
          {archive ? (
            <>
              It looks like it&rsquo;s from the {archive.season} season, which is kept
              in the archive.
            </>
          ) : isEntity ? (
            <>
              The link may be from an earlier season, or point to a {label} this site
              doesn&rsquo;t cover.
            </>
          ) : (
            <>The address may be mistyped, or the link it came from is out of date.</>
          )}
        </p>
        <p className="not-found__actions">
          {archive && (
            <a className="not-found__primary" href={archive.href}>
              View it in the {archive.season} archive →
            </a>
          )}
          <Link className="not-found__back" to={sportPrefix}>
            Back to scores
          </Link>
        </p>
      </section>
    </Layout>
  );
}
