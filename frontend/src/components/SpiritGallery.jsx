import { useMemo, useState } from "react";

/**
 * Reader-submitted "school spirit" photos for one game. Renders nothing
 * when no approved photos match — keeps the page quiet on most games
 * and lets the section earn its place when something's there.
 *
 * Matching rules (in priority order):
 *   1. `game_id` directly references this game.
 *   2. Game tracked, sport matches, school_id matches one of the teams,
 *      and the approval timestamp falls within the week around the
 *      game's date (so photos posted alongside a game show up there even
 *      when the submitter didn't tag the specific game).
 */
export default function SpiritGallery({ game, photos = [] }) {
  const [lightbox, setLightbox] = useState(null);

  const matches = useMemo(() => {
    if (!photos || photos.length === 0) return [];
    const gameDate = new Date(game.date).getTime();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const teamSchoolIds = new Set(
      [game.home.school_id, game.away.school_id].filter(Boolean),
    );
    const sport = game.sport;

    return photos.filter((p) => {
      if (p.game_id && p.game_id === game.id) return true;
      if (p.game_id) return false;
      if (!teamSchoolIds.has(p.school_id)) return false;
      if (p.sport && p.sport !== sport) return false;
      if (!p.approved_at) return false;
      const approved = new Date(p.approved_at).getTime();
      // Only include if the photo was approved within +/- a week of the
      // game — avoids dragging in unrelated photos from earlier games.
      return Math.abs(approved - gameDate) <= weekMs;
    });
  }, [photos, game]);

  if (matches.length === 0) return null;

  return (
    <section className="spirit-gallery">
      <div className="section-header">
        <h2>School Spirit</h2>
        <span className="section-header__hint">
          {matches.length} reader photo{matches.length === 1 ? "" : "s"} ·{" "}
          <SpiritSubmitLink />
        </span>
      </div>

      <ul className="spirit-gallery__grid">
        {matches.map((p) => (
          <li key={p.id} className="spirit-gallery__item">
            <button
              type="button"
              className="spirit-gallery__thumb"
              onClick={() => setLightbox(p)}
              aria-label={`View photo: ${p.caption ?? "school spirit submission"}`}
            >
              <img
                src={p.thumb_url ?? p.image_url}
                alt={p.caption ?? ""}
                loading="lazy"
              />
            </button>
            {p.caption && (
              <p className="spirit-gallery__caption">{p.caption}</p>
            )}
            {p.credit && (
              <p className="spirit-gallery__credit">— {p.credit}</p>
            )}
          </li>
        ))}
      </ul>

      {lightbox && (
        <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />
      )}
    </section>
  );
}

function Lightbox({ photo, onClose }) {
  return (
    <div
      className="spirit-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onClick={onClose}
    >
      <div
        className="spirit-lightbox__inner"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="spirit-lightbox__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <img src={photo.image_url} alt={photo.caption ?? ""} />
        <div className="spirit-lightbox__meta">
          {photo.caption && (
            <p className="spirit-lightbox__caption">{photo.caption}</p>
          )}
          {photo.credit && (
            <p className="spirit-lightbox__credit">— {photo.credit}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Single source of truth for the submit-a-photo link. Update once when
// WPR finalizes the WordPress submission URL.
export function SpiritSubmitLink({ className = "" }) {
  return (
    <a
      className={`spirit-submit-link ${className}`.trim()}
      href="https://wausaupilotandreview.com/submit-prep-sports-photo/"
      target="_top"
      rel="noopener"
    >
      Submit your photo →
    </a>
  );
}
