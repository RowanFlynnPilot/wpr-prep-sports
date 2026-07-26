"""
Mirror school logos locally instead of hotlinking WIAA on every pageview.

Why
---
Every dashboard render pulls one image per school straight from
schools.wiaawi.org — 125 distinct logo URLs in the football dataset alone,
measured at a ~200ms median on broadband with warm DNS. Three problems:

1. Speed. Those are cross-origin requests to a state association's ASP.NET
   directory server, not a CDN. On the rural and mobile connections much of
   this audience reads on, that is the slowest thing on the page.
2. Reliability. TeamLogo already carries an onError monogram fallback with
   the comment "WIAA's CDN is occasionally flaky" — so a WIAA blip today
   silently degrades every logo on the site.
3. Politeness. The scraper is scrupulous about rate-limiting itself, then
   the frontend sends every reader's browser at the same server ~100 times
   per pageview. On a Friday night that is real load on someone else's
   infrastructure, and a good way to get hotlink-blocked.

Mirrored files are served same-origin off the Pages CDN, HTTP/2
multiplexed, with hashed-asset caching.

Output
------
  frontend/public/logos/<school-id>.<ext>   the images
  frontend/src/config/logoManifest.json     { school-id: filename }

The manifest is imported at build time (Vite inlines JSON), so this costs
no extra runtime request. TeamLogo walks local -> WIAA -> monogram, so a
school missing here simply behaves exactly as it does today.

Usage
-----
  cd scraper
  python scripts/mirror_logos.py            # skips files already present
  python scripts/mirror_logos.py --refresh  # re-download everything

Logos change rarely, so this is a deliberate on-demand script rather than
part of every scrape — it keeps binary churn out of the data commits.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
LOGO_DIR = REPO_ROOT / "frontend" / "public" / "logos"
MANIFEST = REPO_ROOT / "frontend" / "src" / "config" / "logoManifest.json"
OVERRIDES_JS = REPO_ROOT / "frontend" / "src" / "config" / "logoOverrides.js"

USER_AGENT = "wpr-prep-sports/0.1 (+https://sports.wausaupilotandreview.com)"
# Same courtesy pause the scraper uses for WIAA (main.py POLITE_DELAY_SECONDS).
POLITE_DELAY_SECONDS = 0.4
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp"}


def collect_logo_urls() -> dict[str, str]:
    """school_id -> WIAA logo URL, harvested from every sport's games.

    Mirrors what utils/schools.js indexSchools() does in the frontend: the
    logo lives on the game side, not on the school record.
    """
    found: dict[str, str] = {}
    for games_path in sorted(DATA_DIR.glob("*/games.json")):
        try:
            games = json.loads(games_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for game in games:
            if not isinstance(game, dict):
                continue
            for side in ("home", "away"):
                s = game.get(side) or {}
                sid, url = s.get("school_id"), s.get("logo_url")
                if sid and url and sid not in found:
                    found[sid] = url
    return found


def overridden_school_ids() -> set[str]:
    """School ids with a hand-made crest in logoOverrides.js.

    These MUST be skipped. A co-op like the Central Wisconsin Storm is
    registered under a host school's WIAA org, so its games carry the host's
    mark — mirroring it would write D.C. Everest's logo to
    central-wisconsin-storm.jpg. The override still wins at render time, but
    the mirrored file would be a wrong, confusing artefact on disk.
    """
    try:
        text = OVERRIDES_JS.read_text(encoding="utf-8")
    except OSError:
        return set()
    block = re.search(r"LOGO_OVERRIDES\s*=\s*\{(.*?)\}", text, re.DOTALL)
    if not block:
        return set()
    return set(re.findall(r'"([a-z0-9-]+)"\s*:', block.group(1)))


def extension_for(url: str) -> str:
    ext = Path(url.split("?")[0]).suffix.lower()
    return ext if ext in ALLOWED_EXT else ".jpg"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--refresh", action="store_true", help="re-download files already present")
    args = p.parse_args()

    urls = collect_logo_urls()
    if not urls:
        print("No logo URLs found in data/*/games.json — nothing to mirror.", file=sys.stderr)
        return 1

    overrides = overridden_school_ids()
    for sid in sorted(overrides & urls.keys()):
        print(f"  - {sid}: skipped (hand-made crest in logoOverrides.js)")
        urls.pop(sid)

    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    # Preserve hand-made overrides (the Storm crest) — they are not derived
    # from WIAA and must never be clobbered by a mirror run.
    manifest: dict[str, str] = {}
    if MANIFEST.exists():
        try:
            manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}

    downloaded = skipped = failed = 0
    total_bytes = 0

    with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as c:
        for school_id, url in sorted(urls.items()):
            filename = f"{school_id}{extension_for(url)}"
            dest = LOGO_DIR / filename
            if dest.exists() and not args.refresh:
                manifest[school_id] = filename
                total_bytes += dest.stat().st_size
                skipped += 1
                continue
            try:
                resp = c.get(url)
                resp.raise_for_status()
                body = resp.content
                if not body:
                    raise ValueError("empty body")
            except (httpx.HTTPError, ValueError) as e:
                # A miss is survivable: TeamLogo falls back to the WIAA URL.
                print(f"  ! {school_id}: {type(e).__name__} — leaving to the live URL")
                failed += 1
                continue
            dest.write_bytes(body)
            manifest[school_id] = filename
            total_bytes += len(body)
            downloaded += 1
            time.sleep(POLITE_DELAY_SECONDS)

    # Drop entries whose file has since been deleted, so the manifest can't
    # point the frontend at a 404.
    manifest = {k: v for k, v in sorted(manifest.items()) if (LOGO_DIR / v).exists()}
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(
        f"\nmirrored {len(manifest)} logos "
        f"({downloaded} downloaded, {skipped} already present, {failed} failed) "
        f"— {total_bytes / 1024:.0f} KB total"
    )
    print(f"  images:   {LOGO_DIR.relative_to(REPO_ROOT)}")
    print(f"  manifest: {MANIFEST.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
