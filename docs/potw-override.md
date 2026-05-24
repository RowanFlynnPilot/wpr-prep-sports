# Player of the Week — editor override

By default the Player of the Week card on the dashboard picks the
highest-scoring stat line of the most recent week, gated to tracked
schools. Logic lives in
[`frontend/src/utils/playerOfWeek.js`](../frontend/src/utils/playerOfWeek.js).

When a sport entry exists in [`data/potw.json`](../data/potw.json) and
its `expires_at` is in the future, that pick wins over the algorithm.
Delete the entry (or let it expire) to revert to algorithmic selection.

## Schema

`data/potw.json`:

```json
{
  "<sport-id>": {
    "school_id": "wausau-east",
    "game_id": "football-2025-10-17-merrill-at-wausau-east",
    "player_name": "Jane Doe",
    "player_year": "SR",
    "position": "QB",
    "headline": "Threw for 350 and 4 TDs in the Friday rout.",
    "expires_at": "2025-10-24T00:00:00Z"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `school_id` | yes | Must match a school slug in `data/schools.json` |
| `game_id` | yes | Must match an existing game id; unknown ids silently fall back to the algorithm |
| `player_name` | yes |  |
| `player_year` | no | Renders as `(SR)` next to the name |
| `position` | no | Renders as a pill after the name |
| `headline` | no | When set, replaces the auto-formatted stat line below the name. Write it in the same voice as the algorithmic line — short sentence, ends with a period |
| `expires_at` | no | ISO 8601 UTC. When omitted the override never expires (set one anyway — typically end of the next news cycle) |

Sport ids: `football`, `boys_basketball`, `girls_basketball`,
`volleyball`, `boys_hockey`, `girls_hockey`.

## Workflow

1. Editor decides on the week's pick.
2. Find the player's game id in the widget (the URL hash on the game
   page is `#/<sport>/game/<gameId>`).
3. Update `data/potw.json` via the GitHub web editor or a PR.
4. Commit triggers `deploy.yml`; the new pick is live within a couple
   minutes.

## Removing an override

Either delete the sport's key from `data/potw.json`, or let its
`expires_at` lapse. The widget will silently fall back to the
algorithmic pick on the next dataset fetch.
