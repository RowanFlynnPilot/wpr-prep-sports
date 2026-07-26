import { useState } from "react";
import { initials, primaryColor } from "../utils/schools.js";
import { logoOverrideFor } from "../config/logoOverrides.js";

/**
 * School logo. Falls back to a colored monogram if no image is available
 * (or the image errors out — WIAA's CDN is occasionally flaky).
 *
 * Sizes: "sm" (24), "md" (40), "lg" (64), "xl" (88).
 */
export default function TeamLogo({ team, school, size = "md", className = "" }) {
  const [errored, setErrored] = useState(false);
  // Resolution order:
  //   1. local override (e.g. the Storm crest) — so co-op teams don't
  //      inherit their host school's mark
  //   2. the game side's own WIAA logo, when rendered from a game
  //   3. the school-index entry, which indexSchools() populates from the
  //      games payload precisely so callers holding only a school_id can
  //      still show a real logo
  //
  // (3) is why views built from a synthetic team stub — the favorites
  // strip, the per-school embed — were falling through to the monogram
  // even though the logo was sitting right there on the school entry.
  const src =
    logoOverrideFor(team?.school_id || school?.id) || team?.logo_url || school?.logo_url;
  const showImage = src && !errored;

  return (
    <span
      className={`team-logo team-logo--${size} ${className}`.trim()}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          onError={() => setErrored(true)}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span
          className="team-logo__monogram"
          style={{ background: primaryColor(school) }}
        >
          {initials(team?.name ?? school?.name ?? "")}
        </span>
      )}
    </span>
  );
}
