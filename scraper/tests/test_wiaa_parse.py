"""WIAA parser tests against saved fixtures (tests/fixtures/). These are
the tripwire for markup drift: when WIAA changes its grid HTML, these
fail in CI instead of the scrape silently returning 0 rows in prod."""

from __future__ import annotations

import json
import re

import pytest

from conftest import FIXTURE_DIR
from config.loader import load_manifest
from models.schema import Sport
from sources import wiaa
from transform.normalize import _raw_to_game, build_name_index_for_manifest

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@pytest.fixture(scope="module")
def schedule_meta() -> dict:
    return json.loads((FIXTURE_DIR / "wiaa_schedule.meta.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def schedule(schedule_meta) -> dict:
    html = (FIXTURE_DIR / "wiaa_schedule.html").read_text(encoding="utf-8")
    return wiaa.parse_team_schedule_html(html, schedule_meta["team_id"])


def test_search_org_fixture_shape():
    results = json.loads((FIXTURE_DIR / "wiaa_search_org.json").read_text(encoding="utf-8"))
    assert isinstance(results, list) and results
    assert any(int(r.get("OrganizationID") or 0) > 0 for r in results)
    assert any(r.get("OrgName") for r in results)


def test_directory_page_yields_team_entries():
    html = (FIXTURE_DIR / "wiaa_directory_school.html").read_text(encoding="utf-8")
    entries = wiaa.parse_team_entries_html(html)
    assert entries, "no tr.gridTableRow team rows parsed — markup drift?"
    for e in entries:
        assert e.team_id > 0
        assert e.ssid > 0
        assert e.sport_name
    # The label fallback is what survives SSID rotation — it must keep
    # matching at least the sport this fixture was captured for.
    assert any(wiaa._label_matches("football", e.sport_name) for e in entries)


def test_schedule_header_parse(schedule, schedule_meta):
    assert schedule["team_id"] == schedule_meta["team_id"]
    assert schedule["school_name"]


def test_schedule_rows_parse(schedule):
    games = schedule["games"]
    assert len(games) >= 5, f"only {len(games)} game rows parsed — markup drift?"
    for g in games:
        assert DATE_RE.match(g["date"]), g
        assert isinstance(g["home"]["name"], str) and g["home"]["name"]
        assert isinstance(g["away"]["name"], str) and g["away"]["name"]
        assert isinstance(g["conference_game"], bool)
        assert g["result"] is None or isinstance(g["result"], str)


def test_schedule_rows_normalize_into_games(schedule, schedule_meta):
    """End-to-end: raw fixture rows must survive transform/normalize into
    Game models (the shape the writer + frontend depend on)."""
    manifest = load_manifest()
    name_to_id = build_name_index_for_manifest(manifest)
    sport = Sport(schedule_meta["sport"])

    built = []
    for raw in schedule["games"]:
        game = _raw_to_game(
            raw,
            sport=sport,
            season="test",
            owner_school_id=schedule_meta["school_id"],
            name_to_id=name_to_id,
        )
        if game is not None:
            built.append(game)

    assert len(built) >= 5
    for game in built:
        assert game.id.startswith(f"{sport.value}-")
        assert game.date.tzinfo is not None
        assert game.home.name and game.away.name
    # The fixture school itself must resolve on one side of its own games.
    assert any(schedule_meta["school_id"] in (g.home.school_id, g.away.school_id) for g in built)
