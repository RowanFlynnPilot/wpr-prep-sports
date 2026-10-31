"""Fill football `wiaa_division` from WIAA's official divisional-placement sheets.

`backfill_divisions.py` infers divisions from tournament brackets, so a school that
missed the playoffs never gets one (20 of 64 football schools after the 2026
brackets). WIAA also publishes one PDF per 11-player division listing every
placed team ("2026 Football Divisional Placement": SchoolYear, TeamName,
explanation, Points, District, Enroll), at

    https://www.wiaawi.org/sites/default/files/pdfs/PDF/Results/Football/<year>%20FB/<year>-Football-Div<N>.pdf

This script reads those seven sheets (downloaded, or from --local-dir), matches
team names to the manifest (name, full_name, aliases; WIAA uses the formal name,
e.g. "Wisconsin Rapids Lincoln", and co-op strings like "Mellen/Butternut/Mercer"),
and merges the result into scraper/config/schools.json. 8-player divisions are not
on these sheets; the bracket backfill still covers those.

Usage (from scraper/):
    python scripts/divisions_from_wiaa_sheets.py --year 2026            # report only
    python scripts/divisions_from_wiaa_sheets.py --year 2026 --write    # merge into manifest
    python scripts/divisions_from_wiaa_sheets.py --year 2026 --local-dir path/with/pdfs
"""

from __future__ import annotations

import argparse
import collections
import glob
import io
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    sys.exit("pypdf is required: pip install pypdf (it is in requirements-dev.txt)")

import httpx

MANIFEST_PATH = Path(__file__).resolve().parents[1] / "config" / "schools.json"
SHEET_URL = (
    "https://www.wiaawi.org/sites/default/files/pdfs/PDF/Results/Football/"
    "{year}%20FB/{year}-Football-Div{div}.pdf"
)
ROW = re.compile(r"^(\d{4})-(\d{4})\s+(.*?)\s+(\d+(?:\.\d+)?)\s+(\d)\s+(\d{3,4})$")  # points may be 6.5
EXPLANATION = re.compile(r"\s+(?:Moved|Opted|Placed).*$")  # "Moved down due to performance factor [points] [D2] (School)"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)  # "Marshﬁeld" -> "Marshfield"
    s = s.replace("’", "'").lower()
    s = re.sub(r"[^a-z0-9/ ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_sheet(text: str) -> tuple[int | None, list[str]]:
    """Division number (the sheet's repeated trailing Division column) and team names."""
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    trailing = collections.Counter(ln for ln in lines if re.fullmatch(r"\d", ln))
    division = int(trailing.most_common(1)[0][0]) if trailing else None
    names = []
    for ln in lines:
        m = ROW.match(ln)
        if not m:
            continue
        name = EXPLANATION.sub("", m.group(3)).strip()
        if name:
            names.append(name)
    return division, names


def load_sheets(year: int, local_dir: str | None) -> dict[int, list[str]]:
    texts = []
    if local_dir:
        for f in sorted(glob.glob(os.path.join(local_dir, "*.pdf"))):
            texts.append(PdfReader(f))
    else:
        with httpx.Client(headers={"User-Agent": "wpr-prep-sports/1.0"}, timeout=30, follow_redirects=True) as c:
            for div in range(1, 8):
                r = c.get(SHEET_URL.format(year=year, div=div))
                r.raise_for_status()
                texts.append(PdfReader(io.BytesIO(r.content)))
                time.sleep(1.0)
    out: dict[int, list[str]] = {}
    for reader in texts:
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
        division, names = parse_sheet(text)
        if division is None:
            print("  ! a sheet had no division column; skipped", file=sys.stderr)
            continue
        out.setdefault(division, []).extend(names)
    return out


def match_schools(manifest: list[dict], by_div: dict[int, list[str]]) -> tuple[dict[str, str], list[str]]:
    """school_id -> 'D<n>' for every football school whose manifest names match a sheet row."""
    rows = [(norm(name), div) for div, names in by_div.items() for name in names]
    found: dict[str, str] = {}
    unmatched: list[str] = []
    for school in manifest:
        if not any(c.get("sport") == "football" for c in school.get("conferences", [])):
            continue
        keys = {norm(school.get("name", ""))}
        if school.get("full_name"):
            keys.add(norm(re.sub(r"\s*(High School|HS)$", "", school["full_name"], flags=re.I)))
        keys.update(norm(a) for a in school.get("aliases", []) if a)
        keys.discard("")
        hit = None
        for row_name, div in rows:
            # exact, or the sheet's formal name starts with ours ("wisconsin rapids lincoln"),
            # or a co-op string that begins with ours ("mellen/butternut/mercer")
            if any(row_name == k or row_name.startswith(k + " ") or row_name.startswith(k + "/") for k in keys):
                hit = f"D{div}"
                break
        if hit:
            found[school["id"]] = hit
        else:
            unmatched.append(school["id"])
    return found, unmatched


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, required=True, help="season's first calendar year, e.g. 2026")
    ap.add_argument("--local-dir", help="folder of already-downloaded division PDFs instead of fetching")
    ap.add_argument("--write", action="store_true", help="merge into scraper/config/schools.json")
    args = ap.parse_args()

    by_div = load_sheets(args.year, args.local_dir)
    print("sheets:", {d: len(n) for d, n in sorted(by_div.items())})
    raw = MANIFEST_PATH.read_text(encoding="utf-8")
    manifest = json.loads(raw)
    schools = manifest["schools"] if isinstance(manifest, dict) and "schools" in manifest else manifest
    found, unmatched = match_schools(schools, by_div)

    changed = 0
    for school in schools:
        sid = school["id"]
        if sid not in found:
            continue
        current = (school.get("wiaa_division") or {}).get("football")
        if current == found[sid]:
            continue
        flag = "new" if not current else f"was {current}"
        print(f"  {sid:24s} football {found[sid]}  ({flag})")
        if args.write:
            school.setdefault("wiaa_division", {})
            if school["wiaa_division"] is None:
                school["wiaa_division"] = {}
            school["wiaa_division"]["football"] = found[sid]
            changed += 1
    print(f"matched {len(found)} football schools; unmatched (8-player or name mismatch): {unmatched}")
    if args.write:
        MANIFEST_PATH.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + ("\n" if raw.endswith("\n") else ""),
            encoding="utf-8",
        )
        print(f"wrote {changed} division(s) -> {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
