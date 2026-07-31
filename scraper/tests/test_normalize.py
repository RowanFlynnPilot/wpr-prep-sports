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
