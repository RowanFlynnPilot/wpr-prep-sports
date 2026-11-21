"""Team calendar feeds (output/calendar.py): RFC 5545 shape, the summary a
parent reads from their own school's side, and stable output so the feed
doesn't churn on every scrape."""

from __future__ import annotations

from output.calendar import (
    Site,
    build_all,
    escape_text,
    event_summary,
    fold,
    render_calendar,
    sponsor_line_from,
)

SITE = Site(
    origin="https://sports.example.com",
    org_name="Example Pilot & Review",
    title="Central Wisconsin Prep Sports",
)

SCHOOLS = [
    {
        "id": "wausau-west",
        "name": "Wausau West",
        "full_name": "Wausau West High School",
        "city": "Wausau",
    },
    {"id": "merrill", "name": "Merrill", "full_name": "Merrill High School", "city": "Merrill"},
    {"id": "edgar", "name": "Edgar", "full_name": "Edgar High School", "city": "Edgar"},
]


def game(
    gid, date, home, away, *, sport="boys_basketball", status="scheduled", hs=None, as_=None, **kw
):
    g = {
        "id": gid,
        "sport": sport,
        "date": date,
        "status": status,
        "home": {"school_id": home[0], "name": home[1], "score": hs},
        "away": {"school_id": away[0], "name": away[1], "score": as_},
        "venue": f"@{home[1]}",
        "playoff": False,
        "playoff_round": None,
    }
    g.update(kw)
    return g


WEST = ("wausau-west", "Wausau West")
MERRILL = ("merrill", "Merrill")
LAKELAND = ("", "Lakeland")


def unfold(text: str) -> list[str]:
    return text.replace("\r\n ", "").split("\r\n")


def test_fold_keeps_lines_within_75_octets_and_never_splits_a_character():
    line = "SUMMARY:" + "Wausau West · Girls Basketball · " * 6
    folded = fold(line)
    for part in folded.split("\r\n"):
        assert len(part.encode("utf-8")) <= 75
    assert folded.replace("\r\n ", "") == line


def test_escape_text_escapes_commas_semicolons_backslashes_and_newlines():
    assert escape_text("a,b;c\\d\ne") == "a\\,b\\;c\\\\d\\ne"


def test_summary_reads_from_the_subscribed_school_side():
    away_win = game("g1", "2026-12-01T19:15:00-06:00", MERRILL, WEST, status="final", hs=47, as_=62)
    assert (
        event_summary(away_win, "wausau-west")
        == "W 62-47 · Wausau West at Merrill · Boys Basketball"
    )
    assert (
        event_summary(away_win, "merrill") == "L 47-62 · Merrill vs Wausau West · Boys Basketball"
    )


def test_summary_marks_forfeits_postponements_and_playoff_rounds():
    forfeit = game("g2", "2026-12-02T19:00:00-06:00", WEST, LAKELAND, status="final", hs=2, as_=0)
    assert event_summary(forfeit, "wausau-west").startswith("W (forfeit) · ")
    ppd = game("g3", "2026-12-03T19:00:00-06:00", WEST, MERRILL, status="postponed")
    assert event_summary(ppd, "wausau-west").startswith("Postponed · Wausau West vs Merrill")
    playoff = game(
        "g4",
        "2027-03-05T19:00:00-06:00",
        MERRILL,
        WEST,
        playoff=True,
        playoff_round="Sectional Final",
        venue="Stevens Point Area Senior High",
    )
    # Neutral site: "vs", never "at" the listed home side.
    assert event_summary(playoff, "wausau-west") == (
        "Wausau West vs Merrill · Sectional Final · Boys Basketball"
    )


def test_event_times_are_utc_and_midnight_listings_become_all_day():
    timed = game("g5", "2026-12-04T19:15:00-06:00", WEST, MERRILL)
    tbd = game("g6", "2026-12-05T00:00:00-06:00", WEST, MERRILL)
    lines = unfold(
        render_calendar("X", "Y", [timed, tbd], "wausau-west", SITE, {s["id"]: s for s in SCHOOLS})
    )
    assert "DTSTART:20261205T011500Z" in lines
    assert "DTEND:20261205T024500Z" in lines  # basketball: 90 minutes
    assert "DTSTART;VALUE=DATE:20261205" in lines
    assert "DTEND;VALUE=DATE:20261206" in lines


def test_calendar_shape_and_stable_output():
    games = [
        game("g7", "2026-12-04T19:15:00-06:00", WEST, MERRILL),
        game("g8", "2026-11-24T19:00:00-06:00", MERRILL, WEST, status="final", hs=40, as_=55),
    ]
    schools = {s["id"]: s for s in SCHOOLS}
    a = render_calendar("Wausau West Boys Basketball", "desc", games, "wausau-west", SITE, schools)
    b = render_calendar(
        "Wausau West Boys Basketball", "desc", list(reversed(games)), "wausau-west", SITE, schools
    )
    assert a == b, "input order or the wall clock must not change the feed"
    assert a.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
    assert a.endswith("END:VCALENDAR\r\n")
    lines = unfold(a)
    assert lines.count("BEGIN:VEVENT") == 2 == lines.count("END:VEVENT")
    assert "DTSTAMP:20260801T000000Z" in lines
    assert "UID:g8@sports.example.com" in lines
    assert "LOCATION:Merrill High School\\, Merrill" in lines
    # Events sort by date: the Nov 24 final comes first.
    assert lines.index("UID:g8@sports.example.com") < lines.index("UID:g7@sports.example.com")


def test_build_all_writes_team_and_school_feeds_only_for_schools_with_games():
    by_sport = {
        "boys_basketball": [game("b1", "2026-12-04T19:15:00-06:00", WEST, MERRILL)],
        "boys_hockey": [
            game("h1", "2026-12-05T19:00:00-06:00", WEST, LAKELAND, sport="boys_hockey")
        ],
    }
    feeds = build_all(by_sport, SCHOOLS, SITE)
    assert set(feeds) == {
        "wausau-west/boys_basketball.ics",
        "wausau-west/boys_hockey.ics",
        "wausau-west/all.ics",
        "merrill/boys_basketball.ics",
        "merrill/all.ics",
    }
    every = unfold(feeds["wausau-west/all.ics"])
    assert every.count("BEGIN:VEVENT") == 2
    assert "X-WR-CALNAME:Wausau West sports" in every


def test_sponsor_line_appears_only_when_the_calendar_slot_is_sold():
    assert sponsor_line_from({"slots": {"calendar": {"name": None}}}) is None
    sold = {
        "slots": {
            "calendar": {
                "label": "Team calendars presented by",
                "name": "Acme Bank",
                "link_url": "https://acme.example",
            }
        }
    }
    line = sponsor_line_from(sold)
    assert line == "Team calendars presented by Acme Bank · https://acme.example"
    feeds = build_all(
        {"boys_basketball": [game("b2", "2026-12-04T19:15:00-06:00", WEST, MERRILL)]},
        SCHOOLS,
        SITE,
        sold,
    )
    assert "Acme Bank" in feeds["wausau-west/boys_basketball.ics"].replace("\r\n ", "")
