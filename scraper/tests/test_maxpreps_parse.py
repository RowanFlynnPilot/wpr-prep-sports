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


# --- tolerant slug matching (transform/stats.py) --------------------------
# MP decorates game-URL slugs unpredictably: co-op partners, cities,
# leftover mascots. Opening week 2026: 8 of 44 finals were undiscoverable
# on exact equality.

from transform.stats import _resolve_mp_slug, _slugs_equivalent  # noqa: E402


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("shawano-community", "shawano"),  # city/district suffix
        ("stanley-boyd-rockets", "stanley-boyd"),  # leftover mascot
        ("mellen", "mellen-co-op"),  # OUR side carries the suffix
        ("chequamegon-park-falls", "chequamegon"),  # city suffix
        ("spencer-columbus", "spencer"),  # co-op partner
        ("dc-everest", "d-c-everest"),  # collapsed-hyphen equality
    ],
)
def test_slugs_equivalent_accepts_mp_variants(a, b):
    assert _slugs_equivalent(a, b)
    assert _slugs_equivalent(b, a)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("wausau-east", "wausau-west"),  # shared prefix, different school
        ("colby", "cornell"),
        ("marion", "marathon"),  # near-miss, no token boundary
        ("st", "stanley-boyd"),  # short-fragment guard
        ("", "shawano"),
    ],
)
def test_slugs_equivalent_rejects_different_schools(a, b):
    assert not _slugs_equivalent(a, b)


def test_resolve_mp_slug_requires_unique_match():
    table = {"shawano": "shawano", "stanley-boyd": "stanley-boyd"}
    assert _resolve_mp_slug("shawano-community", table) == "shawano"
    assert _resolve_mp_slug("shawano", table) == "shawano"  # exact still first
    # Ambiguity means no attach: two tolerant candidates -> "".
    two = {"river-falls": "a", "river": "b"}
    assert _resolve_mp_slug("river-falls-wildcats", two) == ""


def test_resolve_mp_slug_pins_and_denies_known_ambiguity():
    table = {
        "stevens-point": "spash",
        "columbus-catholic": "columbus-catholic",
        "pacelli": "pacelli",
    }
    # "stevens-point-pacelli" tolerant-matches SPASH's slug by prefix —
    # the pin routes it to Pacelli instead.
    assert _resolve_mp_slug("stevens-point-pacelli", table) == "pacelli"
    # Bare "columbus" is Columbus HS (untracked), not Columbus Catholic.
    assert _resolve_mp_slug("columbus", table) == ""
    # Exact matches are unaffected.
    assert _resolve_mp_slug("columbus-catholic", table) == "columbus-catholic"


# --- volleyball new layout (post-Aug-2026 /match/ pages) -------------------
# Volleyball's migration differs from football's on every axis that can
# break silently: the URL segment is /match/ (not /game/), category
# headings are h2 (not h3), and the title reads "X Girls Varsity
# Volleyball vs. Y". The 2026 season opened with 141 finals and ZERO
# stat lines because of exactly these three gaps. Fixture is a trimmed
# real Stats tab (chippewa-falls vs mosinee, 8-25-2026).

VB_FIXTURE = Path(__file__).parent / "fixtures" / "maxpreps_vb_stats_tab.html"


@pytest.fixture
def vb_stats_page(monkeypatch):
    html = VB_FIXTURE.read_text(encoding="utf-8")
    fetched: list[str] = []

    def fake_get(url: str) -> str:
        fetched.append(url)
        return html

    monkeypatch.setattr(maxpreps, "_get", fake_get)
    return fetched


def test_vb_new_layout_parses_all_categories(vb_stats_page):
    box = maxpreps.fetch_box_score(
        "https://www.maxpreps.com/wi/volleyball/match/chippewa-falls-vs-mosinee/8-25-2026/?c=tok",
        sport_path="volleyball",
    )
    by_cat: dict[str, int] = {}
    for line in box.stat_lines:
        by_cat[line.category] = by_cat.get(line.category, 0) + 1
    assert by_cat == {
        "Kills": 5,
        "Serve Aces": 1,
        "Total Blocks": 3,
        "Digs": 2,
        "Assists": 3,
    }
    # Gender word must not leak into the team name.
    assert {line.team_name for line in box.stat_lines} == {"Chippewa Falls"}


def test_vb_match_url_routes_to_new_layout_and_fetches_base_for_sets(vb_stats_page):
    maxpreps.fetch_box_score(
        "https://www.maxpreps.com/wi/volleyball/match/a-vs-b/8-25-2026/?c=tok",
        sport_path="volleyball",
    )
    assert vb_stats_page[0].endswith("&tab=Stats")
    # Second fetch is the base tab, for the Score-by-Set table.
    assert len(vb_stats_page) == 2
    assert "tab=Stats" not in vb_stats_page[1]


def test_vb_match_history_parses_match_urls(monkeypatch):
    html = """
    <a href="https://www.maxpreps.com/wi/volleyball/match/chippewa-falls-vs-mosinee/8-25-2026/?c=abc">box</a>
    <a href="https://www.maxpreps.com/wi/volleyball/match/mosinee-vs-tomahawk/9-30-2025/?c=old">old</a>
    """
    monkeypatch.setattr(maxpreps, "_get", lambda url: html)
    games = maxpreps.fetch_team_match_history(
        "mosinee/mosinee-indians",
        sport_path="volleyball",
        season_year=2026,
        school_slug="mosinee",
    )
    assert len(games) == 1
    assert games[0].date == "2026-08-25"
    assert games[0].opponent == "Chippewa Falls"


def test_varsity_title_strips_gender_word():
    m = maxpreps._VARSITY_TITLE_RE.match("Chippewa Falls Girls Varsity Volleyball vs. Mosinee")
    assert m and m.group("team") == "Chippewa Falls"
    m = maxpreps._VARSITY_TITLE_RE.match("Wausau West Varsity Football @ Menomonie")
    assert m and m.group("team") == "Wausau West"


def test_set_scores_parse_from_base_tab_shape():
    from bs4 import BeautifulSoup

    html = """
    <table><tr><th></th><th>S1</th><th>S2</th><th>Wins</th></tr>
    <tr><td>Chippewa Falls</td><td>17</td><td>21</td><td>0</td></tr>
    <tr><td>Mosinee</td><td>25</td><td>25</td><td>2</td></tr></table>
    """
    sets = maxpreps._parse_set_scores_table(BeautifulSoup(html, "html.parser"))
    assert sets == {"Chippewa Falls": [17, 21], "Mosinee": [25, 25]}
