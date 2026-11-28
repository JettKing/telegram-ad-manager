#!/usr/bin/env python3
"""Validate a D1 SQL export without touching a production database."""
from __future__ import annotations

import pathlib
import sqlite3
import sys
from typing import Any

REQUIRED_TABLES = {
    "users",
    "tenants",
    "workspaces",
    "ad_packages",
    "ad_orders",
    "publish_tasks",
    "publish_task_logs",
    "ops_health_snapshots",
    "ops_alert_events",
    "payment_submissions",
    "ad_order_refunds",
    "financial_ledger_entries",
}
REFUND_0018_COLUMNS = {
    "idempotency_key",
    "disbursed_by",
    "disbursed_at",
    "disbursement_method",
    "disbursement_transaction_ref",
    "disbursement_legacy_inferred",
}
REFUND_0018_INDEXES = {
    "idx_order_refunds_disbursement",
    "idx_order_refunds_disbursement_ref_unique",
    "idx_payment_submissions_request_idempotency",
    "idx_ad_order_refunds_request_idempotency",
}
MULTICURRENCY_0019_COLUMNS = {
    "ad_packages": {"currency_scale", "network"},
    "ad_orders": {"currency_scale", "network"},
    "payment_submissions": {"amount_scale", "network"},
    "ad_order_refunds": {
        "currency", "amount_scale", "network", "actual_amount_minor",
        "actual_currency", "actual_network", "payment_submission_id",
    },
    "financial_ledger_entries": {"amount_scale", "network"},
}
MULTICURRENCY_0019_INDEXES = {"idx_order_refunds_payment_submission"}

# (table, ordered key columns, unique, partial, required WHERE fragments).
# Comparing PRAGMA metadata avoids trusting an index name when its definition
# was accidentally weakened.
INDEX_REQUIREMENTS = {
    "idx_order_refunds_disbursement": (
        "ad_order_refunds", ("tenant_id", "workspace_id", "status", "disbursed_at", "created_at"), False, False, (),
    ),
    "idx_order_refunds_disbursement_ref_unique": (
        "ad_order_refunds", ("tenant_id", "workspace_id", "disbursement_transaction_ref"), True, True,
        ("disbursement_transaction_refisnotnull", "trim(disbursement_transaction_ref)<>''"),
    ),
    "idx_payment_submissions_request_idempotency": (
        "payment_submissions", ("tenant_id", "workspace_id", "idempotency_key"), True, True,
        ("idempotency_keyisnotnull",),
    ),
    "idx_ad_order_refunds_request_idempotency": (
        "ad_order_refunds", ("tenant_id", "workspace_id", "idempotency_key"), True, True,
        ("idempotency_keyisnotnull",),
    ),
    "idx_order_refunds_payment_submission": (
        "ad_order_refunds", ("payment_submission_id", "status"), False, False, (),
    ),
}

# Required column shape for the migration-added finance fields. Defaults are
# normalized because SQLite may return quoted strings or parenthesized literals.
COLUMN_SHAPES = {
    "ad_order_refunds": {
        "idempotency_key": ("TEXT", 0, None),
        "disbursed_by": ("TEXT", 0, None),
        "disbursed_at": ("TEXT", 0, None),
        "disbursement_method": ("TEXT", 0, None),
        "disbursement_transaction_ref": ("TEXT", 0, None),
        "disbursement_legacy_inferred": ("INTEGER", 1, "0"),
        "currency": ("TEXT", 1, "CNY"),
        "amount_scale": ("INTEGER", 1, "2"),
        "network": ("TEXT", 0, None),
        "actual_amount_minor": ("INTEGER", 0, None),
        "actual_currency": ("TEXT", 0, None),
        "actual_network": ("TEXT", 0, None),
        "payment_submission_id": ("TEXT", 0, None),
    },
    "ad_packages": {"currency_scale": ("INTEGER", 1, "2"), "network": ("TEXT", 0, None)},
    "ad_orders": {"currency_scale": ("INTEGER", 1, "2"), "network": ("TEXT", 0, None)},
    "payment_submissions": {
        "amount_scale": ("INTEGER", 1, "2"), "network": ("TEXT", 0, None),
    },
    "financial_ledger_entries": {
        "amount_scale": ("INTEGER", 1, "2"), "network": ("TEXT", 0, None),
    },
}

# (child table, child column, parent table, parent column, ON DELETE, ON UPDATE)
FOREIGN_KEY_REQUIREMENTS = {
    ("ad_order_refunds", "disbursed_by"): ("users", "id", "SET NULL", "NO ACTION"),
    ("ad_order_refunds", "payment_submission_id"): (
        "payment_submissions", "id", "NO ACTION", "NO ACTION",
    ),
}


def normalized_default(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    while len(result) >= 2 and result[0] == "(" and result[-1] == ")":
        result = result[1:-1].strip()
    if len(result) >= 2 and result[0] == result[-1] and result[0] in "'\"":
        result = result[1:-1]
    return result


def column_metadata(connection: sqlite3.Connection, table: str) -> dict[str, tuple[str, int, str | None]]:
    # PRAGMA table_info returns tuples: cid, name, type, notnull, dflt_value, pk.
    return {
        str(row[1]): (str(row[2]).upper(), int(row[3]), normalized_default(row[4]))
        for row in connection.execute(f'PRAGMA table_info("{table}")')
    }


def validate_columns(connection: sqlite3.Connection, required_by_table: dict[str, set[str]]) -> list[str]:
    problems: list[str] = []
    for table, required in required_by_table.items():
        columns = column_metadata(connection, table)
        missing = sorted(required - columns.keys())
        if missing:
            problems.append(f"{table} missing columns {missing}")
            continue
        for column in sorted(required & COLUMN_SHAPES.get(table, {}).keys()):
            expected = COLUMN_SHAPES[table][column]
            actual = columns[column]
            if actual != expected:
                problems.append(f"{table}.{column} shape is {actual}, expected {expected}")
    return problems


def validate_indexes(connection: sqlite3.Connection, required_names: set[str]) -> list[str]:
    problems: list[str] = []
    for name in sorted(required_names):
        requirement = INDEX_REQUIREMENTS[name]
        table, expected_columns, expected_unique, expected_partial, expected_where = requirement
        # PRAGMA index_list rows are seq, name, unique, origin, partial.
        rows = connection.execute(f'PRAGMA index_list("{table}")').fetchall()
        index_row = next((row for row in rows if str(row[1]) == name), None)
        if index_row is None:
            problems.append(f"missing required index {name}")
            continue
        actual_unique = bool(index_row[2])
        actual_partial = bool(index_row[4]) if len(index_row) > 4 else False
        # PRAGMA index_info rows are seqno, cid, name; sort explicitly by seqno.
        index_columns = tuple(
            str(row[2]) for row in sorted(
                connection.execute(f'PRAGMA index_info("{name}")').fetchall(), key=lambda row: int(row[0])
            )
            if row[2] is not None
        )
        problems_for_index = []
        if index_columns != expected_columns:
            problems_for_index.append(f"columns={index_columns}, expected={expected_columns}")
        if actual_unique != expected_unique:
            problems_for_index.append(f"unique={actual_unique}, expected={expected_unique}")
        if actual_partial != expected_partial:
            problems_for_index.append(f"partial={actual_partial}, expected={expected_partial}")
        if expected_where:
            sql_row = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", (name,)
            ).fetchone()
            index_sql = "" if sql_row is None or sql_row[0] is None else str(sql_row[0])
            normalized_sql = "".join(
                char for char in index_sql.lower().replace('"', "").replace("`", "") if not char.isspace()
            )
            missing_predicates = [predicate for predicate in expected_where if predicate not in normalized_sql]
            if missing_predicates:
                problems_for_index.append(f"WHERE clause is missing required predicates {missing_predicates}")
        if problems_for_index:
            problems.append(f"index {name} has invalid definition: " + "; ".join(problems_for_index))
    return problems


def validate_foreign_keys(connection: sqlite3.Connection) -> list[str]:
    problems: list[str] = []
    # PRAGMA foreign_key_list rows are id, seq, table, from, to, on_update,
    # on_delete, match. Compare normalized values, not rendered SQL text.
    for (child_table, child_column), expected in FOREIGN_KEY_REQUIREMENTS.items():
        rows = connection.execute(f'PRAGMA foreign_key_list("{child_table}")').fetchall()
        found = any(
            (str(row[2]), str(row[4]), str(row[6]).upper(), str(row[5]).upper()) == expected
            and str(row[3]) == child_column
            for row in rows
        )
        if not found:
            parent_table, parent_column, on_delete, on_update = expected
            problems.append(
                f"foreign key {child_table}.{child_column} must reference "
                f"{parent_table}.{parent_column} ON DELETE {on_delete} ON UPDATE {on_update}"
            )
    return problems


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-d1-backup.py BACKUP.sql", file=sys.stderr)
        return 2
    backup = pathlib.Path(sys.argv[1])
    if not backup.is_file() or backup.stat().st_size == 0:
        print(f"backup file is missing or empty: {backup}", file=sys.stderr)
        return 2
    try:
        sql = backup.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        print(f"backup file could not be read: {error}", file=sys.stderr)
        return 2

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

        indexes = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
        migration_table = "d1_migrations" in tables
        applied_0018 = migration_table and connection.execute(
            "SELECT 1 FROM d1_migrations WHERE name = '0018_refund_disbursement.sql' LIMIT 1"
        ).fetchone() is not None
        applied_0019 = migration_table and connection.execute(
            "SELECT 1 FROM d1_migrations WHERE name = '0019_multi_currency_finance.sql' LIMIT 1"
        ).fetchone() is not None

        if applied_0018:
            column_problems = validate_columns(connection, {"ad_order_refunds": REFUND_0018_COLUMNS})
            index_problems = validate_indexes(connection, REFUND_0018_INDEXES)
            if column_problems or index_problems:
                print(
                    f"0018 is recorded but schema is incomplete/incorrect; "
                    f"columns={column_problems}, indexes={index_problems}",
                    file=sys.stderr,
                )
                return 1
        else:
            payment_columns = set(column_metadata(connection, "payment_submissions"))
            refund_columns = set(column_metadata(connection, "ad_order_refunds"))
            if "idempotency_key" not in payment_columns:
                print("0018 prerequisite missing: payment_submissions.idempotency_key", file=sys.stderr)
                return 1
            if REFUND_0018_COLUMNS & refund_columns or REFUND_0018_INDEXES & indexes:
                print("0018 schema objects exist but the migration is not recorded; refusing an unsafe replay", file=sys.stderr)
                return 1
            null_keys = connection.execute(
                "SELECT COUNT(*) FROM payment_submissions WHERE idempotency_key IS NULL"
            ).fetchone()[0]
            duplicate_keys = connection.execute(
                "SELECT COUNT(*) FROM (SELECT tenant_id, workspace_id, idempotency_key "
                "FROM payment_submissions WHERE idempotency_key IS NOT NULL "
                "GROUP BY tenant_id, workspace_id, idempotency_key HAVING COUNT(*) > 1)"
            ).fetchone()[0]
            if null_keys or duplicate_keys:
                print(f"0018 payment-key prerequisites failed: NULL={null_keys}, duplicate groups={duplicate_keys}", file=sys.stderr)
                return 1

        if applied_0019:
            column_problems = validate_columns(connection, MULTICURRENCY_0019_COLUMNS)
            index_problems = validate_indexes(connection, MULTICURRENCY_0019_INDEXES)
            foreign_key_problems = validate_foreign_keys(connection)
            if column_problems or index_problems or foreign_key_problems:
                print(
                    f"0019 is recorded but schema is incomplete/incorrect; columns={column_problems}, "
                    f"indexes={index_problems}, foreign_keys={foreign_key_problems}",
                    file=sys.stderr,
                )
                return 1
        else:
            present_columns = {
                table: sorted(required & set(column_metadata(connection, table)))
                for table, required in MULTICURRENCY_0019_COLUMNS.items()
                if required & set(column_metadata(connection, table))
            }
            present_indexes = sorted(MULTICURRENCY_0019_INDEXES & indexes)
            if present_columns or present_indexes:
                print(
                    f"0019 schema objects exist but migration is not recorded; refusing an unsafe replay; "
                    f"columns={present_columns}, indexes={present_indexes}",
                    file=sys.stderr,
                )
                return 1

        row_count = connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'").fetchone()[0]
        applied = [name for name, state in (("0018", applied_0018), ("0019", applied_0019)) if state]
        state = f"migrations recorded and complete: {', '.join(applied)}" if applied else "0018/0019 prerequisites verified"
        print(f"backup validation passed: {backup.name}; tables={row_count}; integrity=ok; {state}")
        return 0
    except sqlite3.Error as error:
        print(f"backup SQL could not be restored in temporary SQLite: {error}", file=sys.stderr)
        return 1
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
