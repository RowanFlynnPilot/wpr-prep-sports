"""Pure-logic tests for transform/normalize.py — result parsing, datetime
defaults, slugs, double-listing detection, and the alias table's
integrity against the manifest."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from config.loader import load_manifest
from models.schema import Game, GameStatus, Sport, TeamScore
from transform.normalize import (
    _build_name_index,
    _normalize_name,
    _parse_datetime,
    _parse_result,
    _slugify,
    clear_cross_table_conference_flags,
    collapse_same_day_duplicates,
    is_double_listing,
)


# ---- _parse_result --------------------------------------------------------


def test_result_win_from_home_perspective():
    home, away, status = _parse_result("W 30-6", owner_school_id="a", home_id="a", away_id="b")
    assert (home, away, status) == (30, 6, GameStatus.FINAL)


def test_result_loss_from_home_perspective():
    home, away, status = _parse_result("L 14-21", owner_school_id="a", home_id="a", away_id="b")
    assert (home, away, status) == (14, 21, GameStatus.FINAL)


def test_result_owner_is_away_maps_to_absolute_sides():
    home, away, status = _parse_result("W 30-6", owner_school_id="b", home_id="a", away_id="b")
    assert (home, away, status) == (6, 30, GameStatus.FINAL)


def test_result_playoff_reversed_digits_swap():
    # WIAA playoff rows sometimes render winner-first even for the loser's
    # row: "L 35-7" where the owner actually scored 7. The W/L letter is
    # the tiebreaker.
    home, away, status = _parse_result("L 35-7", owner_school_id="a", home_id="a", away_id="b")
    assert (home, away, status) == (7, 35, GameStatus.FINAL)


def test_result_none_is_scheduled():
    assert _parse_result(None, owner_school_id="a", home_id="a", away_id="b") == (
        None,
        None,
        GameStatus.SCHEDULED,
    )


def test_result_garbage_is_scheduled():
    assert _parse_result("TBD", owner_school_id="a", home_id="a", away_id="b") == (
        None,
        None,
        GameStatus.SCHEDULED,
    )


def test_result_owner_untracked_final_without_scores():
    home, away, status = _parse_result("W 30-6", owner_school_id=None, home_id="a", away_id="b")
    assert status is GameStatus.FINAL
    assert home is None and away is None


# ---- _parse_datetime ------------------------------------------------------


def test_datetime_defaults_to_seven_pm():
    dt = _parse_datetime("2026-09-04", None)
    assert (dt.hour, dt.minute) == (19, 0)
    assert dt.tzinfo is not None


def test_datetime_parses_pm_time():
    dt = _parse_datetime("2026-09-04", "5:30PM")
    assert (dt.hour, dt.minute) == (17, 30)


def test_datetime_parses_noon():
    dt = _parse_datetime("2026-09-04", "12:00PM")
    assert dt.hour == 12


def test_datetime_bad_date_is_none():
    assert _parse_datetime("not-a-date", "7:00PM") is None


# ---- slug + aliases -------------------------------------------------------


def test_slugify():
    assert _slugify("D.C. Everest") == "d-c-everest"
    assert _slugify("Stevens Point Area") == "stevens-point-area"


def test_manifest_aliases_are_unambiguous():
    """Integrity check for the hand-maintained per-school alias lists:
    the same alias on two schools would resolve games to whichever one
    sorts last, and an alias colliding with another school's canonical
    name would shadow it."""
    manifest = load_manifest()
    seen: dict[str, str] = {}
    for s in manifest.schools:
        for alias in s.aliases:
            key = _normalize_name(alias)
            assert key not in seen or seen[key] == s.id, (
                f"alias {alias!r} claimed by both {seen[key]} and {s.id}"
            )
            seen[key] = s.id
    canonical = {_normalize_name(s.name): s.id for s in manifest.schools}
    for key, owner in seen.items():
        assert canonical.get(key, owner) == owner, (
            f"alias {key!r} on {owner} shadows school {canonical[key]!r}'s own name"
        )


def test_name_index_resolves_coop_display_names():
    idx = _build_name_index(load_manifest())
    assert idx["d.c. everest co-op"] == "central-wisconsin-storm"
    assert idx["stevens point area"] == "spash"
    assert idx["wausau east"] == "wausau-east"


# ---- double-listing detection ---------------------------------------------

_CENTRAL = ZoneInfo("America/Chicago")


def _listing(
    sport: Sport,
    *,
    home_score=3,
    away_score=1,
    playoff=False,
    hour=19,
) -> Game:
    status = GameStatus.FINAL if home_score is not None else GameStatus.SCHEDULED
    return Game(
        id=f"{sport.value}-2026-02-19-away-at-home",
        sport=sport,
        season="2025-26",
        date=datetime(2026, 2, 19, hour, 0, tzinfo=_CENTRAL),
        home=TeamScore(school_id="home", name="Home", score=home_score),
        away=TeamScore(school_id="away", name="Away", score=away_score),
        status=status,
        playoff=playoff,
    )


def test_double_listing_playoff_flag_mismatch_merges():
    """The girls-hockey 2026-02-19 case: one physical playoff game also
    listed as a regular row — same time, same score."""
    a = _listing(Sport.GIRLS_HOCKEY, playoff=False)
    b = _listing(Sport.GIRLS_HOCKEY, playoff=True)
    assert is_double_listing(a, b)


def test_double_listing_scoreless_pair_merges():
    a = _listing(Sport.VOLLEYBALL, home_score=None, away_score=None)
    b = _listing(Sport.VOLLEYBALL, home_score=None, away_score=None)
    assert is_double_listing(a, b)


def test_double_listing_non_tournament_sport_merges():
    """Soccer/hockey have no same-day rematches, so identical rows are
    one game twice even with both flags regular."""
    a = _listing(Sport.GIRLS_SOCCER, home_score=0, away_score=14)
    b = _listing(Sport.GIRLS_SOCCER, home_score=0, away_score=14)
    assert is_double_listing(a, b)


def test_double_listing_volleyball_same_score_is_kept():
    """A volleyball tournament rematch can genuinely repeat a set score;
    without another tell, keep both rather than risk dropping a match."""
    a = _listing(Sport.VOLLEYBALL, home_score=2, away_score=1)
    b = _listing(Sport.VOLLEYBALL, home_score=2, away_score=1)
    assert not is_double_listing(a, b)


def test_double_listing_different_scores_is_kept():
    a = _listing(Sport.GIRLS_SOCCER, home_score=2, away_score=1)
    b = _listing(Sport.GIRLS_SOCCER, home_score=3, away_score=1)
    assert not is_double_listing(a, b)


def test_double_listing_different_times_is_kept():
    a = _listing(Sport.GIRLS_SOCCER, hour=10)
    b = _listing(Sport.GIRLS_SOCCER, hour=19)
    assert not is_double_listing(a, b)


# --- Same-day duplicate listings (critique run 21, 2026-11-21) -----------


def _row(
    gid: str,
    hour: int,
    *,
    sport: Sport = Sport.GIRLS_BASKETBALL,
    home: tuple[str, str] = ("stratford", "Stratford"),
    away: tuple[str, str] = ("loyal", "Loyal"),
    scores: tuple[int | None, int | None] = (None, None),
    conference: bool = False,
    venue: str | None = None,
    minute: int = 0,
) -> Game:
    hs, as_ = scores
    return Game(
        id=gid,
        sport=sport,
        season="2026-27",
        date=datetime(2026, 11, 20, hour, minute, tzinfo=_CENTRAL),
        home=TeamScore(school_id=home[0], name=home[1], score=hs),
        away=TeamScore(school_id=away[0], name=away[1], score=as_),
        status=GameStatus.FINAL if hs is not None else GameStatus.SCHEDULED,
        conference_game=conference,
        venue=venue if venue is not None else f"@{home[1]}",
    )


def test_same_day_double_listing_keeps_the_conference_row():
    """Stratford's page lists Loyal at 7:00 PM and again at 7:15 PM (C)."""
    base = "girls_basketball-2026-11-20-loyal-at-stratford"
    games = {
        base: _row(base, 19),
        f"{base}-2": _row(f"{base}-2", 19, minute=15, conference=True),
    }
    assert collapse_same_day_duplicates(games) == [base]
    assert list(games) == [f"{base}-2"]


def test_same_day_double_listing_keeps_the_scored_row_and_drops_the_twin():
    base = "girls_basketball-2026-11-19-tri-county-at-nekoosa"
    games = {
        base: _row(base, 19, home=("nekoosa", "Nekoosa"), away=("tri-county", "Tri-County")),
        f"{base}-2": _row(
            f"{base}-2",
            18,
            home=("nekoosa", "Nekoosa"),
            away=("tri-county", "Tri-County"),
            scores=(55, 9),
        ),
    }
    collapse_same_day_duplicates(games)
    assert list(games) == [f"{base}-2"]
    assert games[f"{base}-2"].home.score == 55


def test_same_day_double_listing_merges_flipped_home_and_away_keeping_the_typed_venue():
    a = "boys_hockey-2027-01-22-mosinee-at-usm"
    b = "boys_hockey-2027-01-22-usm-at-mosinee"
    games = {
        a: _row(a, 19, sport=Sport.BOYS_HOCKEY, home=("", "USM"), away=("mosinee", "Mosinee")),
        b: _row(
            b,
            19,
            sport=Sport.BOYS_HOCKEY,
            home=("mosinee", "Mosinee"),
            away=("", "USM"),
            venue="@Eagle River Hockey Arena",
        ),
    }
    assert collapse_same_day_duplicates(games) == [a]
    assert games[b].venue == "@Eagle River Hockey Arena"


def test_same_day_rows_with_disagreeing_scores_are_left_alone():
    base = "girls_basketball-2026-11-20-loyal-at-stratford"
    games = {
        base: _row(base, 19, scores=(50, 40)),
        f"{base}-2": _row(f"{base}-2", 19, minute=15, scores=(44, 52)),
    }
    assert collapse_same_day_duplicates(games) == []
    assert len(games) == 2


def test_volleyball_same_day_rematches_are_never_merged():
    base = "volleyball-2026-11-20-loyal-at-stratford"
    games = {
        base: _row(base, 17, sport=Sport.VOLLEYBALL),
        f"{base}-2": _row(f"{base}-2", 19, sport=Sport.VOLLEYBALL),
    }
    assert collapse_same_day_duplicates(games) == []


def test_conference_flag_between_two_different_tables_moves_neither():
    """Edgar (Marawood) at Lakeland (Great Northern), Nov 20 2026: WIAA
    flagged a non-league game "(C)". It counts overall, not in either
    conference table; a flagged game against an untracked school still
    counts (real conferences have members we don't track)."""
    from transform.normalize import _build_standings

    manifest = load_manifest()

    def bb(gid, home, away, hs, as_, conf=True):
        return Game(
            id=gid,
            sport=Sport.GIRLS_BASKETBALL,
            season="2026-27",
            date=datetime(2026, 11, 20, 19, 0, tzinfo=_CENTRAL),
            home=TeamScore(school_id=home[0], name=home[1], score=hs),
            away=TeamScore(school_id=away[0], name=away[1], score=as_),
            status=GameStatus.FINAL,
            conference_game=conf,
        )

    games = [
        bb("g1", ("lakeland", "Lakeland"), ("edgar", "Edgar"), 52, 19),
        bb("g2", ("edgar", "Edgar"), ("", "Some Untracked School"), 60, 40),
    ]
    by_id = {g.id: g for g in games}
    assert clear_cross_table_conference_flags(by_id, manifest, Sport.GIRLS_BASKETBALL) == ["g1"]
    tables = {
        s.conference: {r.school_id: r for r in s.rows}
        for s in _build_standings(
            list(by_id.values()),
            manifest=manifest,
            sport=Sport.GIRLS_BASKETBALL,
            season="2026-27",
        )
    }
    edgar = tables["Marawood"]["edgar"]
    assert (edgar.overall_wins, edgar.overall_losses) == (1, 1)
    assert (edgar.conference_wins, edgar.conference_losses) == (1, 0)
    lakeland = tables["Great Northern"]["lakeland"]
    assert (lakeland.conference_wins, lakeland.conference_losses) == (0, 0)
    assert lakeland.overall_wins == 1


def test_cross_table_flags_are_left_alone_in_sports_not_yet_verified():
    manifest = load_manifest()
    g = Game(
        id="v1",
        sport=Sport.VOLLEYBALL,
        season="2026-27",
        date=datetime(2026, 10, 1, 19, 0, tzinfo=_CENTRAL),
        home=TeamScore(school_id="lakeland", name="Lakeland", score=3),
        away=TeamScore(school_id="edgar", name="Edgar", score=1),
        status=GameStatus.FINAL,
        conference_game=True,
    )
    games = {"v1": g}
    assert clear_cross_table_conference_flags(games, manifest, Sport.VOLLEYBALL) == []
    assert games["v1"].conference_game is True
