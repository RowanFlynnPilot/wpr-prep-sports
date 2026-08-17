import { trackEvent } from "../utils/analytics.js";

/**
 * Editorial-style sponsor placement. Renders nothing when the slot is
 * empty (name missing) — by design, no "Your ad here" filler that wrecks
 * the visual rhythm when a slot is unsold.
 *
 * Slot keys (see data/sponsors.json):
 *   "title"                       — masthead
 *   "ticker"                      — above recent scores
 *   "standings:<conference>"      — per conference standings card
 *   "school:<school_id>"          — per team page
 *
 * Variants tune density:
 *   "compact" — masthead inline; small text, optional tiny logo
 *   "inline"  — section eyebrow; medium text
 *   "card"    — its own card-shaped surface (per-school page)
 */
export default function Sponsor({ slot, sponsors, variant = "inline", className = "" }) {
  const data = sponsors?.slots?.[slot];

  // Empty in production = render nothing (no "Your ad here" filler).
  // In dev, surface a faint placeholder so WPR ad ops can SEE the slot
  // exists and what its key is — makes the inventory map self-documenting.
  if (!data || !data.name) {
    if (import.meta.env.DEV) {
      return (
        <div
          className={`sponsor sponsor--placeholder sponsor--${variant} ${className}`.trim()}
          data-slot={slot}
          title={`Sponsor slot: ${slot}${data?.label ? ` (${data.label})` : ""}`}
        >
          <span className="sponsor__placeholder-label">slot</span>
          <code className="sponsor__placeholder-key">{slot}</code>
        </div>
      );
    }
    return null;
  }

  const label = data.label ?? "Presented by";
  // A schemeless, root-less logo_url ("logos/sponsors/x.png") is an asset
  // in frontend/public/ — resolve it against the build's base URL so the
  // same sponsors.json works on the custom domain ("/") and on a
  // github.io fork ("/wpr-prep-sports/") alike.
  const logoSrc =
    data.logo_url && !/^(?:https?:)?\/\//.test(data.logo_url) && !data.logo_url.startsWith("/")
      ? `${import.meta.env.BASE_URL}${data.logo_url}`
      : data.logo_url;
  // Banner: a full-width image creative (e.g. "banner:<sport>" at the foot
  // of a sport's dashboard) rather than the inline label+logo treatment.
  // The eyebrow keeps the ad honestly labeled, news-site style; without a
  // creative there is nothing worth showing, so an image-less banner slot
  // renders like an empty one.
  if (variant === "banner") {
    if (!logoSrc) return null;
    const img = (
      <img
        src={logoSrc}
        alt={data.name}
        className="sponsor-banner__img"
        loading="lazy"
        decoding="async"
      />
    );
    return (
      <div className={`sponsor-banner ${className}`.trim()}>
        <span className="sponsor-banner__eyebrow">{label}</span>
        {data.link_url ? (
          <a
            href={data.link_url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            aria-label={`${label}: ${data.name}`}
            onClick={() => trackEvent(`sponsor-click:${slot}`)}
          >
            {img}
          </a>
        ) : (
          img
        )}
      </div>
    );
  }

  const content = (
    <>
      <span className="sponsor__label">{label}</span>
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={data.name}
          className="sponsor__logo"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="sponsor__name">{data.name}</span>
      )}
    </>
  );

  const classNames = `sponsor sponsor--${variant} ${className}`.trim();

  if (data.link_url) {
    return (
      <a
        href={data.link_url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={classNames}
        aria-label={`${label}: ${data.name}`}
        onClick={() => trackEvent(`sponsor-click:${slot}`)}
      >
        {content}
      </a>
    );
  }
  return (
    <div className={classNames} aria-label={`${label}: ${data.name}`}>
      {content}
    </div>
  );
}
