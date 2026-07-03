import { useMemo } from "react";
import { Link } from "react-router-dom";
import Sponsor from "./Sponsor.jsx";
import { initials, primaryColor } from "../utils/schools.js";
import { useSportPrefix } from "../utils/links.js";

const SHOWN = 3;

/**
 * Senior Spotlights — editor-curated senior profiles from
 * data/spotlights.json (see docs/spotlights.md for the editor
 * workflow). Mirrors the PotW override pattern: pure config, no code
 * changes to publish one. Renders nothing when no active entries match
 * this sport, so quiet stretches don't show an empty card.
 */
export default function SeniorSpotlight({ spotlights, schoolIndex, sponsors, sportId }) {
  const active = useMemo(() => {
    const now = Date.now();
    return (spotlights ?? [])
      .filter((s) => s?.name && s?.school_id)
      .filter((s) => !s.sport || s.sport === sportId)
      .filter((s) => {
        if (!s.expires_at) return true;
        const ts = Date.parse(s.expires_at);
        return Number.isNaN(ts) || ts > now;
      })
      .sort(
        (a, b) =>
          (Date.parse(b.published_at ?? 0) || 0) -
          (Date.parse(a.published_at ?? 0) || 0),
      );
  }, [spotlights, sportId]);

  const sportPrefix = useSportPrefix();
  if (active.length === 0) return null;

  return (
    <section className="spotlight-sr" aria-label="Senior Spotlight">
      <div className="section-header">
        <h2>Senior Spotlight</h2>
        <Sponsor
          slot="spotlight:senior"
          sponsors={sponsors}
          variant="inline"
        />
      </div>

      <div className="spotlight-sr__grid">
        {active.slice(0, SHOWN).map((s) => {
          const school = schoolIndex?.get?.(s.school_id);
          const color = school ? primaryColor(school) : null;
          return (
            <article
              key={`${s.school_id}:${s.name}`}
              className="spotlight-sr__card"
              style={color ? { "--school-color": color } : undefined}
            >
              <div className="spotlight-sr__avatar" aria-hidden="true">
                {s.photo_url ? (
                  <img src={s.photo_url} alt="" loading="lazy" decoding="async" />
                ) : school?.logo_url ? (
                  <img src={school.logo_url} alt="" loading="lazy" decoding="async" />
                ) : (
                  initials(s.name)
                )}
              </div>
              <div className="spotlight-sr__meta">
                <h3 className="spotlight-sr__name">
                  {s.name}
                  <span className="spotlight-sr__year"> (SR)</span>
                  {s.position && (
                    <span className="spotlight-sr__pos">{s.position}</span>
                  )}
                </h3>
                <Link
                  to={`${sportPrefix}/team/${s.school_id}`}
                  className="spotlight-sr__school"
                >
                  {school?.name ?? s.school_id}
                  {school?.mascot ? ` · ${school.mascot}` : ""}
                </Link>
                {s.blurb && <p className="spotlight-sr__blurb">{s.blurb}</p>}
                {s.plans && (
                  <p className="spotlight-sr__plans">
                    <strong>Next up:</strong> {s.plans}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
