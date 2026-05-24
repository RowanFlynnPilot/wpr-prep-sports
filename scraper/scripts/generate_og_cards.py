"""
Generate per-game OG share-card PNGs.

Pipeline:
  1. Read each sport's games.json.
  2. Filter to "interesting" games (recent finals + upcoming, or --all).
  3. Boot a chromium browser, navigate to the widget's /card/<sport>/<id>
     route, wait for [data-og-ready], screenshot .og-card → 1200x630 PNG.
  4. Write to data/og/<sport>/<id>.png. Skip when PNG already exists and
     game hasn't changed (status + scores are part of the cache key).

URLs to navigate use the widget's HashRouter so they work whether served
from the Vite dev server or a static `dist/` build behind any prefix.

Usage:
  python scripts/generate_og_cards.py --base-url http://localhost:5173/wpr-prep-sports
  python scripts/generate_og_cards.py --base-url http://localhost:8080/wpr-prep-sports --all
  python scripts/generate_og_cards.py --sport football --base-url http://localhost:5173/wpr-prep-sports
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
OG_DIR = DATA_DIR / "og"

SPORTS = [
    "football",
    "boys_basketball",
    "girls_basketball",
    "volleyball",
    "boys_hockey",
    "girls_hockey",
]

# Default window: include finals in the last 7 days + scheduled games in
# the next 14. Wide enough to cover a typical news cycle, narrow enough
# to keep the PNG set bounded (~50-200 cards at any moment).
DEFAULT_BACKWARD_DAYS = 7
DEFAULT_FORWARD_DAYS = 14


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--base-url",
        required=True,
        help="Where the widget is served. Include the wpr-prep-sports prefix. Example: http://localhost:5173/wpr-prep-sports",
    )
    p.add_argument(
        "--sport",
        action="append",
        help="Limit to one sport (repeatable). Default: all sports.",
    )
    p.add_argument(
        "--all",
        action="store_true",
        help="Regenerate every game, not just the recent-window subset.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after N cards (for smoke testing).",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing PNGs even if the cache key matches.",
    )
    return p.parse_args()


def load_games(sport: str) -> list[dict]:
    path = DATA_DIR / sport / "games.json"
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    return raw if isinstance(raw, list) else raw.get("games", [])


def in_window(game: dict, now: datetime, back: int, forward: int) -> bool:
    """True if the game's date sits within [now-back, now+forward]."""
    iso = game.get("date")
    if not iso:
        return False
    try:
        when = datetime.fromisoformat(iso)
    except ValueError:
        return False
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    delta = when - now
    return -timedelta(days=back) <= delta <= timedelta(days=forward)


def cache_key(game: dict) -> str:
    """Fingerprint of the visible-on-card fields. Changes here mean the
    PNG must be regenerated; status flips final/scheduled and score
    updates are the common triggers."""
    payload = json.dumps(
        {
            "status": game.get("status"),
            "home_score": game.get("home", {}).get("score"),
            "away_score": game.get("away", {}).get("score"),
            "playoff_round": game.get("playoff_round"),
            "date": game.get("date"),
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


def sidecar_path(sport: str, game_id: str) -> Path:
    return OG_DIR / sport / f"{game_id}.cache"


def png_path(sport: str, game_id: str) -> Path:
    return OG_DIR / sport / f"{game_id}.png"


def select_target_games(
    sport: str,
    games: list[dict],
    *,
    all_games: bool,
    window_back: int,
    window_forward: int,
    now: datetime,
) -> list[dict]:
    if all_games:
        return games
    return [g for g in games if in_window(g, now, window_back, window_forward)]


def main() -> int:
    args = parse_args()
    sports = args.sport or SPORTS
    now = datetime.now(tz=timezone.utc)

    OG_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1240, "height": 700})
        page = ctx.new_page()

        total_written = 0
        total_skipped = 0
        total_errors = 0
        total_seen = 0

        for sport in sports:
            games = load_games(sport)
            if not games:
                print(f"[{sport}] no games.json — skipping")
                continue

            targets = select_target_games(
                sport,
                games,
                all_games=args.all,
                window_back=DEFAULT_BACKWARD_DAYS,
                window_forward=DEFAULT_FORWARD_DAYS,
                now=now,
            )
            print(f"[{sport}] {len(targets)}/{len(games)} games in window")

            sport_dir = OG_DIR / sport
            sport_dir.mkdir(parents=True, exist_ok=True)

            for game in targets:
                if args.limit and total_seen >= args.limit:
                    break
                total_seen += 1

                gid = game["id"]
                key = cache_key(game)
                cache_file = sidecar_path(sport, gid)
                out_png = png_path(sport, gid)

                if (
                    not args.force
                    and out_png.exists()
                    and cache_file.exists()
                    and cache_file.read_text().strip() == key
                ):
                    total_skipped += 1
                    continue

                url = f"{args.base_url.rstrip('/')}/#/card/{sport}/{gid}"
                try:
                    page.goto(url, wait_until="networkidle", timeout=20000)
                    page.wait_for_selector("[data-og-ready]", timeout=10000)
                    el = page.query_selector(".og-card")
                    if el is None:
                        raise RuntimeError(".og-card not found after navigation")
                    el.screenshot(path=str(out_png), omit_background=False)
                    cache_file.write_text(key)
                    total_written += 1
                    print(f"  [ok] {gid}")
                except Exception as exc:  # noqa: BLE001
                    total_errors += 1
                    print(f"  [err] {gid} -- {exc}")

            if args.limit and total_seen >= args.limit:
                break

        browser.close()

    print(
        f"\nDone. wrote={total_written} skipped(cache hit)={total_skipped} "
        f"errors={total_errors} considered={total_seen}"
    )
    return 0 if total_errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
