import { Link } from "react-router-dom";

/**
 * Wraps a school's display name. If the team is one we track (has school_id),
 * renders as a Link to /team/:id. Otherwise renders inert text.
 *
 * Used inside the hero, ticker cards, standings rows, and team-page schedules.
 */
export default function TeamLink({ team, className = "", children }) {
  if (team?.school_id) {
    return (
      <Link
        to={`/team/${team.school_id}`}
        className={`team-link ${className}`.trim()}
      >
        {children ?? team.name}
      </Link>
    );
  }
  return <span className={className}>{children ?? team?.name}</span>;
}
