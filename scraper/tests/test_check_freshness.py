"""Freshness-sentinel tests (scripts/check_freshness.py)."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone

import pytest

from conftest import load_script

cf = load_script("check_freshness")


def _write_meta(data_dir, sport: str, *, age_hours: float, season="2026-27"):
    d = data_dir / sport
    d.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc) - timedelta(hours=age_hours)
    (d / "meta.json").write_text(
        json.dumps({"last_updated": ts.isoformat(), "season": season}), encoding="utf-8"
    )


def _run(monkeypatch, tmp_path, argv: list[str]) -> int:
    monkeypatch.setattr(cf, "DATA_DIR", tmp_path)
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


def test_parse_ts_handles_zulu_and_naive():
    assert cf._parse_ts("2026-07-02T02:51:48Z") is not None
    naive = cf._parse_ts("2026-07-02T02:51:48")
    assert naive is not None and naive.tzinfo is not None
    assert cf._parse_ts("garbage") is None
