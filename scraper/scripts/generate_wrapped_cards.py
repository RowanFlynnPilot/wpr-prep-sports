"""
Generate "Season Wrapped" share-card PNGs — one per tracked school whose
season is over, per in-season sport.

Pipeline (modelled on generate_og_cards.py):
  1. Read each sport's games.json + meta.json and the school manifest.
  2. Keep sports with games near today (in season or just finished).
  3. For every tracked school in that sport, decide whether its season is
     over: eliminated from the WIAA playoffs (lost its last playoff game),
     finished the playoffs with the bracket complete, or played no playoff
     game and the regular season is behind it (the sport's playoffs have
     begun, or its last game is more than a week old) — and nothing is left
     on its schedule.
  4. Boot chromium, open the widget's /card/wrapped/<sport>/<school> route
     with ?capture=1, wait for [data-wrapped-ready], screenshot
     .wrapped-card → 1080x1920 PNG (9:16; --format og gives 1200x630).
  5. Write data/og/wrapped/<sport>/<school_id>.png. Existing files are
     skipped unless --refresh, so re-running is cheap and idempotent.

URLs use the widget's HashRouter, so they work from the Vite dev server
or a static dist/ build behind any prefix. Runs in CI from scrape.yml's
OG-card step (story + og formats, finished teams only); docs/wrapped-cards.md
has the manual/refresh run.

Usage:
  python scripts/generate_wrapped_cards.py --base-url http://localhost:5173/wpr-prep-sports
  python scripts/generate_wrapped_cards.py --base-url ... --sport football --dry-run
  python scripts/generate_wrapped_cards.py --base-url ... --sport football --school edgar --include-active --refresh
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
OUT_DIR = DATA_DIR / "og" / "wrapped"

# Every sport with a live dataset — keep in step with generate_og_cards.py.
SPORTS = [
    "football",
    "boys_basketball",
    "girls_basketball",
    "volleyball",
    "boys_hockey",
    "girls_hockey",
    "boys_soccer",
    "girls_soccer",
]

# A sport is "in season" for this script when it has a game within this
# many days of today, either side. Wide enough to catch the weeks after a
# state final (when most of these cards get shared) and the opening weeks
# (when nobody's season is over yet, so nothing is written).
SEASON_WINDOW_DAYS = 45

# A team with no playoff games counts as finished once its last game is
# this old and nothing is scheduled — covers a sport whose bracket hasn't
# reached the dataset yet.
REGULAR_SEASON_GRACE_DAYS = 7

VIEWPORTS = {
    "story": {"width": 1140, "height": 1980},
    "og": {"width": 1260, "height": 700},
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--base-url",
        required=True,
        help="Where the widget is served, including the base path. Example: http://localhost:5173/wpr-prep-sports",
    )
    p.add_argument(
        "--sport",
        action="append",
        help="Limit to one sport (repeatable). Default: every sport in season.",
    )
    p.add_argument("--school", action="append", help="Limit to one school id (repeatable).")
    p.add_argument(
        "--format",
        choices=("story", "og"),
        default="story",
        help="story = 1080x1920 (default, <school>.png); og = 1200x630 (<school>-og.png).",
    )
    p.add_argument(
        "--refresh", action="store_true", help="Re-render cards whose PNG already exists."
    )
    p.add_argument(
        "--include-active",
        action="store_true",
        help="Also render schools whose season is still going (previews, smoke tests).",
    )
    p.add_argument("--limit", type=int, default=None, help="Stop after N cards (smoke testing).")
    p.add_argument("--dry-run", action="store_true", help="List what would be rendered and exit.")
    p.add_argument(
        "--route",
        default="/card/wrapped/{sport}/{school_id}",
        help="Hash route template for the card page (default: the top-level App.jsx route).",
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------


def load_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_games(sport: str) -> list[dict]:
    raw = load_json(DATA_DIR / sport / "games.json")
    if raw is None:
        return []
    return raw if isinstance(raw, list) else raw.get("games", [])


def load_schools() -> list[dict]:
    raw = load_json(DATA_DIR / "schools.json") or []
    return raw if isinstance(raw, list) else raw.get("schools", [])


def parse_date(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        when = datetime.fromisoformat(iso)
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when


def current_season_games(games: list[dict], meta: dict | None) -> list[dict]:
    """games.json has occasionally carried a prior season's rows alongside
    the live one; keep only the season meta.json says is live."""
    season = (meta or {}).get("season")
    if not season or not any(g.get("season") for g in games):
        return games
    return [g for g in games if g.get("season") in (season, None)]


def sport_in_window(games: list[dict], now: datetime) -> bool:
    lo = now - timedelta(days=SEASON_WINDOW_DAYS)
    hi = now + timedelta(days=SEASON_WINDOW_DAYS)
    for g in games:
        when = parse_date(g.get("date"))
        if when and lo <= when <= hi:
            return True
    return False


def team_games(games: list[dict], school_id: str) -> list[dict]:
    mine = [
        g
        for g in games
        if g.get("home", {}).get("school_id") == school_id
        or g.get("away", {}).get("school_id") == school_id
    ]
    mine.sort(key=lambda g: g.get("date") or "")
    return mine


def own_and_opp(game: dict, school_id: str) -> tuple[int | None, int | None]:
    is_home = game.get("home", {}).get("school_id") == school_id
    own = (game["home"] if is_home else game["away"]).get("score")
    opp = (game["away"] if is_home else game["home"]).get("score")
    return own, opp


def season_over(
    mine: list[dict], all_games: list[dict], school_id: str, now: datetime
) -> tuple[bool, str]:
    """(done, reason). Mirrors the frontend's notion of a complete season
    (no unplayed game still ahead on the schedule) plus the playoff state
    the bracket helper derives from the last playoff game."""
    finals = [g for g in mine if g.get("status") == "final"]
    if not finals:
        return False, "no results yet"

    for g in mine:
        when = parse_date(g.get("date"))
        if g.get("status") != "final" and when and when > now:
            return False, f"game remaining {when.date()}"

    playoff = [g for g in mine if g.get("playoff")]
    if playoff:
        last = playoff[-1]
        if last.get("status") != "final":
            return False, "playoff result pending"
        own, opp = own_and_opp(last, school_id)
        if own is None or opp is None:
            return False, "playoff score missing"
        rnd = last.get("playoff_round") or "playoffs"
        if own < opp:
            return True, f"eliminated: lost {rnd}"
        bracket_open = any(g.get("playoff") and g.get("status") != "final" for g in all_games)
        if own == opp:
            # WIAA records a shootout as a draw. `last` is our latest playoff
            # game, so no later game exists: while the bracket is open the
            # result is pending; once it has closed, we lost the shootout.
            if bracket_open:
                return False, f"shootout result pending: {rnd}"
            return True, f"eliminated: lost {rnd} on penalty kicks"
        if own > opp:
            if bracket_open:
                return False, f"alive: won {rnd}"
            return True, f"playoffs complete: won {rnd}"

    sport_playoffs_begun = any(g.get("playoff") for g in all_games)
    if sport_playoffs_begun:
        return True, "regular season complete, no playoff games"
    last_when = parse_date(finals[-1].get("date"))
    if last_when and now - last_when > timedelta(days=REGULAR_SEASON_GRACE_DAYS):
        return True, f"no games since {last_when.date()}"
    return False, "regular season in progress"


def png_path(sport: str, school_id: str, fmt: str) -> Path:
    suffix = "-og" if fmt == "og" else ""
    return OUT_DIR / sport / f"{school_id}{suffix}.png"


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

WAIT_FOR_ASSETS_JS = """
() => Promise.race([
  Promise.all([
    document.fonts ? document.fonts.ready : null,
    ...[...document.querySelectorAll('.wrapped-card img')].map((img) =>
      img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })),
  ]),
  new Promise((r) => setTimeout(r, 6000)),
])
"""


def render(page, url: str, out: Path) -> None:
    page.goto(url, wait_until="networkidle", timeout=30000)
    page.wait_for_selector("[data-wrapped-ready]", timeout=15000)
    if page.query_selector("[data-wrapped-error]"):
        msg = page.inner_text("[data-wrapped-error]").replace("\n", " ").strip()
        raise RuntimeError(f"card page reported an error: {msg}")
    page.evaluate(WAIT_FOR_ASSETS_JS)
    el = page.query_selector(".wrapped-card")
    if el is None:
        raise RuntimeError(".wrapped-card not found after navigation")
    out.parent.mkdir(parents=True, exist_ok=True)
    el.screenshot(path=str(out), omit_background=False)


def main() -> int:
    args = parse_args()
    now = datetime.now(tz=timezone.utc)
    sports = args.sport or SPORTS
    wanted_schools = set(args.school or [])
    tracked = {s["id"]: s for s in load_schools()}

    # Decide the target list first so --dry-run needs no browser.
    targets: list[tuple[str, str, str]] = []  # (sport, school_id, reason)
    skipped_existing = 0
    for sport in sports:
        games = load_games(sport)
        if not games:
            print(f"[{sport}] no games.json — skipping")
            continue
        meta = load_json(DATA_DIR / sport / "meta.json")
        games = current_season_games(games, meta)
        if not args.sport and not sport_in_window(games, now):
            print(f"[{sport}] no games within {SEASON_WINDOW_DAYS} days of today — skipping")
            continue

        ids = sorted(
            {
                sid
                for g in games
                for sid in (g.get("home", {}).get("school_id"), g.get("away", {}).get("school_id"))
                if sid and sid in tracked
            }
        )
        done = 0
        for sid in ids:
            if wanted_schools and sid not in wanted_schools:
                continue
            mine = team_games(games, sid)
            over, reason = season_over(mine, games, sid, now)
            if not over and not args.include_active:
                continue
            done += 1
            if png_path(sport, sid, args.format).exists() and not args.refresh:
                skipped_existing += 1
                continue
            targets.append((sport, sid, reason))
        print(f"[{sport}] {done}/{len(ids)} tracked schools finished; {len(targets)} queued so far")

    if args.limit:
        targets = targets[: args.limit]

    if args.dry_run:
        for sport, sid, reason in targets:
            print(f"  would render {sport}/{sid}  ({reason})")
        print(f"\n{len(targets)} to render, {skipped_existing} already on disk.")
        return 0

    if not targets:
        print(
            f"\nNothing to render ({skipped_existing} already on disk; --refresh re-renders them)."
        )
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = errors = 0
    consecutive_errors = 0
    CONSECUTIVE_ERROR_LIMIT = 8  # same circuit breaker as the OG generator

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport=VIEWPORTS[args.format], device_scale_factor=1)
        page = ctx.new_page()
        base = args.base_url.rstrip("/")
        for sport, sid, reason in targets:
            route = args.route.format(sport=sport, school_id=sid)
            # ?theme=light pins the light palette; ?capture=1 drops the hub
            # toolbar and renders the card at its native pixel size.
            query = "theme=light&capture=1" + ("&format=og" if args.format == "og" else "")
            url = f"{base}/?{query}#{route}"
            out = png_path(sport, sid, args.format)
            try:
                render(page, url, out)
                written += 1
                consecutive_errors = 0
                print(f"  [ok] {sport}/{sid}  ({reason})")
            except Exception as exc:  # noqa: BLE001
                errors += 1
                consecutive_errors += 1
                print(f"  [err] {sport}/{sid} -- {exc}")
                if consecutive_errors >= CONSECUTIVE_ERROR_LIMIT:
                    print(
                        f"\n{consecutive_errors} consecutive failures with no successes — the card "
                        "page itself is broken (route not mounted? base path vs serve prefix?). "
                        "Aborting."
                    )
                    browser.close()
                    return 1
        browser.close()

    print(
        f"\nDone. wrote={written} skipped(existing)={skipped_existing} errors={errors} "
        f"→ {OUT_DIR.relative_to(REPO_ROOT)}/<sport>/<school_id>{'-og' if args.format == 'og' else ''}.png"
    )
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
