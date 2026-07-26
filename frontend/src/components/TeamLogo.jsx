import { useEffect, useMemo, useState } from "react";
import { initials, primaryColor } from "../utils/schools.js";
import { logoOverrideFor, mirroredLogoFor } from "../config/logoOverrides.js";

/**
 * School logo, with a colored monogram as the last resort.
 *
 * Sources are tried in order, stepping to the next one if an image fails to
 * load, so no single source going down costs us the logo:
 *
 *   1. hand-made override (the Storm crest) — co-op teams must not inherit
 *      their host school's mark
 *   2. the locally mirrored WIAA logo — same-origin off the Pages CDN,
 *      which is why a dashboard no longer fires ~125 cross-origin image
 *      requests at schools.wiaawi.org (scripts/mirror_logos.py)
 *   3. the live WIAA URL from the game side, for anything not yet mirrored
 *   4. the school-index entry, which indexSchools() populates from the
 *      games payload so callers holding only a school_id still get a logo
 *
 * (4) is why views built from a synthetic team stub — the favorites strip,
 * the per-school embed — used to fall through to the monogram even though
 * the logo was sitting right there on the school entry.
 *
 * Sizes: "sm" (24), "md" (40), "lg" (64), "xl" (88).
 */
export default function TeamLogo({ team, school, size = "md", className = "" }) {
  const schoolId = team?.school_id || school?.id;

  const sources = useMemo(() => {
    const candidates = [
      logoOverrideFor(schoolId),
      mirroredLogoFor(schoolId),
      team?.logo_url,
      school?.logo_url,
    ].filter(Boolean);
    return [...new Set(candidates)];
  }, [schoolId, team?.logo_url, school?.logo_url]);

  const [attempt, setAttempt] = useState(0);
  // React reuses component instances across list re-renders, so reset when
  // the candidate list changes or a recycled row keeps a stale failure.
  useEffect(() => setAttempt(0), [sources.join("|")]);

  const src = sources[attempt];

  return (
    <span
      className={`team-logo team-logo--${size} ${className}`.trim()}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          onError={() => setAttempt((i) => i + 1)}
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
