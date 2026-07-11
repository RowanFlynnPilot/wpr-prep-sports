# Data schema

Canonical JSON schema for files in `data/`. Frontend depends on these field
names — don't rename without updating both sides.

Pydantic models in `scraper/models/schema.py` are the source of truth; the
writer (`scraper/output/writer.py`) splits them across files at dump time.

## Files (split per-sport layout, since 2026-06)

| File | Contents |
|---|---|
| `data/schools.json` | Array of `School` — cross-sport, loaded once |
| `data/<sport>/meta.json` | Single `Meta` object (freshness signal — frontend cache-busts on `last_updated`) |
| `data/<sport>/games.json` | Array of **slim** `Game` (headline stats only; compact JSON) |
| `data/<sport>/boxscores/<game_id>.json` | `{ game_id, stat_leaders: StatLine[] }` — fetched on demand by game pages |
| `data/<sport>/players/<school_id>.json` | `{ school_id, lines: [...] }` — per-school stat lines for player pages |
| `data/<sport>/standings.json` | Array of `Standing` |
| `data/<sport>/season_stats.json` | Array of `SeasonStat` |
| `data/<sport>/power_rankings.json` | `{ sport, season, generated_at, method, rankings: PowerRanking[] }` |
| `data/<sport>/power_rankings_prev.json` | Prior snapshot (scraper-internal; movement arrows) |
| `data/history/<sport>.json` | `{ generated_at, seasons, matchups }` head-to-head distillation of archives (`scripts/build_history.py`) |
| `data/archive/<season>/<sport>/…` | Same per-sport layout, frozen at rollover; ships to Pages for the season selector |
| `data/{sponsors,potw,spirit,spotlights,pricing}.json` | Editorial/sponsor config (hand-edited, never scraper-written) |
| `data/digest/latest.{html,md}` | Weekly digest output (`digest.yml`) |

## Types

### School

```jsonc
{
  "id": "wausau-east",                   // slug, kebab-case
  "name": "Wausau East",
  "full_name": "Wausau East High School",
  "mascot": "Lumberjacks",
  "city": "Wausau",
  "colors": ["#0033A0", "#FFFFFF"],
  "conferences": [
    { "sport": "football",        "conference": "Wisconsin Valley" },
    { "sport": "boys_basketball", "conference": "Wisconsin Valley" }
  ],
  "wiaa_division": { "football": "D2", "boys_basketball": "D1" },
  "athletics_url": "https://..."
}
```

The **published** `data/schools.json` carries only the fields above. The
source-specific identifiers (`wiaa_org_id`, `bound_slug`, `wph_team_id`,
`wph_team_id_girls`, `maxpreps_slug`) live only in the scraper's manifest
(`scraper/config/schools.json`) and are deliberately stripped from the
public copy.

### Game (slim, as published in games.json)

```jsonc
{
  "id": "football-2025-09-05-wausau-east-at-wausau-west",
  "sport": "football",
  "season": "2025-26",
  "date": "2025-09-05T19:00:00-05:00",   // ISO 8601, US Central tz-aware
  "home": { "school_id": "wausau-west", "name": "Wausau West", "score": 21,
            "logo_url": "https://schools.wiaawi.org/Upload/School/Logo/..." },
  "away": { "school_id": "wausau-east", "name": "Wausau East", "score": 14, "logo_url": null },
  "status": "final",                      // scheduled | in_progress | final | postponed | cancelled
  "conference": "Wisconsin Valley",       // null for non-conference
  "conference_game": true,                // WIAA "(C)" marker
  "venue": "Wausau West HS",
  "sources": ["wiaa", "maxpreps"],
  "playoff": false,                       // WIAA tournament game
  "playoff_round": null,                  // "Level 1" … "State Championship"
  "scoring": [],                          // hockey only — Goal[] (see below)
  "set_scores": [],                       // volleyball only — [{ "away": 25, "home": 22 }, ...]
  "headline_stats": [],                   // first StatLine per (team, category) — ticker/recap subset
  "stat_line_count": 0                    // full count; >0 means boxscores/<id>.json exists
}
```

The full `stat_leaders` array is NOT in games.json — it lives in
`boxscores/<game_id>.json` and is merged back by readers
(`output/writer.py:load_full_games_raw` scraper-side,
`fetchBoxscore()` frontend-side).

### StatLine

```jsonc
{
  "team_school_id": "wausau-east",   // "" when the team isn't tracked
  "team_name": "Wausau East",        // raw as the source rendered it
  "category": "Passing Yards",
  "player_name": "A. Player",
  "player_year": "SR",               // SR | JR | SO | FR | null
  "position": null,                  // hockey F/D/G etc.
  "stats": { "YDS": "197", "TDS": "1" }  // raw source labels → values
}
```

### Goal (hockey scoring summary)

```jsonc
{
  "period": "2nd",                   // 1st | 2nd | 3rd | OT | SO
  "time": "0:58",
  "team_school_id": "wausau-west",
  "team_name": "Wausau West",
  "scorer_jersey": "10",
  "scorer_name": "C. Player",
  "strength": "power play",          // even strength | power play | shorthanded | empty net
  "assists": [{ "jersey": "7", "name": "B. Player" }],
  "away_score": 1,                   // running score after this goal
  "home_score": 2
}
```

### Standing

```jsonc
{
  "sport": "football",
  "season": "2025-26",
  "conference": "Wisconsin Valley",
  "division": null,                  // e.g. "Marawood North"
  "rows": [
    {
      "school_id": "dc-everest",
      "name": "D.C. Everest",
      "conference_wins": 5,
      "conference_losses": 0,
      "overall_wins": 7,
      "overall_losses": 1,
      "points_for": 280,
      "points_against": 110
    }
  ]
}
```

### SeasonStat

```jsonc
{
  "school_id": "wausau-east",
  "sport": "football",
  "category": "Passing",
  "player_name": "A. Player",        // "Team" rows = Bound team totals
  "player_year": "SR",
  "position": null,
  "jersey": "12",
  "stats": { "YDS": "1874", "TD": "18" }
}
```

### PowerRanking (inside power_rankings.json's `rankings` array)

```jsonc
{
  "rank": 1,
  "school_id": "dc-everest",
  "school_name": "D.C. Everest",
  "wins": 7, "losses": 1,
  "win_pct": 0.875,
  "sos": 0.61,                       // avg tracked-opponent W%
  "avg_margin_capped": 14.2,
  "score": 87.3,                     // 0-100 combined index
  "movement": 2                      // vs prev snapshot; null on first publish
}
```

### Meta

```jsonc
{
  "last_updated": "2026-09-13T03:15:00-05:00",  // stamped US Central by both scrape paths
  "season": "2026-27",
  "sports_included": ["football"],   // always exactly one (per-sport datasets)
  "sources_used": ["wiaa", "maxpreps"]
}
```

## Field conventions

- All IDs are kebab-case slugs (`wausau-east`); sport keys use underscores
  (`boys_basketball`) because they're enum values
- All datetimes are timezone-aware
- Scores are `null` for unplayed games (don't use `0`)
- `sources` lists every source that confirmed the record; multi-source = higher confidence
- Anything only some sports have (`scoring`, `set_scores`) defaults to
  empty rather than being omitted
