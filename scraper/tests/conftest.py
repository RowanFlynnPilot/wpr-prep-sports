"""Shared test plumbing: make `sources`/`transform`/... importable and
load the scripts/ files (which aren't a package) as modules."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRAPER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRAPER_ROOT))

FIXTURE_DIR = Path(__file__).parent / "fixtures"


def load_script(name: str):
    """Import scraper/scripts/<name>.py as a module object."""
    path = SCRAPER_ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
