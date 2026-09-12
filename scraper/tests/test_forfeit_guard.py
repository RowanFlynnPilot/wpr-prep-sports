"""Forfeit-coded finals never carry stat lines (transform/stats.py)."""

import pytest

from transform.stats import is_forfeit_score


@pytest.mark.parametrize(
    "sport,home,away",
    [
        ("football", 0, 1),
        ("football", 2, 0),
        ("football", 0, 2),
        ("boys_basketball", 1, 0),
        ("girls_basketball", 0, 2),
    ],
)
def test_wiaa_forfeit_codes(sport, home, away):
    assert is_forfeit_score(sport, home, away)


@pytest.mark.parametrize(
    "sport,home,away",
    [
        ("football", 21, 14),
        ("football", 2, 2),  # not a code: no zero side
        ("football", 3, 0),  # a real shutout by field goal
        ("football", None, 0),
        ("volleyball", 2, 0),  # real 2-0 sweep
        ("boys_soccer", 1, 0),  # real 1-0 result
        ("boys_hockey", 1, 0),
    ],
)
def test_real_results_and_other_sports_are_not_forfeits(sport, home, away):
    assert not is_forfeit_score(sport, home, away)
