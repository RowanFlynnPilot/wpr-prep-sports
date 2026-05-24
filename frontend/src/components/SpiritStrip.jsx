import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSportPrefix } from "../utils/links.js";
import { SpiritSubmitLink } from "./SpiritGallery.jsx";

const MAX_STRIP = 12;

/**
 * Dashboard-level horizontal strip of recent reader-submitted photos.
 * Filters to the current sport when possible; falls back to all
 * sports so the section never goes empty during single-sport seasons.
 *
 * Each thumbnail links to its game-detail page when game_id is set,
 * else to the school's team page — so clicking a photo lands the
 * reader on relevant context instead of a dead-end modal.
 */
export default function SpiritStrip({ photos = [], schoolIndex, sportConfig }) {
  const sportPrefix = useSportPrefix();
  const [lightbox, setLightbox] = useState(null);

  const items = useMemo(() => {
    if (!photos || photos.length === 0) return [];
    const sportId = sportConfig?.id;
    const inSport = sportId
      ? photos.filter((p) => !p.sport || p.sport === sportId)
      : photos;
    const ordered = (inSport.length > 0 ? inSport : photos)
      .slice()
      .sort((a, b) => {
        const ta = a.approved_at ? Date.parse(a.approved_at) : 0;
        const tb = b.approved_at ? Date.parse(b.approved_at) : 0;
        return tb - ta;
      });
    return ordered.slice(0, MAX_STRIP);
  }, [photos, sportConfig]);

  if (items.length === 0) return null;

  return (
    <section className="spirit-strip">
      <div className="section-header">
        <h2>School Spirit</h2>
        <span className="section-header__hint">
          Reader photos from across central WI · <SpiritSubmitLink />
        </span>
      </div>

      <ul className="spirit-strip__rail">
        {items.map((p) => {
          const school = schoolIndex?.get?.(p.school_id);
          const linkTo = p.game_id
            ? `${sportPrefix}/game/${p.game_id}`
            : p.school_id
              ? `${sportPrefix}/team/${p.school_id}`
              : null;
          return (
            <li key={p.id} className="spirit-strip__item">
              {linkTo ? (
                <Link to={linkTo} className="spirit-strip__thumb">
                  <img
                    src={p.thumb_url ?? p.image_url}
                    alt={p.caption ?? ""}
                    loading="lazy"
                  />
                </Link>
              ) : (
                <button
                  type="button"
                  className="spirit-strip__thumb"
                  onClick={() => setLightbox(p)}
                  aria-label={p.caption ?? "Open photo"}
                >
                  <img
                    src={p.thumb_url ?? p.image_url}
                    alt={p.caption ?? ""}
                    loading="lazy"
                  />
                </button>
              )}
              {school?.name && (
                <span className="spirit-strip__school">{school.name}</span>
              )}
            </li>
          );
        })}
      </ul>

      {lightbox && (
        <div
          className="spirit-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={() => setLightbox(null)}
        >
          <div
            className="spirit-lightbox__inner"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="spirit-lightbox__close"
              onClick={() => setLightbox(null)}
            >
              ×
            </button>
            <img src={lightbox.image_url} alt={lightbox.caption ?? ""} />
            {lightbox.caption && (
              <p className="spirit-lightbox__caption">{lightbox.caption}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
