import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProductionPaymentRepository } from "../apps/api/src/production-payments.js";
import type { D1Like } from "@tg-ad-manager/telegram";

type SqliteStatement = ReturnType<DatabaseSync["prepare"]>;
class Prepared {
  private values: unknown[] = [];
  private readonly statement: SqliteStatement;
  constructor(private readonly database: DatabaseSync, readonly sql: string) { this.statement = database.prepare(sql); }
  bind(...values: unknown[]) { this.values = values; return this; }
  first<T>() { return (this.statement.get as (...args: unknown[]) => T | undefined).apply(this.statement, this.values) ?? null; }
  all<T>() { return { results: (this.statement.all as (...args: unknown[]) => T[]).apply(this.statement, this.values) }; }
  run() { const result = (this.statement.run as (...args: unknown[]) => { changes: number }).apply(this.statement, this.values); return { meta: { changes: Number(result.changes) } }; }
}
class SqliteD1 {
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) { return new Prepared(this.database, sql); }
  async batch(statements: Prepared[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = statements.map((statement) => statement.run());
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function sqliteFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE ad_orders (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, customer_id TEXT,
      total_due_minor INTEGER NOT NULL, payment_status TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE payment_submissions (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, order_id TEXT NOT NULL,
      customer_id TEXT, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, payment_method TEXT NOT NULL,
      transaction_no TEXT, proof_file_ref TEXT, paid_at TEXT, note TEXT, status TEXT NOT NULL,
      idempotency_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_test_payment_transaction_unique ON payment_submissions(tenant_id, workspace_id, transaction_no)
      WHERE transaction_no IS NOT NULL AND TRIM(transaction_no) <> '';
    CREATE TABLE ad_order_refunds (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, order_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL, reason TEXT NOT NULL, method TEXT, transaction_ref TEXT,
      status TEXT NOT NULL, requested_by TEXT, reviewed_by TEXT, reviewed_at TEXT, review_note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE financial_ledger_entries (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, order_id TEXT NOT NULL,
      payment_submission_id TEXT, entry_type TEXT NOT NULL, direction TEXT NOT NULL, amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO users (id, display_name) VALUES ('reviewer-1', 'Reviewer'), ('finance-1', 'Finance');
    INSERT INTO ad_orders (id, tenant_id, workspace_id, customer_id, total_due_minor, payment_status, status, updated_at)
      VALUES ('order-1', 'tenant-1', 'workspace-1', 'customer-1', 10000, 'paid', 'paid', '2026-11-27T00:00:00.000Z');
    INSERT INTO ad_orders (id, tenant_id, workspace_id, customer_id, total_due_minor, payment_status, status, updated_at)
      VALUES ('order-payment', 'tenant-1', 'workspace-1', 'customer-1', 10000, 'unpaid', 'pending_payment', '2026-11-27T00:00:00.000Z');
    INSERT INTO payment_submissions (id, tenant_id, workspace_id, order_id, customer_id, amount_minor, currency, payment_method, status, idempotency_key, created_at, updated_at)
      VALUES ('payment-1', 'tenant-1', 'workspace-1', 'order-1', 'customer-1', 10000, 'CNY', 'bank_transfer', 'approved', 'payment:payment-1', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z');
    INSERT INTO ad_order_refunds (id, tenant_id, workspace_id, order_id, amount_minor, reason, status, reviewed_by, reviewed_at, created_at, updated_at)
      VALUES ('legacy-refund', 'tenant-1', 'workspace-1', 'order-1', 1000, 'old request', 'approved', 'reviewer-1', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z');
    INSERT INTO financial_ledger_entries (id, tenant_id, workspace_id, order_id, entry_type, direction, amount_minor, currency, reason, actor_user_id, created_at)
      VALUES ('legacy-ledger-random-id-1', 'tenant-1', 'workspace-1', 'order-1', 'refund', 'debit', 1000, 'CNY', 'refund_approved', 'reviewer-1', '2026-11-26T00:00:00.000Z');
    INSERT INTO ad_order_refunds (id, tenant_id, workspace_id, order_id, amount_minor, reason, status, reviewed_by, reviewed_at, created_at, updated_at)
      VALUES ('legacy-unmatched', 'tenant-1', 'workspace-1', 'order-1', 500, 'old unmatched request', 'approved', 'reviewer-1', '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z');
  `);
  const migration = readFileSync(resolve(process.cwd(), "apps/api/production-migrations/active/0018_refund_disbursement.sql"), "utf8");
  database.exec(migration);
  const d1 = new SqliteD1(database);
  return { database, d1, db: d1 as unknown as D1Like };
}

const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
const now = "2026-11-27T00:00:00.000Z";

async function main() {
  {
    const { database } = sqliteFixture();
    const legacy = database.prepare("SELECT disbursed_by, disbursed_at, disbursement_legacy_inferred FROM ad_order_refunds WHERE id = 'legacy-refund'").get() as Record<string, unknown>;
    assert.deepEqual({ ...legacy }, { disbursed_by: "reviewer-1", disbursed_at: "2026-11-26T00:00:00.000Z", disbursement_legacy_inferred: 1 });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM financial_ledger_entries WHERE id = 'legacy-ledger-random-id-1'").get() as { count: number }).count, 1);
    const unmatched = database.prepare("SELECT disbursement_legacy_inferred, disbursed_at FROM ad_order_refunds WHERE id = 'legacy-unmatched'").get() as Record<string, unknown>;
    assert.deepEqual({ ...unmatched }, { disbursement_legacy_inferred: 1, disbursed_at: null });
    const repo = new ProductionPaymentRepository(new SqliteD1(database) as unknown as D1Like);
    await assert.rejects(() => repo.disburseRefund(scope, 'finance-1', 'legacy-unmatched', { method: 'bank_transfer', transactionRef: 'DO-NOT-DUPLICATE' }, now), { code: 'REFUND_LEGACY_RECONCILIATION_REQUIRED' });
    database.exec("INSERT INTO ad_order_refunds (id, tenant_id, workspace_id, order_id, amount_minor, reason, status, idempotency_key, created_at, updated_at) VALUES ('first-key', 'tenant-1', 'workspace-1', 'order-1', 1, 'first', 'pending_review', 'same-key', 'now', 'now')");
    assert.throws(() => database.exec("INSERT INTO ad_order_refunds (id, tenant_id, workspace_id, order_id, amount_minor, reason, status, idempotency_key, created_at, updated_at) VALUES ('duplicate-key', 'tenant-1', 'workspace-1', 'order-1', 1, 'second', 'pending_review', 'same-key', 'now', 'now')"));
    database.close();
  }

  {
    const { database, db } = sqliteFixture();
    const repo = new ProductionPaymentRepository(db);
    const input = { idempotencyKey: "refund-request-1", amountMinor: 5000, reason: "campaign cancelled", method: "bank_transfer" };
    const id = await repo.createRefund(scope, "finance-1", "order-1", input, now);
    assert.equal(await repo.createRefund(scope, "finance-1", "order-1", input, now), id);
    await assert.rejects(() => repo.createRefund(scope, "finance-1", "order-1", { ...input, amountMinor: 4000 }, now), { code: "IDEMPOTENCY_KEY_CONFLICT" });
    await assert.rejects(() => repo.createRefund(scope, "finance-1", "order-1", { idempotencyKey: "refund-request-2", amountMinor: 6000, reason: "second request" }, now), { code: "REFUND_EXCEEDS_PAID" });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM ad_order_refunds WHERE idempotency_key = 'refund-request-1'").get() as { count: number }).count, 1);
    database.close();
  }

  {
    const { database, db } = sqliteFixture();
    const repo = new ProductionPaymentRepository(db);
    const paymentInput = { idempotencyKey: "payment-request-1", amountMinor: 4000, method: "bank_transfer", transactionRef: "TX-LIVE-1" };
    const paymentId = await repo.createPayment(scope, "finance-1", "order-payment", paymentInput, now);
    assert.equal(await repo.createPayment(scope, "finance-1", "order-payment", paymentInput, now), paymentId);
    await assert.rejects(() => repo.createPayment(scope, "finance-1", "order-payment", { ...paymentInput, amountMinor: 3000 }, now), { code: "IDEMPOTENCY_KEY_CONFLICT" });
    const refundId = await repo.createRefund(scope, "finance-1", "order-1", { idempotencyKey: "refund-disburse-1", amountMinor: 5000, reason: "approved refund" }, now);
    database.prepare("UPDATE ad_order_refunds SET status = 'approved' WHERE id = ?").run(refundId);
    await assert.rejects(() => repo.disburseRefund(scope, "finance-1", refundId, { method: "bank_transfer" }, now), { code: "REFUND_DISBURSEMENT_REF_REQUIRED" });
    await repo.disburseRefund(scope, "finance-1", refundId, { method: "bank_transfer", transactionRef: "RF-LIVE-1" }, now);
    const disbursed = database.prepare("SELECT disbursed_by, disbursed_at, disbursement_transaction_ref FROM ad_order_refunds WHERE id = ?").get(refundId) as Record<string, unknown>;
    assert.equal(disbursed.disbursed_by, "finance-1");
    assert.equal(disbursed.disbursed_at, now);
    assert.equal(disbursed.disbursement_transaction_ref, "RF-LIVE-1");
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM financial_ledger_entries WHERE id = ?").get(`refund:${refundId}:disbursed`) as { count: number }).count, 1);
    assert.throws(() => database.prepare("UPDATE ad_order_refunds SET disbursement_transaction_ref = 'RF-LIVE-1' WHERE id = 'legacy-unmatched'").run());
    database.close();
  }

  {
    const { database, d1 } = sqliteFixture();
    const before = (database.prepare("SELECT COUNT(*) AS count FROM ad_order_refunds").get() as { count: number }).count;
    await assert.rejects(() => d1.batch([
      d1.prepare("INSERT INTO ad_order_refunds (id, tenant_id, workspace_id, order_id, amount_minor, reason, status, created_at, updated_at) VALUES ('rollback-test', 'tenant-1', 'workspace-1', 'order-1', 1, 'rollback', 'pending_review', 'now', 'now')"),
      d1.prepare("INSERT INTO users (id, display_name) VALUES ('reviewer-1', 'duplicate')"),
    ]));
    const after = (database.prepare("SELECT COUNT(*) AS count FROM ad_order_refunds").get() as { count: number }).count;
    assert.equal(after, before);
    database.close();
  }
  console.log("SQLite finance integration passed: production migration, legacy backfill, unique request/disbursement refs, repository reservation/replay, and batch rollback.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
