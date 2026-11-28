import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const tempDirs: string[] = [];

function tempDir() {
  const directory = mkdtempSync(join(tmpdir(), "migration-backup-validation-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function addMigrations(directory: string, names: string[]) {
  mkdirSync(directory, { recursive: true });
  for (const name of names) writeFileSync(join(directory, name), "CREATE TABLE test_table (id TEXT);\n");
}

function migrationChecker(directory: string) {
  return spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "scripts/check-migrations.ts")], {
    cwd: directory,
    encoding: "utf8",
  });
}

const backupSql = (options: { uniqueIndex?: boolean; disbursedByForeignKey?: boolean } = {}) => {
  const disbursedBy = options.disbursedByForeignKey
    ? "disbursed_by TEXT REFERENCES users(id) ON DELETE SET NULL,"
    : "disbursed_by TEXT, ";
  const refundRequestIndex = options.uniqueIndex
    ? "CREATE UNIQUE INDEX idx_ad_order_refunds_request_idempotency ON ad_order_refunds(tenant_id, workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;"
    : "CREATE INDEX idx_ad_order_refunds_request_idempotency ON ad_order_refunds(tenant_id, workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;";
  return `
CREATE TABLE users (id TEXT PRIMARY KEY);
CREATE TABLE tenants (id TEXT PRIMARY KEY);
CREATE TABLE workspaces (id TEXT PRIMARY KEY);
CREATE TABLE ad_packages (id TEXT PRIMARY KEY, currency_scale INTEGER NOT NULL DEFAULT 2, network TEXT);
CREATE TABLE ad_orders (id TEXT PRIMARY KEY, currency_scale INTEGER NOT NULL DEFAULT 2, network TEXT);
CREATE TABLE publish_tasks (id TEXT PRIMARY KEY);
CREATE TABLE publish_task_logs (id TEXT PRIMARY KEY);
CREATE TABLE ops_health_snapshots (id TEXT PRIMARY KEY);
CREATE TABLE ops_alert_events (id TEXT PRIMARY KEY);
CREATE TABLE payment_submissions (id TEXT PRIMARY KEY, tenant_id TEXT, workspace_id TEXT, idempotency_key TEXT, amount_scale INTEGER NOT NULL DEFAULT 2, network TEXT);
CREATE TABLE ad_order_refunds (
  id TEXT PRIMARY KEY, tenant_id TEXT, workspace_id TEXT, order_id TEXT, status TEXT, created_at TEXT,
  idempotency_key TEXT, ${disbursedBy} disbursed_at TEXT, disbursement_method TEXT,
  disbursement_transaction_ref TEXT, disbursement_legacy_inferred INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY', amount_scale INTEGER NOT NULL DEFAULT 2,
  network TEXT, actual_amount_minor INTEGER, actual_currency TEXT, actual_network TEXT,
  payment_submission_id TEXT REFERENCES payment_submissions(id)
);
CREATE TABLE financial_ledger_entries (id TEXT PRIMARY KEY, amount_scale INTEGER NOT NULL DEFAULT 2, network TEXT);
CREATE TABLE d1_migrations (name TEXT PRIMARY KEY);
INSERT INTO d1_migrations(name) VALUES ('0018_refund_disbursement.sql'), ('0019_multi_currency_finance.sql');
CREATE INDEX idx_order_refunds_disbursement ON ad_order_refunds(tenant_id, workspace_id, status, disbursed_at, created_at);
CREATE UNIQUE INDEX idx_order_refunds_disbursement_ref_unique ON ad_order_refunds(tenant_id, workspace_id, disbursement_transaction_ref) WHERE disbursement_transaction_ref IS NOT NULL AND TRIM(disbursement_transaction_ref) <> '';
CREATE UNIQUE INDEX idx_payment_submissions_request_idempotency ON payment_submissions(tenant_id, workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
${refundRequestIndex}
CREATE INDEX idx_order_refunds_payment_submission ON ad_order_refunds(payment_submission_id, status);
`;
};

function validateBackup(sql: string) {
  const directory = tempDir();
  const file = join(directory, "backup.sql");
  writeFileSync(file, sql);
  return spawnSync("python3", [join(root, "scripts/validate-d1-backup.py"), file], { encoding: "utf8" });
}

describe("migration and D1 backup safety checks", () => {
  it("accepts a complete backup with the declared indexes and foreign keys", () => {
    const result = validateBackup(backupSql({ uniqueIndex: true, disbursedByForeignKey: true }));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/backup validation passed/);
  });

  it("rejects an undeclared production migration gap", () => {
    const directory = tempDir();
    addMigrations(join(directory, "apps/api/migrations"), Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(4, "0")}_dev.sql`));
    addMigrations(join(directory, "apps/api/production-migrations/archive"), Array.from({ length: 9 }, (_, i) => `${String(i + 9).padStart(4, "0")}_prod.sql`));
    addMigrations(join(directory, "apps/api/production-migrations/active"), ["0018_active.sql", "0020_active.sql"]);

    const result = migrationChecker(directory);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/gap|discontinuous|range/i);
  });

  it("rejects a refund request index that exists but is not unique", () => {
    const result = validateBackup(backupSql({ uniqueIndex: false, disbursedByForeignKey: true }));
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/unique|index|0018/i);
  });

  it("rejects a backup missing the refund disbursed_by foreign-key semantics", () => {
    const result = validateBackup(backupSql({ uniqueIndex: true, disbursedByForeignKey: false }));
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/foreign key|foreign-key|disbursed_by/i);
  });
});
