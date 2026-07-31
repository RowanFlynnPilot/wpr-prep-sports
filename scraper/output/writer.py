"""
Write the canonical Dataset to JSON files in the data/ directory.

Layout (since the sport-switcher refactor + the payload split):
- schools.json            (top level, cross-sport)
- <sport>/meta.json
- <sport>/games.json      (slim: no stat_leaders; carries headline_stats
                           + stat_line_count instead)
- <sport>/boxscores/<game_id>.json   (full stat_leaders, one per game)
- <sport>/players/<school_id>.json   (per-school player game lines)
- <sport>/standings.json
- <sport>/season_stats.json

schools.json stays at the root because the same school appears across
sports — frontend loads it once regardless of which sport is selected.

The split keeps the dashboard payload small (volleyball's flat
games.json hit 19 MB once MaxPreps box scores landed): game pages
fetch one boxscore file on demand, player pages fetch one school
file. `headline_stats` is the first stat line per (team, category) in
source order — exactly what the recap/ticker/Player-of-the-Week code
read from full stat_leaders before the split, so their behavior is
unchanged. Internally the Game model still carries full stat_leaders;
the writer splits at dump time and `read_dataset` merges back.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from models.schema import Dataset

# Days a power_rankings_prev.json snapshot stays in place before it
# rotates. Matches `transform.rankings.PREV_SNAPSHOT_AGE_DAYS`.
_PREV_SNAPSHOT_AGE_DAYS = 6


def write_dataset(dataset: Dataset, out_dir: Path) -> None:
    """
    Write a sport-scoped dataset.

    `dataset.meta.sports_included` must contain exactly one sport — the
    scraper pipeline is per-sport, so the writer expects per-sport
    Datasets. Schools are written at the root; everything else lands in
    `data/<sport>/`.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    sports = dataset.meta.sports_included
    if len(sports) != 1:
        raise ValueError(
            f"write_dataset expects exactly one sport in meta.sports_included, got {sports}"
        )
    sport_dir = out_dir / sports[0].value
    sport_dir.mkdir(parents=True, exist_ok=True)

    # Cross-sport — written once at the root, overwritten by every sport
    # run with the same payload (the manifest is shared).
    _write_json(
        out_dir / "schools.json",
        [s.model_dump(mode="json") for s in dataset.schools],
    )

    # Per-sport — isolated under data/<sport>/ so multiple sports coexist.
    _write_json(sport_dir / "meta.json", dataset.meta.model_dump(mode="json"))
    _write_split_games(sport_dir, [g.model_dump(mode="json") for g in dataset.games])
    _write_json(
        sport_dir / "standings.json",
        [s.model_dump(mode="json") for s in dataset.standings],
    )
    _write_json(
        sport_dir / "season_stats.json",
        [s.model_dump(mode="json") for s in dataset.season_stats],
    )
    rankings_path = sport_dir / "power_rankings.json"
    prev_path = sport_dir / "power_rankings_prev.json"
    if not dataset.power_rankings:
        # Nothing to publish — REMOVE any existing file rather than leaving
        # it. Skipping the write was meant to protect a hand-edited file,
        # but a hand-edited power ranking isn't a thing, and what it
        # actually protected was last season's table: on rollover the new
        # season has no finals, computes nothing, and the old file survived.
        # Football and volleyball were both serving 2025-26 rankings
        # ("Gilman 12-0") under a 2026-27 heading with zero games played.
        # The frontend fetches this optionally and hides the section when
        # it 404s, so deleting is the honest empty state.
        for stale in (rankings_path, prev_path):
            if stale.exists():
                stale.unlink()
    else:
        # Rotate the comparison snapshot if it's missing or older than
        # PREV_SNAPSHOT_AGE_DAYS. Done BEFORE writing the new file so
        # next run's movement is calculated vs the rankings being
        # replaced now, not vs themselves.
        _maybe_rotate_prev_rankings(rankings_path, prev_path)
        _write_json(
            rankings_path,
            {
                "sport": sports[0].value,
                "season": dataset.meta.season,
                "generated_at": dataset.meta.last_updated.isoformat(),
                "method": _POWER_RANKINGS_METHOD,
                "rankings": [r.model_dump(mode="json") for r in dataset.power_rankings],
            },
        )


def _write_split_games(sport_dir: Path, games: list[dict]) -> None:
    """Write the slim games.json plus the boxscores/ and players/ detail
    files. `games` are full model dumps (stat_leaders inline)."""
    boxscore_dir = sport_dir / "boxscores"
    players_dir = sport_dir / "players"

    slim_games: list[dict] = []
    school_lines: dict[str, list[dict]] = {}
    expected_boxscores: set[str] = set()

    for g in games:
        lines = _drop_exact_duplicates(g.get("stat_leaders") or [])
        slim = {k: v for k, v in g.items() if k != "stat_leaders"}
        slim["headline_stats"] = _headline_stats(lines)
        slim["stat_line_count"] = len(lines)
        slim_games.append(slim)

        if lines:
            expected_boxscores.add(g["id"])
            boxscore_dir.mkdir(parents=True, exist_ok=True)
            _write_json(
                boxscore_dir / f"{g['id']}.json",
                {"game_id": g["id"], "stat_leaders": lines},
                compact=True,
            )
            for line in lines:
                sid = line.get("team_school_id") or ""
                if not sid:
                    continue  # no profile route exists for untracked schools
                school_lines.setdefault(sid, []).append(
                    {"game_id": g["id"], **{k: v for k, v in line.items() if k != "team_school_id"}}
                )

    _write_json(sport_dir / "games.json", slim_games, compact=True)

    for sid, rows in school_lines.items():
        players_dir.mkdir(parents=True, exist_ok=True)
        _write_json(
            players_dir / f"{sid}.json",
            {"school_id": sid, "lines": rows},
            compact=True,
        )

    # Prune detail files for games/schools that vanished from the dataset
    # (rescheduled ids, de-duped games) so stale data can't be fetched.
    _prune_dir(boxscore_dir, expected_boxscores)
    _prune_dir(players_dir, set(school_lines))


def _drop_exact_duplicates(lines: list[dict]) -> list[dict]:
    """Drop byte-identical stat lines (same team, player, category AND
    stats). MaxPreps occasionally emits the same row twice when a player
    appears in two tables of one category block; identical rows can't be
    legitimate and they inflate season aggregation."""
    seen: set[str] = set()
    out: list[dict] = []
    for line in lines:
        key = json.dumps(line, sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
    return out


def _headline_stats(lines: list[dict]) -> list[dict]:
    """First stat line per (team, category) in source order — the subset
    the recap line, score ticker, and Player-of-the-Week picker read.
    Source order puts each category's leader first, so this matches what
    those consumers selected from the full array before the split."""
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for line in lines:
        key = (
            line.get("team_school_id") or line.get("team_name") or "",
            line.get("category") or "",
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
    return out


def _prune_dir(directory: Path, expected_stems: set[str]) -> None:
    if not directory.exists():
        return
    for p in directory.glob("*.json"):
        if p.stem not in expected_stems:
            p.unlink()


def load_full_games_raw(sport_dir: Path) -> list[dict]:
    """Read games.json and merge each game's full stat_leaders back in
    from boxscores/. Tolerates the pre-split layout (stat_leaders still
    inline) so it works against old data checkouts. Strips the
    slim-only fields so the dicts validate cleanly as Game models."""
    games_path = sport_dir / "games.json"
    games = json.loads(games_path.read_text(encoding="utf-8"))
    if not isinstance(games, list):
        games = games.get("games", [])
    boxscore_dir = sport_dir / "boxscores"
    for g in games:
        g.pop("headline_stats", None)
        g.pop("stat_line_count", None)
        if g.get("stat_leaders"):
            continue  # pre-split layout — already inline
        box_path = boxscore_dir / f"{g['id']}.json"
        if box_path.exists():
            box = json.loads(box_path.read_text(encoding="utf-8"))
            g["stat_leaders"] = box.get("stat_leaders", [])
    return games


def _maybe_rotate_prev_rankings(current_path: Path, prev_path: Path) -> None:
    """If `prev_path` is missing or older than the snapshot age, copy
    the current rankings file into prev (atomic-ish: read then write).
    First-ever scrape leaves prev empty — movement fills in on the
    second snapshot."""
    if not current_path.exists():
        return
    rotate = False
    if not prev_path.exists():
        rotate = True
    else:
        try:
            prev_data = json.loads(prev_path.read_text(encoding="utf-8"))
            generated = prev_data.get("generated_at") if isinstance(prev_data, dict) else None
            if generated:
                # ISO 8601 — tolerate both with and without timezone.
                ts = datetime.fromisoformat(generated.replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                age = datetime.now(timezone.utc) - ts
                if age >= timedelta(days=_PREV_SNAPSHOT_AGE_DAYS):
                    rotate = True
            else:
                rotate = True
        except (json.JSONDecodeError, ValueError):
            rotate = True
    if rotate:
        prev_path.write_text(current_path.read_text(encoding="utf-8"), encoding="utf-8")


def load_prev_rankings(sport: str, out_dir: Path) -> dict | None:
    """Read `data/<sport>/power_rankings_prev.json` if it exists.
    Returns the parsed wrapped object (or None) — caller passes this
    directly into `compute_power_rankings(prev_rankings=...)`."""
    p = out_dir / sport / "power_rankings_prev.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


_POWER_RANKINGS_METHOD = "WPR Power Index v1: 40% W%, 35% SOS, 25% margin (capped per sport)"


def _write_json(path: Path, data: object, compact: bool = False) -> None:
    """compact=True drops indentation — used for the machine-read bulk
    files (games, boxscores, players) where pretty-printing costs 40%+
    of the payload; small editor-facing files stay readable."""
    with path.open("w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, separators=(",", ":"), ensure_ascii=False, default=str)
        else:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
        f.write("\n")


def read_dataset(sport: str, out_dir: Path) -> Dataset | None:
    """
    Symmetric reader of write_dataset. Returns None when files don't
    exist (e.g. a sport that hasn't been scraped yet); used by the
    --live fast path which only updates existing data, never seeds it.
    """
    from models.schema import (
        Game,
        Meta,
        PowerRanking,
        School,
        SeasonStat,
        Standing,
    )  # local import to avoid cycles

    sport_dir = out_dir / sport
    if not sport_dir.exists():
        return None
    schools_path = out_dir / "schools.json"
    meta_path = sport_dir / "meta.json"
    games_path = sport_dir / "games.json"
    standings_path = sport_dir / "standings.json"
    season_path = sport_dir / "season_stats.json"
    rankings_path = sport_dir / "power_rankings.json"
    if not (meta_path.exists() and games_path.exists()):
        return None

    def _load(p):
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

    # power_rankings.json wraps its array in an object with metadata
    # (method, generated_at, etc.) — unwrap to a flat list.
    rankings_raw = _load(rankings_path)
    if isinstance(rankings_raw, dict):
        rankings_raw = rankings_raw.get("rankings", [])

    return Dataset(
        meta=Meta(**_load(meta_path)),
        schools=[School(**s) for s in _load(schools_path)],
        games=[Game(**g) for g in load_full_games_raw(sport_dir)],
        standings=[Standing(**s) for s in _load(standings_path)],
        season_stats=[SeasonStat(**r) for r in _load(season_path)],
        power_rankings=[PowerRanking(**r) for r in rankings_raw],
    )
