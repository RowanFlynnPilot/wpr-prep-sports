"""Bound leader-card pair folding (sources/bound.py:card_stats)."""

from sources.bound import card_stats


def test_two_way_receiving_card_keeps_own_tds_and_drops_cross_reference():
    # Will Wojcik, Medford at Rhinelander 2026-09-04: 1 catch for 41, 0 TD,
    # then Bound's appended rushing cross-reference (255 yds, 5 TD).
    pairs = [("REC", "1"), ("YDS", "41"), ("TDS", "0"), ("RUS", "255"), ("TDS", "5")]
    assert card_stats(pairs) == {"REC": "1", "YDS": "41", "TDS": "0"}


def test_two_way_rushing_card_keeps_own_tds_and_drops_cross_reference():
    # Chase Heeg, Stanley-Boyd at Colby 2026-08-21: 14-118-1 rushing, then
    # the receiving cross-reference (106 yds, 2 TD).
    pairs = [("ATT", "14"), ("YDS", "118"), ("TDS", "1"), ("REC", "106"), ("TDS", "2")]
    assert card_stats(pairs) == {"ATT": "14", "YDS": "118", "TDS": "1"}


def test_single_role_card_is_unchanged():
    pairs = [("ATT", "17"), ("YDS", "255"), ("TDS", "5")]
    assert card_stats(pairs) == {"ATT": "17", "YDS": "255", "TDS": "5"}


def test_repeat_without_foreign_lead_in_keeps_first_value():
    # Defensive: if a label repeats with no foreign yardage key before it,
    # keep the first occurrence rather than letting the tail overwrite.
    pairs = [("TKL", "9"), ("TDS", "1"), ("TDS", "2")]
    assert card_stats(pairs) == {"TKL": "9", "TDS": "1"}


def test_empty_card():
    assert card_stats([]) == {}
