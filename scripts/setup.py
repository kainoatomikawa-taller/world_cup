#!/usr/bin/env python3
"""
setup.py — bootstrap the World Cup Insights data pipeline.

Steps performed:
  1. Load FOOTBALL_API_KEY from .env.local (via python-dotenv in config.py).
  2. Create the SQLite database and apply the full schema (idempotent).
  3. Make one GET to the competitions endpoint to confirm the API key is valid.

Run this once before any other pipeline script.

Usage:
    python scripts/setup.py
    python scripts/setup.py --db-path /custom/path/world_cup.db

After setup succeeds, run the ingest pipeline:
    python scripts/ingest_api.py
    python scripts/identity.py seed
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import requests

# Local modules — config must be imported first so dotenv loads before anything
# else reads os.environ.
from config import API_BASE, COMPETITION_CODE, DEFAULT_DB, load_api_key
from init_db import init as init_schema


def verify_api_key(api_key: str) -> None:
    """Call the competitions endpoint once to confirm the key is accepted."""
    url = f"{API_BASE}/competitions/{COMPETITION_CODE}"
    print(f"  GET {url}")
    resp = requests.get(url, headers={"X-Auth-Token": api_key}, timeout=30)

    if resp.status_code == 403:
        sys.exit(
            "ERROR: API key rejected (HTTP 403).\n"
            "Check the value of FOOTBALL_API_KEY in .env.local."
        )
    if resp.status_code == 429:
        sys.exit(
            "ERROR: Rate limit hit during key verification (HTTP 429).\n"
            "Wait 60 s and try again."
        )

    resp.raise_for_status()
    data = resp.json()
    name = data.get("name", "unknown competition")
    print(f"  API key valid — competition: {name!r}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db-path",
        default=DEFAULT_DB,
        type=Path,
        metavar="PATH",
        help=f"SQLite database file (default: {DEFAULT_DB})",
    )
    args = parser.parse_args()

    # ── Step 1: load API key ───────────────────────────────────────────────
    print("[1/3] Loading API key from .env.local …")
    api_key = load_api_key()
    print("  FOOTBALL_API_KEY loaded")

    # ── Step 2: initialise database ────────────────────────────────────────
    print(f"\n[2/3] Initialising database at {args.db_path} …")
    init_schema(args.db_path)

    # ── Step 3: verify API key ─────────────────────────────────────────────
    print("\n[3/3] Verifying API key …")
    verify_api_key(api_key)

    print("\nSetup complete. Next steps:")
    print("  python scripts/ingest_api.py")
    print("  python scripts/identity.py seed")


if __name__ == "__main__":
    main()
