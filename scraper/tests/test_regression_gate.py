"""Coverage-regression gate tests (scripts/validate_data.py). The git
side is monkeypatched: `_git_show_json` serves the "HEAD" state from a
dict, the tmp dir on disk is the "working tree" state."""

from __future__ import annotations

import json

import pytest

from conftest import load_script

vd = load_script("validate_data")


def _slim_game(i: int, status: str = "final", lines: int = 3) -> dict:
    return {
        "id": f"g{i}",
        "sport": "football",
        "season": "2026-27",
        "date": "2026-09-04T19:00:00-05:00",
        "home": {"school_id": "a", "name": "A", "score": 21},
        "away": {"school_id": "b", "name": "B", "score": 7},
        "status": status,
        "stat_line_count": lines,
    }


def _write_sport(tmp_path, *, games, standings=None, season_stats=None, season="2026-27"):
    sport_dir = tmp_path / "football"
    sport_dir.mkdir(exist_ok=True)
    (sport_dir / "meta.json").write_text(json.dumps({"season": season}), encoding="utf-8")
    (sport_dir / "games.json").write_text(json.dumps(games), encoding="utf-8")
    (sport_dir / "standings.json").write_text(json.dumps(standings or []), encoding="utf-8")
    (sport_dir / "season_stats.json").write_text(json.dumps(season_stats or []), encoding="utf-8")
    return sport_dir


def _fake_head(monkeypatch, head: dict):
    monkeypatch.setattr(vd, "_git_show_json", lambda rel: head.get(rel))


STANDINGS = [{"sport": "football", "conference": "X", "rows": [{"school_id": "a"}] * 8}]
SEASON_STATS = [{"school_id": "a", "category": "Passing", "player_name": "P"}] * 40


def test_identical_state_passes(tmp_path, monkeypatch):
    games = [_slim_game(i) for i in range(40)]
    sport_dir = _write_sport(tmp_path, games=games, standings=STANDINGS, season_stats=SEASON_STATS)
    _fake_head(
        monkeypatch,
        {
            "data/football/meta.json": {"season": "2026-27"},
            "data/football/games.json": games,
            "data/football/standings.json": STANDINGS,
            "data/football/season_stats.json": SEASON_STATS,
        },
    )
    assert vd.check_regression(sport_dir) == []


def test_games_collapse_fails(tmp_path, monkeypatch):
    sport_dir = _write_sport(tmp_path, games=[_slim_game(i) for i in range(5)])
    _fake_head(
        monkeypatch,
        {
            "data/football/meta.json": {"season": "2026-27"},
            "data/football/games.json": [_slim_game(i) for i in range(40)],
        },
    )
    errors = vd.check_regression(sport_dir)
    assert any("games collapsed" in e for e in errors)


def test_small_baseline_never_trips(tmp_path, monkeypatch):
    # Preseason noise: 10 -> 2 games is under the baseline minimum.
    sport_dir = _write_sport(tmp_path, games=[_slim_game(i) for i in range(2)])
    _fake_head(
        monkeypatch,
        {
            "data/football/meta.json": {"season": "2026-27"},
            "data/football/games.json": [_slim_game(i) for i in range(10)],
        },
    )
    assert vd.check_regression(sport_dir) == []


def test_stat_lines_zeroing_fails(tmp_path, monkeypatch):
    sport_dir = _write_sport(tmp_path, games=[_slim_game(i, lines=0) for i in range(40)])
    _fake_head(
        monkeypatch,
        {
            "data/football/meta.json": {"season": "2026-27"},
            "data/football/games.json": [_slim_game(i, lines=5) for i in range(40)],
        },
    )
    errors = vd.check_regression(sport_dir)
    assert any("stat lines collapsed" in e for e in errors)


def test_season_rollover_skips_all_checks(tmp_path, monkeypatch):
    sport_dir = _write_sport(
        tmp_path, games=[_slim_game(0, status="scheduled", lines=0)], season="2026-27"
    )
    _fake_head(
        monkeypatch,
        {
            "data/football/meta.json": {"season": "2025-26"},
            "data/football/games.json": [_slim_game(i, lines=5) for i in range(300)],
            "data/football/standings.json": STANDINGS,
            "data/football/season_stats.json": SEASON_STATS,
        },
    )
    assert vd.check_regression(sport_dir) == []


def test_standings_emptied_fails(tmp_path, monkeypatch):
    games = [_slim_game(i) for i in range(40)]
    sport_dir = _write_sport(tmp_path, games=games, standings=[])
    _fake_head(
        monkeypatch,
        {
            "data/football/meta.json": {"season": "2026-27"},
            "data/football/games.json": games,
            "data/football/standings.json": STANDINGS,
        },
    )
    errors = vd.check_regression(sport_dir)
    assert any("standings emptied" in e for e in errors)


def test_season_stats_emptied_with_finals_fails(tmp_path, monkeypatch):
    games = [_slim_game(i) for i in range(40)]
    sport_dir = _write_sport(tmp_path, games=games, season_stats=[])
    _fake_head(
        monkeypatch,
        {
            "data/football/meta.json": {"season": "2026-27"},
            "data/football/games.json": games,
            "data/football/season_stats.json": SEASON_STATS,
        },
    )
    errors = vd.check_regression(sport_dir)
    assert any("season_stats emptied" in e for e in errors)


def test_season_stats_empty_preseason_passes(tmp_path, monkeypatch):
    # No finals yet -> an empty season_stats is legitimate (the 2026-07-08
    # post-rollover reset, not an outage).
    games = [_slim_game(i, status="scheduled", lines=0) for i in range(40)]
    sport_dir = _write_sport(tmp_path, games=games, season_stats=[])
    _fake_head(
        monkeypatch,
        {
            "data/football/meta.json": {"season": "2026-27"},
            "data/football/games.json": games,
            "data/football/season_stats.json": SEASON_STATS,
        },
    )
    assert vd.check_regression(sport_dir) == []


def test_missing_head_state_skips(tmp_path, monkeypatch):
    sport_dir = _write_sport(tmp_path, games=[_slim_game(0)])
    _fake_head(monkeypatch, {})
    assert vd.check_regression(sport_dir) == []
