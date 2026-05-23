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
  const content = (
    <>
      <span className="sponsor__label">{label}</span>
      {data.logo_url ? (
        <img
          src={data.logo_url}
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
