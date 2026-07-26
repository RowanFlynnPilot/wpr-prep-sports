"""Freshness-sentinel tests (scripts/check_freshness.py)."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone


from conftest import load_script

cf = load_script("check_freshness")


def _write_meta(data_dir, sport: str, *, age_hours: float, season="2026-27"):
    d = data_dir / sport
    d.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc) - timedelta(hours=age_hours)
    (d / "meta.json").write_text(
        json.dumps({"last_updated": ts.isoformat(), "season": season}), encoding="utf-8"
    )


def _write_manifest(tmp_path, roster: dict[str, int]):
    """Manifest with `count` schools per sport, ids '<sport>-0', '<sport>-1', ..."""
    schools = []
    for sport, count in roster.items():
        for i in range(count):
            schools.append(
                {
                    "id": f"{sport}-{i}",
                    "name": f"{sport} {i}",
                    "conferences": [{"sport": sport, "conference": "Test"}],
                }
            )
    path = tmp_path / "schools.json"
    path.write_text(json.dumps({"schools": schools}), encoding="utf-8")
    return path


def _write_games(data_dir, sport: str, *, school_ids: list[str]):
    """One game per id, pairing it against an untracked opponent."""
    d = data_dir / sport
    d.mkdir(parents=True, exist_ok=True)
    games = [
        {
            "id": f"{sport}-g{i}",
            "home": {"school_id": sid, "name": sid},
            "away": {"school_id": "", "name": "Untracked Opponent"},
        }
        for i, sid in enumerate(school_ids)
    ]
    (d / "games.json").write_text(json.dumps(games), encoding="utf-8")


def _run(monkeypatch, tmp_path, argv: list[str], manifest=None) -> int:
    monkeypatch.setattr(cf, "DATA_DIR", tmp_path)
    # Default: no manifest on disk, so the coverage check skips and the
    # freshness-only tests below stay unaffected.
    monkeypatch.setattr(cf, "MANIFEST_PATH", manifest or (tmp_path / "no-manifest.json"))
    monkeypatch.setattr(sys, "argv", ["check_freshness.py", *argv])
    return cf.main()


def test_fresh_in_season_passes(tmp_path, monkeypatch):
    _write_meta(tmp_path, "football", age_hours=2)
    _write_meta(tmp_path, "volleyball", age_hours=2)
    _write_meta(tmp_path, "boys_soccer", age_hours=2)
    assert _run(monkeypatch, tmp_path, ["--month", "9"]) == 0


def test_stale_in_season_fails(tmp_path, monkeypatch):
    _write_meta(tmp_path, "football", age_hours=200)
    _write_meta(tmp_path, "volleyball", age_hours=2)
    _write_meta(tmp_path, "boys_soccer", age_hours=2)
    assert _run(monkeypatch, tmp_path, ["--month", "9"]) == 1


def test_off_season_staleness_ignored(tmp_path, monkeypatch):
    # July: nothing is in season, however old the data is.
    _write_meta(tmp_path, "football", age_hours=5000)
    assert _run(monkeypatch, tmp_path, ["--month", "7"]) == 0


def test_missing_meta_for_in_season_sport_fails(tmp_path, monkeypatch):
    _write_meta(tmp_path, "football", age_hours=2)
    # volleyball + boys_soccer in-season but absent from data/
    assert _run(monkeypatch, tmp_path, ["--month", "9"]) == 1


def test_threshold_flag_respected(tmp_path, monkeypatch):
    _write_meta(tmp_path, "football", age_hours=100)
    _write_meta(tmp_path, "volleyball", age_hours=100)
    _write_meta(tmp_path, "boys_soccer", age_hours=100)
    assert _run(monkeypatch, tmp_path, ["--month", "9"]) == 0  # default 168h
    assert _run(monkeypatch, tmp_path, ["--month", "9", "--max-age-hours", "48"]) == 1


# --- coverage check ------------------------------------------------------
# Regression guard for the July 2026 boys-soccer collapse: 384 games -> 1
# across a season rollover, which stayed green because the scrape succeeded
# daily (so freshness passed), the wipe guard needs *zero* games to trip, and
# validate_data.py skips its regression comparison whenever meta.season
# changes — which is exactly when a rollover collapse happens.


def test_thin_coverage_fails_even_when_data_is_fresh(tmp_path, monkeypatch):
    manifest = _write_manifest(tmp_path, {"boys_soccer": 21})
    for sport in ("football", "volleyball", "boys_soccer"):
        _write_meta(tmp_path, sport, age_hours=1)
    # 1 of 21 tracked schools — the exact shape of the July 2026 collapse.
    _write_games(tmp_path, "boys_soccer", school_ids=["boys_soccer-0"])
    assert _run(monkeypatch, tmp_path, ["--month", "9"], manifest=manifest) == 1


def test_healthy_coverage_passes(tmp_path, monkeypatch):
    manifest = _write_manifest(tmp_path, {"boys_soccer": 21})
    for sport in ("football", "volleyball", "boys_soccer"):
        _write_meta(tmp_path, sport, age_hours=1)
    _write_games(tmp_path, "boys_soccer", school_ids=[f"boys_soccer-{i}" for i in range(20)])
    assert _run(monkeypatch, tmp_path, ["--month", "9"], manifest=manifest) == 0


def test_partial_rollover_above_floor_passes(tmp_path, monkeypatch):
    """Volleyball sat at 44% mid-publish in July 2026 and was filling normally —
    the floor must not nag about a season that's legitimately still posting."""
    manifest = _write_manifest(tmp_path, {"volleyball": 34})
    for sport in ("football", "volleyball", "boys_soccer"):
        _write_meta(tmp_path, sport, age_hours=1)
    _write_games(tmp_path, "volleyball", school_ids=[f"volleyball-{i}" for i in range(15)])
    assert _run(monkeypatch, tmp_path, ["--month", "9"], manifest=manifest) == 0


def test_coverage_floor_flag_respected(tmp_path, monkeypatch):
    manifest = _write_manifest(tmp_path, {"volleyball": 34})
    for sport in ("football", "volleyball", "boys_soccer"):
        _write_meta(tmp_path, sport, age_hours=1)
    _write_games(tmp_path, "volleyball", school_ids=[f"volleyball-{i}" for i in range(15)])
    # 44% passes the default third, fails a stricter floor, and --min-coverage 0
    # disables the check entirely.
    assert _run(monkeypatch, tmp_path, ["--month", "9"], manifest=manifest) == 0
    assert (
        _run(
            monkeypatch,
            tmp_path,
            ["--month", "9", "--min-coverage", "0.6"],
            manifest=manifest,
        )
        == 1
    )
    assert (
        _run(
            monkeypatch,
            tmp_path,
            ["--month", "9", "--min-coverage", "0"],
            manifest=manifest,
        )
        == 0
    )


def test_coverage_skips_when_inputs_unavailable(tmp_path, monkeypatch):
    """Conservative by design: no manifest, or no games.json, is a skip.
    Freshness owns 'the dataset is missing'."""
    manifest = _write_manifest(tmp_path, {"boys_soccer": 21})
    for sport in ("football", "volleyball", "boys_soccer"):
        _write_meta(tmp_path, sport, age_hours=1)
    # No games.json written for any sport.
    assert _run(monkeypatch, tmp_path, ["--month", "9"], manifest=manifest) == 0
    # Manifest absent entirely.
    assert _run(monkeypatch, tmp_path, ["--month", "9"]) == 0


def test_coverage_counts_a_school_on_either_side(tmp_path, monkeypatch):
    manifest = _write_manifest(tmp_path, {"boys_soccer": 4})
    monkeypatch.setattr(cf, "DATA_DIR", tmp_path)
    monkeypatch.setattr(cf, "MANIFEST_PATH", manifest)
    (tmp_path / "boys_soccer").mkdir(parents=True, exist_ok=True)
    (tmp_path / "boys_soccer" / "games.json").write_text(
        json.dumps(
            [
                {
                    "id": "g1",
                    "home": {"school_id": "boys_soccer-0"},
                    "away": {"school_id": "boys_soccer-1"},
                },
                {
                    "id": "g2",
                    "home": {"school_id": "boys_soccer-2"},
                    "away": {"school_id": "boys_soccer-3"},
                },
            ]
        ),
        encoding="utf-8",
    )
    assert cf.check_coverage("boys_soccer", 1.0) is None


def test_parse_ts_handles_zulu_and_naive():
    assert cf._parse_ts("2026-07-02T02:51:48Z") is not None
    naive = cf._parse_ts("2026-07-02T02:51:48")
    assert naive is not None and naive.tzinfo is not None
    assert cf._parse_ts("garbage") is None
