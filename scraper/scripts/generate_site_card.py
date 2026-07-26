"""
Generate the site-level social share card (frontend/public/og-card.png).

This is the image Facebook, X, iMessage, and Slack show when anyone shares
the widget's URL. Local high-school sports spread almost entirely through
parents posting links, so a bare URL with no card is real lost reach.

Distinct from scripts/generate_og_cards.py, which screenshots a card per
finished GAME. This one is static site branding, so it's rendered once and
committed rather than regenerated every scrape.

Regenerate after changing the publisher name or palette:

    cd scraper
    python scripts/generate_site_card.py

White-label: every string comes from frontend/src/config/site.js, so a new
tenant reruns this and gets their own card. Requires playwright chromium
(`python -m playwright install chromium`).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SITE_CONFIG = REPO_ROOT / "frontend" / "src" / "config" / "site.js"
OUT_PNG = REPO_ROOT / "frontend" / "public" / "og-card.png"

WIDTH, HEIGHT = 1200, 630


def read_site_config() -> dict:
    """Pull the values we need out of site.js.

    site.js is deliberately pure data (its header says so, because
    scripts/build-digest.mjs imports it from plain Node), so a small regex
    read avoids adding a JS runtime dependency to the scraper.
    """
    text = SITE_CONFIG.read_text(encoding="utf-8")

    def field(name: str, default: str = "") -> str:
        m = re.search(rf'^\s*{name}:\s*"([^"]*)"', text, re.MULTILINE)
        return m.group(1) if m else default

    return {
        "orgName": field("orgName", "Wausau Pilot & Review"),
        "titleLead": field("titleLead", "Central Wisconsin"),
        "titleEm": field("titleEm", "Prep Sports"),
        "orgDomain": field("orgDomain", "wausaupilotandreview.com"),
        "governingBody": field("governingBody", "WIAA"),
    }


def coverage_line() -> str:
    """'67 schools · 8 sports' straight from the data, so the card can't
    drift from reality the way a hardcoded number would."""
    try:
        schools = json.loads((REPO_ROOT / "data" / "schools.json").read_text(encoding="utf-8"))
        n_schools = len(schools)
    except (OSError, json.JSONDecodeError, TypeError):
        n_schools = 0
    sports = sorted(
        d.name for d in (REPO_ROOT / "data").iterdir() if d.is_dir() and (d / "games.json").exists()
    )
    parts = []
    if n_schools:
        parts.append(f"{n_schools} schools")
    if sports:
        parts.append(f"{len(sports)} sports")
    return " · ".join(parts) if parts else "Central Wisconsin high school sports"


def card_html(cfg: dict) -> str:
    # Palette matches styles/global.css: monochrome + a single press red.
    return f"""<!doctype html>
<html><head><meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Merriweather:wght@400&display=swap" />
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ width:{WIDTH}px; height:{HEIGHT}px; background:#ffffff; overflow:hidden; }}
  .card {{
    width:100%; height:100%; padding:70px 78px;
    display:flex; flex-direction:column; justify-content:space-between;
    border-top:16px solid #cc1818; position:relative;
  }}
  .eyebrow {{
    font-family:'Oswald',sans-serif; font-size:26px; font-weight:600;
    letter-spacing:.22em; text-transform:uppercase; color:#cc1818;
  }}
  h1 {{
    font-family:'Oswald',sans-serif; font-weight:700; font-size:118px;
    line-height:.96; letter-spacing:-.015em; color:#000; text-transform:uppercase;
  }}
  h1 em {{ font-style:normal; display:block; color:#000; }}
  .rule {{ width:150px; height:8px; background:#000; margin:30px 0 26px; }}
  .sub {{
    font-family:'Merriweather',Georgia,serif; font-size:31px; color:#3e3e3e;
    line-height:1.45; margin-top:26px;
  }}
  .foot {{
    display:flex; align-items:baseline; justify-content:space-between;
    border-top:3px solid #dddddd; padding-top:26px;
  }}
  .org {{ font-family:'Oswald',sans-serif; font-size:34px; font-weight:600; color:#000; }}
  .domain {{ font-family:'Oswald',sans-serif; font-size:26px; color:#666; letter-spacing:.05em; }}
</style></head>
<body>
  <div class="card">
    <div>
      <div class="eyebrow">{cfg["governingBody"]} Scores &amp; Standings</div>
      <div class="rule"></div>
      <h1>{cfg["titleLead"]}<em>{cfg["titleEm"]}</em></h1>
    </div>
    <div class="sub">Live scores, full schedules, conference standings,<br />and player stats — {coverage_line()}.</div>
    <div class="foot">
      <span class="org">{cfg["orgName"]}</span>
      <span class="domain">{cfg["orgDomain"]}</span>
    </div>
  </div>
</body></html>"""


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed — pip install -r requirements.txt", file=sys.stderr)
        return 1

    cfg = read_site_config()
    html = card_html(cfg)
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
        page.set_content(html, wait_until="networkidle")
        # Webfonts land after networkidle occasionally; a beat here is much
        # cheaper than shipping a card rendered in Times New Roman.
        page.wait_for_timeout(900)
        page.screenshot(path=str(OUT_PNG))
        browser.close()

    size_kb = OUT_PNG.stat().st_size / 1024
    print(f"wrote {OUT_PNG.relative_to(REPO_ROOT)} ({WIDTH}x{HEIGHT}, {size_kb:.0f} KB)")
    print(f"  title:    {cfg['titleLead']} {cfg['titleEm']}")
    print(f"  coverage: {coverage_line()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
