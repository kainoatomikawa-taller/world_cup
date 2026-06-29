#!/usr/bin/env python3
"""
config.py — central configuration for the World Cup Insights data pipeline.

All environment loading, competition constants, and path resolution live here
so every script imports from one authoritative source.

Usage (from any other script):
    from config import API_BASE, COMPETITION_CODE, COMPETITION_ID, SEASON, load_api_key
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Repository paths
# ---------------------------------------------------------------------------

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
ENV_FILE: Path = REPO_ROOT / ".env.local"
DEFAULT_DB: Path = REPO_ROOT / "db" / "world_cup.db"

# ---------------------------------------------------------------------------
# Environment — load .env.local before reading os.environ
# ---------------------------------------------------------------------------

# load_dotenv is idempotent: re-importing this module does not overwrite
# values that were already set in the calling process's environment.
load_dotenv(ENV_FILE, override=False)

# ---------------------------------------------------------------------------
# football-data.org API constants
# ---------------------------------------------------------------------------

API_BASE: str = "https://api.football-data.org/v4"

# Target competition for the 2026 FIFA World Cup.
# COMPETITION_CODE is the upstream short code used in API paths.
# COMPETITION_ID is the stable canonical slug shared with the TypeScript layer.
COMPETITION_CODE: str = "WC"
SEASON: str = "2026"
COMPETITION_ID: str = "fifa-wc-2026"

# Free-tier limit is 10 req/min; 7-second inter-request delay ≈ 8.5 req/min.
REQUEST_DELAY: float = 7.0

# ---------------------------------------------------------------------------
# API key resolution
# ---------------------------------------------------------------------------


def load_api_key() -> str:
    """Return the FOOTBALL_API_KEY, or exit with an instructive error.

    Resolution order:
    1. Process environment (already set or exported by the shell).
    2. .env.local (loaded above by load_dotenv).
    """
    key = os.environ.get("FOOTBALL_API_KEY", "").strip()
    if not key:
        sys.exit(
            "ERROR: FOOTBALL_API_KEY is not set.\n"
            "Add it to .env.local:\n"
            "    FOOTBALL_API_KEY=<your-key>\n"
            "Or export it before running:\n"
            "    export FOOTBALL_API_KEY=<your-key>"
        )
    return key


def load_gnews_api_key() -> str | None:
    """Return GNEWS_API_KEY from the environment, or None if not configured.

    Unlike load_api_key(), this function never exits — GNews is an optional
    enrichment source; the pipeline degrades gracefully without it.  To enable:

        echo 'GNEWS_API_KEY=<your-key>' >> .env.local

    Sign up at https://gnews.io/ for a free-tier key (100 req/day).

    COMMERCIAL CAVEAT: the GNews free tier is for personal, non-commercial use
    only.  See scripts/gnews_client.py for the full caveat and upgrade path.
    """
    return os.environ.get("GNEWS_API_KEY", "").strip() or None
