# Coverage scope

The v1 set of schools and their conference memberships. Wisconsin schools
typically belong to *different* conferences for *different* sports (especially
football) — model membership per-sport.

## Schools

### Wisconsin Valley Conference (large schools)

| School | Mascot | City | Notes |
|---|---|---|---|
| Wausau East | Lumberjacks | Wausau | WVC for most sports; **VFA West** for football |
| Wausau West | Warriors | Wausau | WVC; **VFA West** for football |
| D.C. Everest | Evergreens | Schofield/Weston | WVC; **VFA West** for football |
| Marshfield | Tigers | Marshfield | WVC; **VFA West** for football |
| Stevens Point Area (SPASH) | Panthers | Stevens Point | WVC; **VFA West** for football |
| Wisconsin Rapids Lincoln | Red Raiders | Wisconsin Rapids | WVC; **VFA West** for football |

### Marawood Conference (small schools, Marathon County core)

The Marawood splits into North and South divisions for some sports.

| School | Mascot | City |
|---|---|---|
| Athens | Bluejays | Athens |
| Edgar | Wildcats | Edgar |
| Marathon | Raiders | Marathon City |
| Newman Catholic | Cardinals | Wausau |
| Stratford | Tigers | Stratford |
| Spencer | Rockets | Spencer |

### Great Northern / Cloverbelt (overlap)

| School | Mascot | City | Primary conference |
|---|---|---|---|
| Mosinee | Indians | Mosinee | Great Northern |
| Colby | Hornets | Colby | Cloverbelt |
| Abbotsford | Falcons | Abbotsford | Cloverbelt |

## Conferences by sport

Build the data model so each school has a list of `(sport, conference)`
mappings, not a single global conference.

| Sport | WVC large schools play in… | Marawood schools play in… |
|---|---|---|
| Football | **VFA West** | Marawood (sometimes co-op'd) |
| Basketball (M/F) | WVC | Marawood |
| Volleyball | WVC | Marawood |
| Baseball | WVC | Marawood |
| Wrestling | WVC | Marawood |
| Hockey | WVC + co-ops | varies |
| XC, Track, Golf, Tennis, Swim | WVC | Marawood |

## Sport priority

| Priority | Sport | Season | Why |
|---|---|---|---|
| 1 | Football | Fall (Aug–Nov) | Biggest single-event ad value; widest audience |
| 2 | Boys basketball | Winter (Nov–Mar) | Long season, sustained traffic |
| 2 | Girls basketball | Winter | Same |
| 3 | Volleyball | Fall (Aug–Nov) | Fast-growing audience |
| 4 | Wrestling | Winter (Nov–Mar) | Central WI stronghold |
| 4 | Hockey (boys) | Winter | Wausau is a hockey town |
| 5 | Baseball | Spring (Mar–Jun) | Strong; pairs naturally with Woodchucks widget |
| 5 | Softball | Spring | Same |
| 5 | Track & Field | Spring | High participation, lower per-event traffic |
| 6 | XC, soccer, swim, golf, tennis | Various | Lower priority |

## Out of scope (for now)

- Co-op teams beyond what's listed above (e.g. unified hockey teams)
- Middle school sports
- Club sports / lacrosse / rugby
- Stevens Point Area Catholic (Pacelli) and other private schools outside Marathon County
- Athletes' individual recruiting/college commitment info
