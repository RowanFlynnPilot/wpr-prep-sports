"""State-tournament games (sources/wiaa_state.py + the normalizer merge).

WIAA school schedules stop at Level 4 / Sectional Final, so every state
semifinal and final comes from the hand-typed prose on WIAA's sport pages.
The fixtures are trimmed copies of those pages captured 2026-10-31
(tests/capture_fixtures.py --state); the expectations below are the real
2025 results, so a parse regression shows up as a wrong score, not just a
wrong count.
"""

from __future__ import annotations

import json
from datetime import date

import pytest

from conftest import FIXTURE_DIR
from config.loader import load_manifest
from models.schema import GameStatus, Sport
from sources import wiaa_state as ws
from transform.normalize import (
    refresh_state_games,
    _merge_state_games,
    build_dataset,
    build_name_index_for_manifest,
    state_games_to_games,
    known_start_times,
)


def _fixture(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def _editable(name: str) -> str:
    """Fixture text with WIAA's &nbsp; runs as plain spaces, so tests can
    str.replace a placeholder line with a filled-in one."""
    return _fixture(name).replace(" ", " ")


def _find(rows, a: str, b: str):
    hits = [g for g in rows if {g.team_a, g.team_b} == {a, b}]
    assert len(hits) == 1, f"{a} v {b}: {hits}"
    return hits[0]


@pytest.fixture(scope="module")
def manifest():
    return load_manifest()


@pytest.fixture(scope="module")
def name_maps(manifest):
    return build_name_index_for_manifest(manifest), {s.id: s.name for s in manifest.schools}


# ---------------------------------------------------------------------------
# Archive pages (past seasons; where the current block lands after state)
# ---------------------------------------------------------------------------


def test_football_archive_2025_finals():
    rows = ws.parse_archive_page(
        _fixture("wiaa_state_football_archive.html"), sport="football", year=2025
    )
    assert len(rows) == 7  # one final per division, D1-D7
    assert {g.division for g in rows} == {str(d) for d in range(1, 8)}
    edgar = _find(rows, "Darlington", "Edgar")
    assert (edgar.team_a, edgar.score_a, edgar.team_b, edgar.score_b) == (
        "Darlington",
        42,
        "Edgar",
        18,
    )
    assert edgar.date == date(2025, 11, 20)
    assert edgar.time == "1:00PM"
    assert edgar.round == "State Championship"
    assert edgar.division == "6"
    assert edgar.venue.startswith("Camp Randall Stadium")
    # Friday's games pick up the second day header.
    assert _find(rows, "Arrowhead", "Bay Port").date == date(2025, 11, 21)


def test_football_archive_other_year_block():
    rows = ws.parse_archive_page(
        _fixture("wiaa_state_football_archive.html"), sport="football", year=2024
    )
    g = _find(rows, "Stratford", "Wrightstown")
    assert (g.score_a, g.score_b, g.date) == (21, 6, date(2024, 11, 21))
    assert (
        ws.parse_archive_page(
            _fixture("wiaa_state_football_archive.html"), sport="football", year=2019
        )
        == []
    )  # not in the trimmed fixture → nothing, never a wrong year


def test_eight_player_championship_is_after_level_4():
    # Gilman's Nov 8 "Level4" schedule row was a SEMIFINAL; the 8-player
    # title game was a week later and is on no school schedule.
    rows = ws.parse_archive_page(
        _fixture("wiaa_state_football_8p_archive.html"), sport="football", year=2025
    )
    assert len(rows) == 1  # the qualifying-report table on the page is ignored
    g = rows[0]
    assert (g.team_a, g.score_a, g.team_b, g.score_b) == (
        "McDonell Central Catholic",
        22,
        "Gilman",
        0,
    )
    assert g.date == date(2025, 11, 15) and g.time == "1:00PM"
    assert g.round == "State Championship"
    assert g.venue.startswith("South Wood County Stadium")


def test_volleyball_archive_rounds_and_sets():
    rows = ws.parse_archive_page(
        _fixture("wiaa_state_volleyball_archive.html"), sport="volleyball", year=2025
    )
    assert len(rows) == 19  # D1: 4 QF + 2 SF + F; D2-D5: 2 SF + F each
    rounds = [g.round for g in rows]
    assert rounds.count("State Quarterfinal") == 4
    assert rounds.count("State Semifinal") == 10
    assert rounds.count("State Championship") == 5
    final = _find(rows, "Rib Lake", "Newman Catholic")
    assert (final.team_a, final.score_a, final.score_b) == ("Rib Lake", 3, 1)
    assert final.set_scores == [(24, 26), (25, 18), (25, 19), (25, 23)]
    assert final.date == date(2025, 11, 8) and final.division == "5"
    # "vs." with set scores is a played match too — first team won 3-1.
    ocon = _find(rows, "Oconomowoc", "Oak Creek")
    assert (ocon.score_a, ocon.score_b, ocon.round) == (3, 1, "State Quarterfinal")
    spash = _find(rows, "Divine Savior Holy Angels", "Stevens Point")
    assert (spash.score_a, spash.score_b, spash.date) == (3, 0, date(2025, 11, 6))


def test_boys_soccer_archive_shootout_and_ot_notes():
    rows = ws.parse_archive_page(
        _fixture("wiaa_state_boys_soccer_archive.html"), sport="boys_soccer", year=2025
    )
    assert len(rows) == 12
    hudson = _find(rows, "Marquette", "Hudson")
    assert (hudson.score_a, hudson.score_b) == (3, 3)
    assert "SO" in hudson.note and hudson.round == "State Semifinal"
    final = _find(rows, "Oostburg", "Sturgeon Bay")
    assert (final.round, final.note, final.score_a, final.score_b) == ("State Final", "OT", 1, 0)
    # 2024's block numbers its games ("Game 3 - ...") — the prefix is stripped.
    rows24 = ws.parse_archive_page(
        _fixture("wiaa_state_boys_soccer_archive.html"), sport="boys_soccer", year=2024
    )
    g = _find(rows24, "Waukesha West", "Elkhorn")
    assert (g.score_a, g.score_b, g.round) == (0, 0, "State Final")


# ---------------------------------------------------------------------------
# Current-season tournament page
# ---------------------------------------------------------------------------


def test_tournament_page_placeholders_yield_nothing():
    html = _fixture("wiaa_state_volleyball_tournament.html")
    assert ws.parse_tournament_page(html, sport="volleyball", year=2026) == []
    assert (
        ws.parse_tournament_page(
            _fixture("wiaa_state_football_tournament.html"), sport="football", year=2026
        )
        == []
    )


def test_tournament_page_rejects_other_season():
    # At rollover the page can still show last season's block; dates from it
    # must never be stamped with the scrape's year.
    html = _editable("wiaa_state_volleyball_tournament.html").replace(
        "#2 Seed vs. #7 Seed", "#2 Hamilton (37-8) vs. #7 Verona (30-6)"
    )
    assert ws.parse_tournament_page(html, sport="volleyball", year=2027) == []


def test_tournament_page_filled_in_during_state_week():
    html = (
        _editable("wiaa_state_volleyball_tournament.html")
        .replace(
            "Game 4:  #1 Seed vs. #8 Seed",
            "Game 4:  #1 Hamilton (37-8) vs. #8 Stevens Point (31-8)",
        )
        .replace(
            "Game 1:  #1 Seed vs. #4 Seed - 9 a.m.",
            "Game 1:  #1 Newman Catholic vs. #4 Florence - 9 a.m.",
        )
    )
    rows = ws.parse_tournament_page(html, sport="volleyball", year=2026)
    qf = _find(rows, "Hamilton", "Stevens Point")
    assert qf.score_a is None and qf.score_b is None
    assert (qf.date, qf.time, qf.round, qf.division) == (
        date(2026, 11, 5),
        "7:30PM",
        "State Quarterfinal",
        "1",
    )
    assert qf.venue.startswith("Resch Center")
    # Pairings typed without records still parse (division 5 semifinal).
    sf = _find(rows, "Newman Catholic", "Florence")
    assert (sf.date, sf.time, sf.round, sf.division) == (
        date(2026, 11, 5),
        "9:00AM",
        "State Semifinal",
        "5",
    )


def test_football_tournament_page_filled_result():
    html = _editable("wiaa_state_football_tournament.html").replace(
        "1 p.m. – Division 6:  ", "1 p.m. – Division 6:  Edgar (14-0) 28, Darlington (13-1) 21"
    )
    rows = ws.parse_tournament_page(html, sport="football", year=2026)
    assert len(rows) == 1
    g = rows[0]
    assert (g.team_a, g.score_a, g.team_b, g.score_b) == ("Edgar", 28, "Darlington", 21)
    assert (g.date, g.time, g.division, g.round) == (
        date(2026, 11, 19),
        "1:00PM",
        "6",
        "State Championship",
    )
    assert g.venue.startswith("Camp Randall")


@pytest.mark.parametrize(
    "line,sport,expected",
    [
        # basketball, stray comma after the record
        (
            "#1 Slinger (25-4), 83, #4 McFarland (23-6) 52 -",
            "boys_basketball",
            ("Slinger", 83, "McFarland", 52),
        ),
        # hockey, co-op names with slashes
        (
            "#1 Stevens Point (25-3) 4, #4 De Pere/West De Pere (21-5-1) 0 -",
            "boys_hockey",
            ("Stevens Point", 4, "De Pere/West De Pere", 0),
        ),
        (
            "11 a.m. - Brookfield Central (14-3) 5, Wauwatosa East (16-5-1) 0 -",
            "girls_soccer",
            ("Brookfield Central", 5, "Wauwatosa East", 0),
        ),
        # five-set volleyball with no dash before the sets
        (
            "#2 Hamilton (38-8) def. #3 Oconomowoc (37-3) 19-25, 16-25, 25-19, 25-20, 15-10 -",
            "volleyball",
            ("Hamilton", 3, "Oconomowoc", 2),
        ),
    ],
)
def test_parse_result_line_shapes(line, sport, expected):
    g = ws.parse_result_line(line, sport=sport)
    assert (g["team_a"], g["score_a"], g["team_b"], g["score_b"]) == expected


@pytest.mark.parametrize(
    "line",
    [
        "Game 5: Winner of Game 1 vs. Winner of Game 2 - 1 p.m.",
        "Game 1: #2 Seed vs. #7 Seed - 5 p.m.",
        "Quarterfinals - Thursday, Nov. 6",
        "Resch Center, Green Bay, Wis.",
        "10 a.m. - Division 7:",
    ],
)
def test_parse_result_line_non_games(line):
    assert ws.parse_result_line(line, sport="volleyball") is None


def test_merge_state_rows_prefers_first_source_but_scored_rows():
    sched = ws.StateGame(
        "football", date(2026, 11, 19), "State Championship", "Edgar", "Darlington"
    )
    final = ws.StateGame(
        "football", date(2026, 11, 19), "State Championship", "Darlington", "Edgar", 21, 28
    )
    override = ws.StateGame(
        "football", date(2026, 11, 19), "State Final", "Edgar", "Darlington", 30, 0
    )
    assert ws.merge_state_rows([sched], [final]) == [final]
    assert ws.merge_state_rows([override], [final]) == [override]


# ---------------------------------------------------------------------------
# Normalizer: StateGame -> Game, merge into the dataset
# ---------------------------------------------------------------------------


def _edgar_final(order=("Darlington", "Edgar"), scores=(42, 18)):
    a, b = order
    sa, sb = scores if order == ("Darlington", "Edgar") else scores[::-1]
    return ws.StateGame(
        "football",
        date(2025, 11, 20),
        "State Championship",
        a,
        b,
        sa,
        sb,
        time="1:00PM",
        division="6",
        venue="Camp Randall Stadium, Madison, Wis.",
    )


def test_state_games_to_games_tracked_only_and_canonical(name_maps):
    name_to_id, id_to_name = name_maps
    untracked = ws.StateGame(
        "football", date(2025, 11, 20), "State Championship", "Mayville", "Northwestern", 42, 32
    )
    games = state_games_to_games(
        [_edgar_final(), untracked],
        sport=Sport.FOOTBALL,
        season="2025-26",
        name_to_id=name_to_id,
        id_to_name=id_to_name,
    )
    assert len(games) == 1
    g = games[0]
    assert g.id == "football-2025-11-20-darlington-at-edgar"
    assert (g.home.school_id, g.home.score) == ("edgar", 18)
    assert (g.away.school_id, g.away.name, g.away.score) == ("", "Darlington", 42)
    assert g.status is GameStatus.FINAL
    assert g.playoff is True and g.playoff_round == "State Championship"
    assert g.date.hour == 13 and g.venue.startswith("Camp Randall")
    assert g.sources == ["wiaa"]  # not credited as a stats source


def test_state_game_id_stable_across_listing_order_and_status(name_maps):
    name_to_id, id_to_name = name_maps
    kw = dict(sport=Sport.FOOTBALL, season="2025-26", name_to_id=name_to_id, id_to_name=id_to_name)
    winner_first = state_games_to_games([_edgar_final()], **kw)[0]
    flipped = state_games_to_games([_edgar_final(order=("Edgar", "Darlington"))], **kw)[0]
    pregame = state_games_to_games(
        [ws.StateGame("football", date(2025, 11, 20), "State Championship", "Edgar", "Darlington")],
        **kw,
    )[0]
    assert winner_first.id == flipped.id == pregame.id
    assert (flipped.home.score, flipped.away.score) == (18, 42)
    assert pregame.status is GameStatus.SCHEDULED and pregame.home.score is None


def test_volleyball_set_scores_follow_orientation(name_maps):
    name_to_id, id_to_name = name_maps
    row = ws.StateGame(
        "volleyball",
        date(2025, 11, 8),
        "State Championship",
        "Rib Lake",
        "Newman Catholic",
        3,
        1,
        set_scores=[(24, 26), (25, 18), (25, 19), (25, 23)],
    )
    (g,) = state_games_to_games(
        [row],
        sport=Sport.VOLLEYBALL,
        season="2025-26",
        name_to_id=name_to_id,
        id_to_name=id_to_name,
    )
    assert g.away.school_id == "newman-catholic" and g.home.school_id == "rib-lake"
    assert (g.home.score, g.away.score) == (3, 1)
    assert g.set_scores[0] == {"away": 26, "home": 24}


def _edgar_schedule(extra_rows=()):
    rows = [
        {
            "date": "2025-11-14",
            "time": "7:00PM",
            "label": "WIAA Tournament - Level4",
            "home": {"team_id": None, "name": "Edgar", "logo_url": None},
            "away": {"team_id": None, "name": "Mondovi", "logo_url": None},
            "venue": "Stanley/Boyd",
            "result": "W 21-14",
            "conference_game": False,
        },
        *extra_rows,
    ]
    return [{"_school_id": "edgar", "games": rows}]


def test_build_dataset_adds_state_final_and_counts_it(manifest):
    ds = build_dataset(
        manifest=manifest,
        raw_team_schedules=_edgar_schedule(),
        sport="football",
        season="2025-26",
        state_games=[_edgar_final()],
    )
    rounds = {g.playoff_round for g in ds.games}
    assert rounds == {"Level 4", "State Championship"}
    row = next(r for s in ds.standings for r in s.rows if r.school_id == "edgar")
    assert (row.overall_wins, row.overall_losses) == (1, 1)


def test_build_dataset_merges_a_schedule_listed_state_game(manifest):
    # If a school schedule ever does list the state game (scoreless, other
    # orientation), it keeps its id and gains the state round + score.
    listed = {
        "date": "2025-11-20",
        "time": "1:00PM",
        "label": None,
        "home": {"team_id": None, "name": "Darlington", "logo_url": None},
        "away": {"team_id": None, "name": "Edgar", "logo_url": None},
        "venue": None,
        "result": None,
        "conference_game": False,
    }
    ds = build_dataset(
        manifest=manifest,
        raw_team_schedules=_edgar_schedule([listed]),
        sport="football",
        season="2025-26",
        state_games=[_edgar_final()],
    )
    state = [g for g in ds.games if g.date.date() == date(2025, 11, 20)]
    assert len(state) == 1
    g = state[0]
    assert g.id == "football-2025-11-20-edgar-at-darlington"
    assert g.playoff_round == "State Championship"
    assert (g.away.score, g.home.score, g.status) == (18, 42, GameStatus.FINAL)
    assert g.venue.startswith("Camp Randall")


def test_merge_state_games_leaves_schedule_score_alone(name_maps):
    name_to_id, id_to_name = name_maps
    kw = dict(sport=Sport.FOOTBALL, season="2025-26", name_to_id=name_to_id, id_to_name=id_to_name)
    (scored,) = state_games_to_games([_edgar_final()], **kw)
    games = {scored.id: scored.model_copy(update={"playoff": False, "playoff_round": None})}
    (pregame,) = state_games_to_games(
        [ws.StateGame("football", date(2025, 11, 20), "State Championship", "Edgar", "Darlington")],
        **kw,
    )
    _merge_state_games(games, [pregame])
    (g,) = games.values()
    assert g.playoff and g.playoff_round == "State Championship"
    assert (g.home.score, g.away.score) == (18, 42)


# ---------------------------------------------------------------------------
# Manual override file + the main.py gate
# ---------------------------------------------------------------------------


def test_load_state_overrides(tmp_path):
    path = tmp_path / "state_games.json"
    path.write_text(
        json.dumps(
            {
                "games": [
                    {
                        "sport": "volleyball",
                        "season": "2026-27",
                        "round": "State Semifinal",
                        "date": "2026-11-05",
                        "time": "9 a.m.",
                        "home": "newman-catholic",
                        "away": "Florence",
                        "home_score": 3,
                        "away_score": 1,
                        "venue": "Resch Center, Green Bay, Wis.",
                        "set_scores": [[25, 20], [20, 25], [25, 18], [25, 22]],
                    },
                    {"sport": "football", "season": "2026-27", "round": "State Championship"},
                    {
                        "sport": "volleyball",
                        "season": "2026-27",
                        "date": "not-a-date",
                        "round": "x",
                        "home": "a",
                        "away": "b",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    rows = ws.load_state_overrides(path, "volleyball", "2026-27")
    assert len(rows) == 1  # other sport filtered, malformed row skipped
    r = rows[0]
    assert (r.team_a, r.score_a, r.time, r.source) == (
        "newman-catholic",
        3,
        "9:00AM",
        "state-override",
    )
    assert ws.load_state_overrides(tmp_path / "missing.json", "volleyball", "2026-27") == []


def test_override_ids_resolve_like_names(name_maps, tmp_path):
    name_to_id, id_to_name = name_maps
    row = ws.StateGame(
        "volleyball", date(2026, 11, 5), "State Semifinal", "newman-catholic", "Florence", 3, 1
    )
    (g,) = state_games_to_games(
        [row],
        sport=Sport.VOLLEYBALL,
        season="2026-27",
        name_to_id=name_to_id,
        id_to_name=id_to_name,
    )
    assert g.away.school_id == "" and g.away.name == "Florence"
    assert (g.home.school_id, g.home.name) == ("newman-catholic", id_to_name["newman-catholic"])


def test_collect_state_games_only_fetches_in_postseason(monkeypatch, tmp_path):
    import main

    calls = []
    monkeypatch.setattr(main, "STATE_OVERRIDES_PATH", tmp_path / "none.json")
    monkeypatch.setattr(
        main.wiaa_state,
        "fetch_state_games",
        lambda sport, season, console=None: calls.append(sport) or [],
    )
    regular = [{"games": [{"label": None}, {"label": "Homecoming"}]}]
    assert main.collect_state_games("football", "2026-27", regular) == []
    assert calls == []
    series = [{"games": [{"label": "WIAA Tournament - Level1"}]}]
    main.collect_state_games("football", "2026-27", series)
    assert calls == ["football"]


def test_refresh_state_games_scores_a_pending_state_game(manifest):
    """Live mode: a scheduled state game in the dataset gains its score (and the
    standings count it) when WIAA's tournament page posts the result."""
    import dataclasses

    final = _edgar_final()
    pending = dataclasses.replace(final, score_a=None, score_b=None, set_scores=[])
    ds = build_dataset(
        manifest=manifest,
        raw_team_schedules=_edgar_schedule(),
        sport="football",
        season="2025-26",
        state_games=[pending],
    )
    before = next(g for g in ds.games if g.playoff_round == "State Championship")
    assert before.status != GameStatus.FINAL

    changed = refresh_state_games(ds, manifest, [final], sport="football", season="2025-26")
    assert changed == 1
    after = next(g for g in ds.games if g.playoff_round == "State Championship")
    assert after.status == GameStatus.FINAL
    row = next(r for s in ds.standings for r in s.rows if r.school_id == "edgar")
    assert (row.overall_wins, row.overall_losses) == (1, 1)
    # Idempotent: the same rows again change nothing.
    assert refresh_state_games(ds, manifest, [final], sport="football", season="2025-26") == 0


def test_merge_state_rows_keeps_time_when_result_replaces_schedule():
    """WIAA drops the start time from a line once it carries a result, so the
    scored row inherits the scheduled row's time instead of losing it."""
    import dataclasses

    final = _edgar_final()
    scheduled = dataclasses.replace(
        final, score_a=None, score_b=None, set_scores=[], time="11:30AM"
    )
    scored = dataclasses.replace(final, time=None)
    merged = ws.merge_state_rows([scheduled], [scored])
    assert len(merged) == 1
    assert merged[0].score_a == final.score_a
    assert merged[0].time == "11:30AM"
    # A later source with a time fills a timeless earlier row too.
    merged = ws.merge_state_rows([scored], [scheduled])
    assert merged[0].score_a == final.score_a and merged[0].time == "11:30AM"


def test_state_games_keep_known_start_time_from_previous_dataset(manifest):
    """Full scrape: a result row with no time keeps the start time the previous
    dataset held for that game rather than the 7:00 PM default."""
    import dataclasses

    scheduled = dataclasses.replace(
        _edgar_final(), score_a=None, score_b=None, set_scores=[], time="11:30AM"
    )
    before = build_dataset(
        manifest=manifest,
        raw_team_schedules=_edgar_schedule(),
        sport="football",
        season="2025-26",
        state_games=[scheduled],
    )
    game = next(g for g in before.games if g.playoff_round == "State Championship")
    assert (game.date.hour, game.date.minute) == (11, 30)

    after = build_dataset(
        manifest=manifest,
        raw_team_schedules=_edgar_schedule(),
        sport="football",
        season="2025-26",
        state_games=[dataclasses.replace(_edgar_final(), time=None)],
        known_times=known_start_times(before.games),
    )
    final = next(g for g in after.games if g.playoff_round == "State Championship")
    assert final.status == GameStatus.FINAL
    assert (final.date.hour, final.date.minute) == (11, 30)
    assert final.id == game.id


def test_state_rows_outside_the_season_window_are_dropped(manifest):
    """A 2025 archive row must never land in a 2026-27 file, whatever season
    label the fetch was made for (live run, 2026-11-05)."""
    import dataclasses

    last_year = _edgar_final()  # dated 2025-11-20
    ds = build_dataset(
        manifest=manifest,
        raw_team_schedules=_edgar_schedule(),
        sport="football",
        season="2026-27",
        state_games=[last_year],
    )
    assert not any(g.playoff_round == "State Championship" for g in ds.games)
    assert refresh_state_games(ds, manifest, [last_year], sport="football", season="2026-27") == 0
    this_year = dataclasses.replace(last_year, date=date(2026, 11, 19))
    assert refresh_state_games(ds, manifest, [this_year], sport="football", season="2026-27") == 1


def test_build_dataset_drops_schedule_rows_outside_the_season_window(manifest):
    """A previous-season row on a school's WIAA schedule page never reaches the
    file (it failed every scrape's data gate on 2026-11-06)."""
    import copy

    schedules = copy.deepcopy(_edgar_schedule())
    stray = copy.deepcopy(schedules[0]["games"][0])
    stray["date"] = "2024-08-30"
    schedules[0]["games"].append(stray)
    ds = build_dataset(
        manifest=manifest, raw_team_schedules=schedules, sport="football", season="2025-26"
    )
    assert all(g.date.year >= 2025 for g in ds.games)
