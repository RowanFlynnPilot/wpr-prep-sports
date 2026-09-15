"""The homepage mini scoreboard feed (output/writer.py build_mini_feed)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from output.writer import (
    MINI_FEED_FUTURE_DAYS,
    MINI_FEED_PAST_DAYS,
    _write_split_games,
    build_mini_feed,
)

NOW = datetime(2026, 9, 15, 17, 0, tzinfo=timezone.utc)


def _game(gid: str, date: str, **extra) -> dict:
    return {
        "id": gid,
        "sport": "football",
        "season": "2026-27",
        "date": date,
        "status": "final",
        "venue": "@Somewhere",
        "conference_game": True,
        "home": {"school_id": "wausau-east", "name": "Wausau East", "score": 27, "logo_url": "h.png"},
        "away": {"school_id": None, "name": "Lakeland", "score": 22, "logo_url": None},
        "headline_stats": [{"player_name": "X"}],
        "stat_line_count": 4,
        **extra,
    }


def test_window_keeps_recent_and_upcoming_games_only():
    games = [
        _game("too-old", "2026-09-04T12:00:00-05:00"),  # 11 days back
        _game("last-friday", "2026-09-11T19:00:00-05:00"),
        _game("next-friday", "2026-09-18T19:00:00-05:00", status="scheduled"),
        _game("too-far", "2026-10-02T19:00:00-05:00", status="scheduled"),  # 16.5 days out
    ]
    feed = build_mini_feed("football", games, now=NOW)
    assert [g["id"] for g in feed["games"]] == ["last-friday", "next-friday"]
    assert feed["window_days"] == {"past": MINI_FEED_PAST_DAYS, "future": MINI_FEED_FUTURE_DAYS}
    assert feed["generated_at"] == "2026-09-15T17:00:00Z"
    assert feed["sport"] == "football"


def test_games_are_trimmed_to_the_fields_the_mini_renders():
    feed = build_mini_feed("football", [_game("g", "2026-09-11T19:00:00-05:00")], now=NOW)
    (g,) = feed["games"]
    assert set(g) == {"id", "sport", "date", "status", "conference_game", "home", "away"}
    assert g["home"] == {
        "school_id": "wausau-east",
        "name": "Wausau East",
        "score": 27,
        "logo_url": "h.png",
    }
    assert g["away"]["school_id"] is None


def test_sorted_oldest_first_and_bad_dates_skipped():
    games = [
        _game("b", "2026-09-18T19:00:00-05:00"),
        _game("bad", "not a date"),
        _game("a", "2026-09-10T19:00:00-05:00"),
    ]
    feed = build_mini_feed("football", games, now=NOW)
    assert [g["id"] for g in feed["games"]] == ["a", "b"]


def test_every_games_json_write_also_writes_the_feed(tmp_path):
    sport_dir = tmp_path / "football"
    sport_dir.mkdir()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT12:00:00+00:00")
    _write_split_games(sport_dir, [_game("today", today), _game("ancient", "2020-01-01T00:00:00Z")])
    feed = json.loads((sport_dir / "mini.json").read_text(encoding="utf-8"))
    assert [g["id"] for g in feed["games"]] == ["today"]
    assert len(json.loads((sport_dir / "games.json").read_text(encoding="utf-8"))) == 2
