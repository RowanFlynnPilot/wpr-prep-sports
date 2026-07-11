"""Pure-logic tests for transform/normalize.py — result parsing, datetime
defaults, slugs, and the alias table's integrity against the manifest."""

from __future__ import annotations

from config.loader import load_manifest
from models.schema import GameStatus
from transform.normalize import (
    _NAME_ALIASES,
    _build_name_index,
    _parse_datetime,
    _parse_result,
    _slugify,
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


def test_every_alias_points_at_a_manifest_school():
    """Integrity check for the hand-maintained alias table: a typo'd
    target would silently drop every game for that school."""
    manifest = load_manifest()
    ids = {s.id for s in manifest.schools}
    bad = {alias: target for alias, target in _NAME_ALIASES.items() if target not in ids}
    assert not bad, f"aliases pointing at unknown school ids: {bad}"


def test_name_index_resolves_coop_display_names():
    idx = _build_name_index(load_manifest())
    assert idx["d.c. everest co-op"] == "central-wisconsin-storm"
    assert idx["stevens point area"] == "spash"
    assert idx["wausau east"] == "wausau-east"
