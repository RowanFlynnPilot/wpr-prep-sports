import { useState } from "react";
import { MAX_FAVORITES, toggleFavorite, useFavorites } from "../utils/favorites.js";
import { trackEvent } from "../utils/analytics.js";

/**
 * Star toggle for pinning a school to the favorites strip.
 *
 * Deliberately a real <button> with an explicit label rather than a bare
 * icon: a chunk of this audience is grandparents on phones, and "Follow"
 * needs no learning. aria-pressed carries the state for screen readers.
 */
export default function FavoriteButton({ schoolId, schoolName, className = "" }) {
  const favorites = useFavorites();
  const [notice, setNotice] = useState(null);
  const isFav = favorites.includes(schoolId);

  const onClick = () => {
    const { added, atCapacity } = toggleFavorite(schoolId);
    if (atCapacity) {
      setNotice(`You can follow up to ${MAX_FAVORITES} schools — remove one first.`);
      window.setTimeout(() => setNotice(null), 4000);
      return;
    }
    trackEvent(added ? "favorite-add" : "favorite-remove", { school: schoolId });
  };

  return (
    <span className={`fav-toggle-wrap ${className}`.trim()}>
      <button
        type="button"
        className={"fav-toggle" + (isFav ? " fav-toggle--on" : "")}
        onClick={onClick}
        aria-pressed={isFav}
        aria-label={
          isFav ? `Unfollow ${schoolName ?? schoolId}` : `Follow ${schoolName ?? schoolId}`
        }
        title={isFav ? "Remove from your teams" : "Pin this school to the top"}
      >
        <span className="fav-toggle__star" aria-hidden="true">
          {isFav ? "★" : "☆"}
        </span>
        <span className="fav-toggle__label">{isFav ? "Following" : "Follow"}</span>
      </button>
      {notice && (
        <span className="fav-toggle__notice" role="status">
          {notice}
        </span>
      )}
    </span>
  );
}
