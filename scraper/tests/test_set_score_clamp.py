"""A posted volleyball score no match can have (4-0 over four listed sets) yields
to the set tally; a merely different but possible score is left alone."""
from datetime import datetime
from zoneinfo import ZoneInfo

from models.schema import Game, GameStatus, Sport, TeamScore
from transform.stats import _attach_set_scores

_CENTRAL = ZoneInfo("America/Chicago")


def _match(home_score, away_score):
    return Game(
        id="volleyball-2026-10-08-away-at-home",
        sport=Sport.VOLLEYBALL,
        season="2026-27",
        date=datetime(2026, 10, 8, 19, 0, tzinfo=_CENTRAL),
        home=TeamScore(school_id="home", name="New Auburn", score=home_score),
        away=TeamScore(school_id="away", name="Flambeau", score=away_score),
        status=GameStatus.FINAL,
    )


def test_impossible_posted_score_takes_the_set_tally():
    game = _match(4, 0)
    _attach_set_scores(game, {"New Auburn": [25, 25, 23, 25], "Flambeau": [20, 18, 25, 16]})
    assert len(game.set_scores) == 4
    assert (game.home.score, game.away.score) == (3, 1)


def test_possible_but_different_score_is_left_alone():
    # The ~20% tournament-day cross-attach: a 2-0 with three sets listed.
    game = _match(2, 0)
    _attach_set_scores(game, {"New Auburn": [25, 22, 25], "Flambeau": [20, 25, 18]})
    assert (game.home.score, game.away.score) == (2, 0)


def test_matching_score_untouched():
    game = _match(3, 1)
    _attach_set_scores(game, {"New Auburn": [25, 25, 23, 25], "Flambeau": [20, 18, 25, 16]})
    assert (game.home.score, game.away.score) == (3, 1)
