export default function ScoreTicker({ games }) {
  if (!games || games.length === 0) {
    return <div className="score-ticker score-ticker--empty">No recent games.</div>;
  }

  // TODO: filter to last 7 days + today, sort by date desc.
  const recent = games.slice(0, 10);

  return (
    <div className="score-ticker">
      {recent.map((g) => (
        <div key={g.id} className="score-ticker__game">
          <span>{g.away.name}</span>
          <strong>{g.away.score ?? "—"}</strong>
          <span className="at">@</span>
          <span>{g.home.name}</span>
          <strong>{g.home.score ?? "—"}</strong>
          <span className="status">{g.status}</span>
        </div>
      ))}
    </div>
  );
}
