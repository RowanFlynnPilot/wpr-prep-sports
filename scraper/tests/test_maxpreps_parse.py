"""MaxPreps parser tests — the post-Aug-2026 page format.

MaxPreps' platform migration (the WisSports transition) replaced both
the box-score URL scheme and the page markup mid-season, and the parser
had zero test coverage — so discovery silently returned nothing for a
month before opening week made it visible. These tests pin the new
format; the fixture is a trimmed real Stats-tab page (Wausau West @
Menomonie, 2026-08-20).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from sources import maxpreps

FIXTURE = Path(__file__).parent / "fixtures" / "maxpreps_stats_tab.html"


@pytest.fixture
def stats_page(monkeypatch):
    html = FIXTURE.read_text(encoding="utf-8")
    fetched: list[str] = []

    def fake_get(url: str) -> str:
        fetched.append(url)
        return html

    monkeypatch.setattr(maxpreps, "_get", fake_get)
    return fetched


def test_new_layout_box_score_parses_all_categories(stats_page):
    box = maxpreps.fetch_box_score(
        "https://www.maxpreps.com/wi/football/game/menomonie-vs-wausau-west/8-20-2026/?c=tok",
        sport_path="football",
    )
    by_cat: dict[str, int] = {}
    for line in box.stat_lines:
        by_cat[line.category] = by_cat.get(line.category, 0) + 1
    assert by_cat == {
        "Passing Yards": 1,
        "Rushing Yards": 5,
        "Receiving Yards": 3,
        "Total Tackles": 19,
    }
    # Every line belongs to the page's team (the h2 prefix).
    assert {line.team_name for line in box.stat_lines} == {"Wausau West"}


def test_new_layout_fetches_the_stats_tab(stats_page):
    maxpreps.fetch_box_score(
        "https://www.maxpreps.com/wi/football/game/a-vs-b/8-20-2026/?c=tok",
        sport_path="football",
    )
    assert stats_page[0].endswith("&tab=Stats")


def test_new_layout_recovers_full_names_from_athlete_links(stats_page):
    """Display names are abbreviated ('J. Riley'); player pages key on
    the full name, which only the athlete href slug carries."""
    box = maxpreps.fetch_box_score(
        "https://www.maxpreps.com/wi/football/game/a-vs-b/8-20-2026/?c=tok",
        sport_path="football",
    )
    passer = next(line for line in box.stat_lines if line.category == "Passing Yards")
    assert passer.player_name == "Jackson Riley"
    assert passer.player_year == "SR"
    assert passer.stats["Yds"] == "19"


def test_new_layout_skips_team_totals_row(stats_page):
    box = maxpreps.fetch_box_score(
        "https://www.maxpreps.com/wi/football/game/a-vs-b/8-20-2026/?c=tok",
        sport_path="football",
    )
    assert not any("Totals" in line.player_name for line in box.stat_lines)


def test_match_history_parses_new_url_format(monkeypatch):
    html = """
    <a href="/wi/football/game/menomonie-vs-wausau-west/8-20-2026/?c=abc123">box</a>
    <a href="/wi/football/game/rice-lake-vs-wausau-west/8-28-2026/?c=def456">box</a>
    <a href="/wi/football/game/wausau-east-vs-wausau-west/10-6-2023/?c=old999">old season</a>
    """
    monkeypatch.setattr(maxpreps, "_get", lambda url: html)
    games = maxpreps.fetch_team_match_history(
        "wausau/wausau-west-warriors",
        sport_path="football",
        season_year=2026,
        school_slug="wausau-west",
    )
    assert len(games) == 2  # 2023 filtered out by season_year
    by_date = {g.date: g for g in games}
    assert by_date["2026-08-20"].opponent == "Menomonie"
    assert by_date["2026-08-28"].opponent == "Rice Lake"
    # New URLs are absolute after discovery.
    assert all(g.box_score_url.startswith("https://www.maxpreps.com/wi/") for g in games)


def test_match_history_still_parses_legacy_urls(monkeypatch):
    html = (
        '<a href="https://www.maxpreps.com/games/10-24-2025/football-25/'
        'arrowhead-vs-wausau-west.htm?c=legacy1">box</a>'
    )
    monkeypatch.setattr(maxpreps, "_get", lambda url: html)
    games = maxpreps.fetch_team_match_history(
        "wausau/wausau-west-warriors",
        sport_path="football",
        season_year=2025,
        school_slug="wausau-west",
    )
    assert len(games) == 1
    assert games[0].date == "2025-10-24"
    assert games[0].opponent == "Arrowhead"
    assert games[0].home is True  # legacy URLs are away-vs-home
