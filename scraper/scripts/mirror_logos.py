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

Every mirrored file is downscaled and re-encoded on the way in (see
compress()) — WIAA's originals run to 50KB for a 200px mark, and the
dashboard loads up to 89 of them at once.

Usage
-----
  cd scraper
  python scripts/mirror_logos.py              # skips files already present
  python scripts/mirror_logos.py --refresh    # re-download everything
  python scripts/mirror_logos.py --recompress # re-encode what is on disk,
                                              # no network — run after
                                              # changing the settings below

Logos change rarely, so this is a deliberate on-demand script rather than
part of every scrape — it keeps binary churn out of the data commits.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from pathlib import Path

import httpx
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
LOGO_DIR = REPO_ROOT / "frontend" / "public" / "logos"
MANIFEST = REPO_ROOT / "frontend" / "src" / "config" / "logoManifest.json"
OVERRIDES_JS = REPO_ROOT / "frontend" / "src" / "config" / "logoOverrides.js"

USER_AGENT = "wpr-prep-sports/0.1 (+https://sports.wausaupilotandreview.com)"
# Same courtesy pause the scraper uses for WIAA (main.py POLITE_DELAY_SECONDS).
POLITE_DELAY_SECONDS = 0.4
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp"}

# Re-encoding budget. The largest a logo ever renders is 88px (the game
# page), so 200px still covers a 2x display with room to spare.
MAX_LOGO_EDGE = 200
JPEG_QUALITY = 82
PNG_COLORS = 256


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


def _existing_file(school_id: str) -> Path | None:
    """The mirrored file for a school, whatever extension it landed under."""
    for ext in sorted(ALLOWED_EXT):
        candidate = LOGO_DIR / f"{school_id}{ext}"
        if candidate.exists():
            return candidate
    return None


def _has_alpha(im: Image.Image) -> bool:
    """True only if the image ACTUALLY uses transparency.

    An RGBA image whose alpha channel is fully opaque is common and costs a
    great deal to keep as PNG for no visual gain, so test the channel rather
    than trusting the mode.
    """
    if im.mode in ("RGBA", "LA"):
        return im.getchannel("A").getextrema()[0] < 255
    return im.mode == "P" and "transparency" in im.info


def compress(body: bytes) -> tuple[bytes, str] | None:
    """Downscale and re-encode one mirrored logo. Returns (bytes, extension).

    WIAA serves these at ~200px but encoded carelessly — some are 50KB for a
    200x200 mark. The dashboard shows up to 89 of them at once, which made
    images 85% of a 1.75MB page, most of it wasted on an audience checking
    scores on phone data from a bleacher.

    Two paths, because one size does not fit: a mark with real transparency
    has to stay PNG (flattening it to JPEG paints the transparent
    background black), so it is quantised to a 256-colour palette instead —
    these are flat-colour crests, and measured against the original the
    worst error across the set is an RMSE of 5.5, invisible at 88px. Marks
    without transparency take JPEG, where quality 82 is where the size curve
    flattens.

    Returns None when the bytes are not a still raster image (SVG, animated
    GIF), which the caller writes through untouched.
    """
    head = body[:256].lstrip()
    if head.startswith(b"<?xml") or b"<svg" in head:
        return None
    try:
        im = Image.open(io.BytesIO(body))
        im.load()
    except Exception:  # noqa: BLE001 — any decode failure means "leave it alone"
        return None
    if getattr(im, "n_frames", 1) > 1:
        return None  # animated; re-encoding would drop the animation

    im.thumbnail((MAX_LOGO_EDGE, MAX_LOGO_EDGE), Image.LANCZOS)
    out = io.BytesIO()
    if _has_alpha(im):
        im.convert("RGBA").quantize(colors=PNG_COLORS, method=Image.FASTOCTREE).save(
            out, "PNG", optimize=True
        )
        ext = ".png"
    else:
        im.convert("RGB").save(out, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
        ext = ".jpg"
    encoded = out.getvalue()
    # Name by what the bytes ACTUALLY are. The old code took the extension
    # from the URL, which left eight PNGs on disk called .jpg — harmless
    # only because browsers sniff content and ignore the name.
    if len(encoded) >= len(body):
        # Already tighter than we can manage; keep the original bytes but
        # still correct the extension to match the real format.
        fmt = (im.format or "").upper()
        return body, ".png" if fmt == "PNG" else ext
    return encoded, ext


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--refresh", action="store_true", help="re-download files already present")
    p.add_argument(
        "--recompress",
        action="store_true",
        help="re-encode logos already on disk (no network), applying current settings",
    )
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
            existing = _existing_file(school_id)
            if existing and not (args.refresh or args.recompress):
                manifest[school_id] = existing.name
                total_bytes += existing.stat().st_size
                skipped += 1
                continue

            if existing and args.recompress and not args.refresh:
                # Re-encode what is already on disk, no network round-trip.
                body = existing.read_bytes()
            else:
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
                time.sleep(POLITE_DELAY_SECONDS)

            result = compress(body)
            if result is None:
                body_out, ext = body, extension_for(url)
            else:
                body_out, ext = result

            filename = f"{school_id}{ext}"
            dest = LOGO_DIR / filename
            dest.write_bytes(body_out)
            # Re-encoding can change the extension (several WIAA marks are
            # PNGs served from .jpg URLs), so clear any stale sibling —
            # otherwise both linger and the deploy ships the fat one too.
            if existing and existing.name != filename:
                existing.unlink(missing_ok=True)
            manifest[school_id] = filename
            total_bytes += len(body_out)
            downloaded += 1

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
