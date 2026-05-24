# Data schema

Canonical JSON schema for files in `data/`. Frontend depends on these field
names — don't rename without updating both sides.

Pydantic models in `scraper/models/schema.py` are the source of truth.

## Files

| File | Contents |
|---|---|
| `data/meta.json` | Single object: `Meta` (last_updated, season, sports_included, sources_used) |
| `data/schools.json` | Array of `School` |
| `data/games.json` | Array of `Game` |
| `data/standings.json` | Array of `Standing` |

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
    { "sport": "football",        "conference": "VFA West" },
    { "sport": "boys_basketball", "conference": "Wisconsin Valley" }
  ],
  "wiaa_division": { "football": "D2", "boys_basketball": "D1" },
  "athletics_url": "https://...",
  // Optional source-specific identifiers used by the scraper. All
  // nullable; populated by discovery scripts (see scraper/scripts/).
  "wiaa_org_id": 12345,
  "bound_slug": "wausaueast",                    // segment used by gobound.com
  "wph_team_id": 67890,                          // wisconsinprephockey.net team page id
  "maxpreps_slug": "wausau/wausau-east-lumberjacks"  // segment between /wi/ and /<sport>/ on maxpreps.com
}
```

### Game

```jsonc
{
  "id": "football-2025-09-05-wausau-east-wausau-west",
  "sport": "football",
  "season": "2025-26",
  "date": "2025-09-05T19:00:00-05:00",   // ISO 8601, US Central tz-aware
  "home": { "school_id": "wausau-west", "name": "Wausau West", "score": 21 },
  "away": { "school_id": "wausau-east", "name": "Wausau East", "score": 14 },
  "status": "final",                      // scheduled | in_progress | final | postponed | cancelled
  "conference": "VFA West",               // null for non-conference
  "venue": "Wausau West HS",
  "sources": ["bound", "wiaa"]
}
```

### Standing

```jsonc
{
  "sport": "football",
  "season": "2025-26",
  "conference": "VFA West",
  "division": null,
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

### Meta

```jsonc
{
  "last_updated": "2025-09-13T03:15:00Z",
  "season": "2025-26",
  "sports_included": ["football", "volleyball"],
  "sources_used": ["bound", "wiaa"]
}
```

## Field conventions

- All IDs are kebab-case slugs (`wausau-east`, `boys_basketball` uses underscores because it's an enum value)
- All datetimes are timezone-aware
- Scores are `null` for unplayed games (don't use `0`)
- `sources` lists every source that confirmed the record; multi-source = higher confidence
