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
        payment_columns = {row[1] for row in connection.execute("PRAGMA table_info(payment_submissions)")}
        refund_columns = {row[1] for row in connection.execute("PRAGMA table_info(ad_order_refunds)")}
        indexes = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
        migration_table = "d1_migrations" in tables
        applied_0018 = migration_table and connection.execute(
            "SELECT 1 FROM d1_migrations WHERE name = '0018_refund_disbursement.sql' LIMIT 1"
        ).fetchone() is not None
        applied_0019 = migration_table and connection.execute(
            "SELECT 1 FROM d1_migrations WHERE name = '0019_multi_currency_finance.sql' LIMIT 1"
        ).fetchone() is not None
        if applied_0018:
            missing_columns = sorted(REFUND_0018_COLUMNS - refund_columns)
            missing_indexes = sorted(REFUND_0018_INDEXES - indexes)
            if missing_columns or missing_indexes:
                print(
                    f"0018 is recorded but schema is incomplete; missing columns={missing_columns}, indexes={missing_indexes}",
                    file=sys.stderr,
                )
                return 1
        else:
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
        columns_by_table = {
            table: {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
            for table in MULTICURRENCY_0019_COLUMNS
        }
        if applied_0019:
            missing_0019_columns = {
                table: sorted(required - columns_by_table[table])
                for table, required in MULTICURRENCY_0019_COLUMNS.items()
                if required - columns_by_table[table]
            }
            missing_0019_indexes = sorted(MULTICURRENCY_0019_INDEXES - indexes)
            if missing_0019_columns or missing_0019_indexes:
                print(
                    f"0019 is recorded but schema is incomplete; missing columns={missing_0019_columns}, indexes={missing_0019_indexes}",
                    file=sys.stderr,
                )
                return 1
        else:
            present_0019_columns = {
                table: sorted(required & columns_by_table[table])
                for table, required in MULTICURRENCY_0019_COLUMNS.items()
                if required & columns_by_table[table]
            }
            present_0019_indexes = sorted(MULTICURRENCY_0019_INDEXES & indexes)
            if present_0019_columns or present_0019_indexes:
                print(
                    f"0019 schema objects exist but migration is not recorded; refusing an unsafe replay; columns={present_0019_columns}, indexes={present_0019_indexes}",
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
