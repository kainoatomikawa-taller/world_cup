#!/usr/bin/env python3
"""
init_db.py — create or re-apply the World Cup Insights SQLite schema.

Safe to re-run: all CREATE TABLE / CREATE INDEX statements use IF NOT EXISTS,
so existing data is never dropped. New tables or indexes added to schema.sql
will be applied on the next run.

Usage:
    python scripts/init_db.py
    python scripts/init_db.py --db-path /custom/path/world_cup.db
"""

import argparse
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "db" / "world_cup.db"
SCHEMA_SQL = Path(__file__).resolve().parent / "schema.sql"


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """Add columns that were introduced after initial schema creation.

    SQLite's CREATE TABLE IF NOT EXISTS never modifies existing tables, so each
    new column needs an explicit ALTER TABLE that is guarded against re-runs.
    """
    existing = {row[1] for row in conn.execute("PRAGMA table_info(matches)")}
    if "venue" not in existing:
        conn.execute("ALTER TABLE matches ADD COLUMN venue TEXT")
        conn.commit()
        print("  Migrated: added matches.venue column")


def init(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    schema = SCHEMA_SQL.read_text(encoding="utf-8")

    with sqlite3.connect(db_path) as conn:
        conn.executescript(schema)
        _apply_migrations(conn)

    print(f"Schema applied → {db_path}")
    _report(db_path)


def _report(db_path: Path) -> None:
    with sqlite3.connect(db_path) as conn:
        tables = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()
        ]
        indexes = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
            ).fetchall()
        ]
    print(f"Tables  ({len(tables)}): {', '.join(tables)}")
    print(f"Indexes ({len(indexes)}): {', '.join(indexes)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db-path",
        default=DEFAULT_DB,
        type=Path,
        metavar="PATH",
        help=f"SQLite database file (default: {DEFAULT_DB})",
    )
    args = parser.parse_args()
    init(args.db_path)
