"""Live-merge safety tests: the no-downgrade guarantee and reversed-side
score swapping, with the halftime source monkeypatched."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from config.loader import load_manifest
from models.schema import Dataset, Game, GameStatus, Meta, Sport, TeamScore
from sources.halftime import LiveGame
from transform import live

CENTRAL = ZoneInfo("America/Chicago")
GAME_DT = datetime(2026, 9, 4, 19, 0, tzinfo=CENTRAL)


def _game(status: GameStatus, home_score=None, away_score=None) -> Game:
    return Game(
        id="football-2026-09-04-wausau-west-at-wausau-east",
        sport=Sport.FOOTBALL,
        season="2026-27",
        date=GAME_DT,
        home=TeamScore(school_id="wausau-east", name="Wausau East", score=home_score),
        away=TeamScore(school_id="wausau-west", name="Wausau West", score=away_score),
        status=status,
    )


def _dataset(game: Game) -> Dataset:
    return Dataset(
        meta=Meta(
            last_updated=GAME_DT,
            season="2026-27",
            sports_included=[Sport.FOOTBALL],
            sources_used=["wiaa"],
        ),
        schools=[],
        games=[game],
        standings=[],
    )


def _live_row(home_name: str, away_name: str, home_score: int, away_score: int, status: str):
    return LiveGame(
        date=GAME_DT,
        home_name=home_name,
        away_name=away_name,
        home_score=home_score,
        away_score=away_score,
        status=status,
        live_indicator="Q3" if status == "in_progress" else None,
    )


@pytest.fixture(scope="module")
def manifest():
    return load_manifest()


def test_live_upgrades_scheduled_to_in_progress(monkeypatch, manifest):
    row = _live_row("Wausau East", "Wausau West", 14, 7, "in_progress")
    monkeypatch.setattr(live.halftime, "fetch_live", lambda *a, **k: [row])
    dataset, n = live.merge_live_scores(
        _dataset(_game(GameStatus.SCHEDULED)), sport="football", manifest=manifest
    )
    assert n == 1
    game = dataset.games[0]
    assert game.status is GameStatus.IN_PROGRESS
    assert (game.home.score, game.away.score) == (14, 7)
    assert "halftime" in game.sources


def test_live_never_downgrades_final(monkeypatch, manifest):
    row = _live_row("Wausau East", "Wausau West", 14, 7, "in_progress")
    monkeypatch.setattr(live.halftime, "fetch_live", lambda *a, **k: [row])
    dataset, n = live.merge_live_scores(
        _dataset(_game(GameStatus.FINAL, home_score=28, away_score=21)),
        sport="football",
        manifest=manifest,
    )
    assert n == 0
    game = dataset.games[0]
    assert game.status is GameStatus.FINAL
    assert (game.home.score, game.away.score) == (28, 21)


def test_live_reversed_sides_swap_scores(monkeypatch, manifest):
    # WIAA sometimes lists the same matchup with home/away flipped; the
    # merge must map scores back to OUR sides.
    row = _live_row("Wausau West", "Wausau East", 21, 3, "in_progress")
    monkeypatch.setattr(live.halftime, "fetch_live", lambda *a, **k: [row])
    dataset, n = live.merge_live_scores(
        _dataset(_game(GameStatus.SCHEDULED)), sport="football", manifest=manifest
    )
    assert n == 1
    game = dataset.games[0]
    assert (game.home.score, game.away.score) == (3, 21)


def test_live_source_failure_is_a_noop(monkeypatch, manifest):
    def boom(*a, **k):
        raise RuntimeError("halftime down")

    monkeypatch.setattr(live.halftime, "fetch_live", boom)
    dataset, n = live.merge_live_scores(
        _dataset(_game(GameStatus.SCHEDULED)), sport="football", manifest=manifest
    )
    assert n == 0
    assert dataset.games[0].status is GameStatus.SCHEDULED
