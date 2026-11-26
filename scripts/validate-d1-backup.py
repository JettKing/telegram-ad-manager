#!/usr/bin/env python3
"""Validate a D1 SQL export without touching a production database."""
from __future__ import annotations

import pathlib
import sqlite3
import sys

REQUIRED_TABLES = {
    "users",
    "tenants",
    "workspaces",
    "publish_tasks",
    "publish_task_logs",
    "ops_health_snapshots",
    "ops_alert_events",
}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-d1-backup.py BACKUP.sql", file=sys.stderr)
        return 2
    backup = pathlib.Path(sys.argv[1])
    if not backup.is_file() or backup.stat().st_size == 0:
        print(f"backup file is missing or empty: {backup}", file=sys.stderr)
        return 2

    sql = backup.read_text(encoding="utf-8")
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(sql)
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            print(f"SQLite integrity check failed: {integrity}", file=sys.stderr)
            return 1
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        missing = sorted(REQUIRED_TABLES - tables)
        if missing:
            print(f"backup is missing required tables: {', '.join(missing)}", file=sys.stderr)
            return 1
        row_count = connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'").fetchone()[0]
        print(f"backup validation passed: {backup.name}; tables={row_count}; integrity=ok")
        return 0
    except sqlite3.Error as error:
        print(f"backup SQL could not be restored in temporary SQLite: {error}", file=sys.stderr)
        return 1
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
