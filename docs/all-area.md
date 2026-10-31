# All-Area team — editor workflow

Publish a sport's All-Area team by filling `data/all_area.json` and
committing — no code changes, live on the next deploy. Same pattern as
the PotW override (`docs/potw-override.md`) and Senior Spotlights
(`docs/spotlights.md`).

The page lives at `#/<sport>/all-area` (for example
`https://sports.wausaupilotandreview.com/#/football/all-area`). Link to
it from the announcement story; it carries no banner of its own on the
dashboard.

## The file

`data/all_area.json` is keyed by **sport id**, then **season**:

```json
{
  "football": {
    "2026-27": {
      "title": "2026 All-Area Football Team",
      "published": "2026-11-23",
      "intro": "Chosen by the Wausau Pilot & Review sports desk from …",
      "sponsor_slot": "all-area",
      "player_of_year": {
        "player_name": "Jane Doe",
        "school_id": "wausau-east",
        "position": "QB",
        "year": "SR",
        "line": "2,400 passing yards and 28 touchdowns for the Valley champions."
      },
      "coach_of_year": {
        "name": "Pat Example",
        "school_id": "edgar",
        "line": "Took a team picked fifth in the Marawood to Level 3."
      },
      "first_team": [
        { "player_name": "Jane Doe", "school_id": "wausau-east", "position": "QB", "year": "SR", "line": "2,400 yards, 28 TD, 4 INT" }
      ],
      "second_team": [],
      "honorable_mention": []
    }
  }
}
```

Sport ids are the dataset folder names under `data/` (`football`,
`boys_basketball`, `girls_basketball`, `volleyball`, `boys_hockey`,
`girls_hockey`, `boys_soccer`, `girls_soccer`). Seasons use the WIAA
school-year form, `2026-27`.

Keys that start with an underscore (`_comment`, `_example`) are ignored
at every level — the shipped file carries an `_example` block you can
copy from; it never renders.

### Entry fields

| Field | Required | Notes |
|---|---|---|
| `title` | yes | The headline. "2026 All-Area Football Team". |
| `published` | yes | `YYYY-MM-DD`, local date. The page shows the entry from midnight that morning; before then readers see the empty state, so the file can be committed ahead of the announcement. |
| `intro` | no | One or two sentences on how the team was chosen. |
| `sponsor_slot` | no | The `data/sponsors.json` slot rendered under the title. Defaults to `all-area`; set a different key only if a sport's team is sold separately (add that slot to sponsors.json too). |
| `player_of_year` | no | A player object (below). |
| `coach_of_year` | no | `{ name, school_id, line? }`. |
| `first_team`, `second_team`, `honorable_mention` | no | Arrays of player objects, in the order you want them printed. Empty or missing sections are not rendered. |

### Player object

| Field | Required | Notes |
|---|---|---|
| `player_name` | yes | As it should print. Match the spelling the stat sources use (check the player's page) so the name links. |
| `school_id` | yes | Slug from `data/schools.json` (`wausau-east`, `dc-everest`, …). Drives the logo, color bar and school link. |
| `position` | no | Short tag, `QB`, `OH`, `G`. |
| `year` | no | `SR`, `JR`, `SO`, `FR`. |
| `line` | no | Stat line or one-sentence note. Shown on first and second team; honorable mention prints name, school and position only. |

A name links to the player's profile page when that player has a stat
row this season (season totals or a per-game line) at that school;
otherwise it prints as plain text. Nothing breaks if a name doesn't
match — the link is simply omitted.

## When it appears

- **Before `published`:** `#/<sport>/all-area` shows "The All-Area team is
  announced after the state tournament." with a link to the season
  leaders. This is the normal state for most of the year, and the route
  is safe to link ahead of time.
- **From `published` on:** the newest published entry for that sport
  renders. When more than one season is published, the most recent
  `published` date wins; with the season archive selector on an older
  season, that season's entry is shown instead when it exists.
- **Next season:** add a new season key; the old one stays in the file
  and serves the archive view. Don't delete past seasons.

## Sponsorship

The line under the title carries the `all-area` slot in
`data/sponsors.json` ("All-Area Team presented by ___"), one slot across
every sport's page. Sold status shows on the `#/sponsor` media kit
automatically; clicks report as `sponsor-click:all-area`. See
`docs/advertiser-inventory.md`.

## Checklist for announcement day

1. Fill the season entry (copy `_example`, fix every name and `school_id`).
2. Set `published` to the announcement date.
3. Run `python scraper/scripts/validate_data.py` if it's handy; the file
   is plain JSON, so a trailing comma is the usual failure.
4. Commit and push; deploy publishes it. Open `#/<sport>/all-area` and
   check that the names you expect to link are links.
