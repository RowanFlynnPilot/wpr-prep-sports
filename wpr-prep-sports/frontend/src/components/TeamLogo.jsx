import { useState } from "react";
import { initials, primaryColor } from "../utils/schools.js";

/**
 * School logo. Falls back to a colored monogram if no image is available
 * (or the image errors out — WIAA's CDN is occasionally flaky).
 *
 * Sizes: "sm" (24), "md" (40), "lg" (64), "xl" (88).
 */
export default function TeamLogo({ team, school, size = "md", className = "" }) {
  const [errored, setErrored] = useState(false);
  const src = team?.logo_url;
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
