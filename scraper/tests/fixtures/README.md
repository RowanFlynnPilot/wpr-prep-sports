# Parser fixtures

Raw responses saved from the live sources so the parsers can be tested
without network access. Refresh with:

```bash
cd scraper
python tests/capture_fixtures.py
```

Refresh when WIAA changes markup (a fixture test failing after a refresh
= the parser genuinely broke) and at the start of each season. The tests
assert structural invariants, not exact game lists, so a routine refresh
shouldn't require changing any test.

| File | Source | What it exercises |
| --- | --- | --- |
| `wiaa_search_org.json` | `Directory/School/SearchOrg` | OrgID search response shape |
| `wiaa_directory_school.html` | `Directory/School/GetDirectorySchool` | `parse_team_entries_html` (SSID/TeamID rows) |
| `wiaa_schedule.html` | `Directory/Schedule/Index` | `parse_team_schedule_html` (game rows) |
| `wiaa_schedule.meta.json` | — | which school/sport/TeamID the schedule fixture came from |

Still TODO (capture when their seasons resume): Bound team page,
MaxPreps box score, Wisconsin Prep Hockey game page — their parsers
(`sources/bound.py`, `sources/maxpreps.py`, `sources/wph.py`) currently
have no fixture coverage.
