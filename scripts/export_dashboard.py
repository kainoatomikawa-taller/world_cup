#!/usr/bin/env python3
"""
export_dashboard.py — export query-layer snapshots as static JSON for the
Insights dashboard.  Never triggers ingestion; reads only via query.py.

Usage:
    python scripts/export_dashboard.py
    python scripts/export_dashboard.py --db-path /path/to.db --out-dir public/data
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from query import (
    DEFAULT_DB,
    competition_table,
    top_scorers,
    upcoming_fixtures,
)

DEFAULT_OUT = REPO_ROOT / "public" / "data"


def _to_json(df) -> list[dict]:
    """Convert a DataFrame to a JSON-serialisable list of dicts."""
    return json.loads(df.to_json(orient="records"))


def export(db_path: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    fixtures_df = upcoming_fixtures(db_path, limit=20)
    standings_df = competition_table(db_path)
    scorers_df = top_scorers(db_path, limit=20)

    (out_dir / "fixtures.json").write_text(
        json.dumps(_to_json(fixtures_df), ensure_ascii=False, indent=2)
    )
    (out_dir / "standings.json").write_text(
        json.dumps(_to_json(standings_df), ensure_ascii=False, indent=2)
    )
    (out_dir / "scorers.json").write_text(
        json.dumps(_to_json(scorers_df), ensure_ascii=False, indent=2)
    )

    print(
        f"Exported {len(fixtures_df)} fixtures, "
        f"{len(standings_df)} standings rows, "
        f"{len(scorers_df)} scorers → {out_dir}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--db-path", default=DEFAULT_DB, type=Path, metavar="PATH")
    parser.add_argument("--out-dir", default=DEFAULT_OUT, type=Path, metavar="DIR")
    args = parser.parse_args()
    export(args.db_path, args.out_dir)


if __name__ == "__main__":
    main()
