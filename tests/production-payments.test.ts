import { describe, expect, it } from "vitest";
import { ProductionPaymentRepository } from "../apps/api/src/production-payments";
import type { D1Like } from "@tg-ad-manager/telegram";

const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
const order = { id: "order-1", receivable_minor: 10000, payment_status: "pending_payment", status: "pending_payment" as const, customer_id: "customer-1" };

function mockDb(options: {
  insertChanges?: number;
  payment?: Record<string, unknown>;
  paymentIdempotency?: Record<string, unknown>;
  refundIdempotency?: Record<string, unknown>;
  refund?: Record<string, unknown>;
  duplicateDisbursementRef?: Record<string, unknown>;
  orderResult?: Record<string, unknown>;
  batchChanges?: number[];
} = {}) {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  const batches: string[][] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      const statement = {
        bind(...values: unknown[]) {
          bindings.push(values);
          return {
            query,
            async first<T>() {
              if (query.startsWith("SELECT id, total_due_minor AS receivable_minor")) return order as T;
              if (query.includes("FROM payment_submissions") && query.includes("idempotency_key = ?")) return (options.paymentIdempotency ?? null) as T;
              if (query.includes("FROM ad_order_refunds") && query.includes("idempotency_key = ?")) return (options.refundIdempotency ?? null) as T;
              if (query.includes("disbursement_transaction_ref = ?")) return (options.duplicateDisbursementRef ?? null) as T;
              if (query.includes("SELECT id FROM payment_submissions") && query.includes("transaction_no")) return null;
              if (query.includes("JOIN ad_orders o ON o.id = p.order_id")) return (options.payment ?? { id: "payment-1", order_id: "order-1", amount_minor: 10000, status: "pending_review", receivable_minor: 10000, payment_status: "pending_payment", order_status: "pending_payment" }) as T;
              if (query.includes("FROM ad_order_refunds WHERE id =")) return (options.refund ?? { id: "refund-1", order_id: "order-1", amount_minor: 5000, status: "pending_review" }) as T;
              if (query.includes("orderPaymentStatus")) return (options.orderResult ?? { orderPaymentStatus: "partially_paid", orderStatus: "pending_payment" }) as T;
              return null;
            },
            async all<T>() { return { results: [] as T[] }; },
            async run() { return { meta: { changes: options.insertChanges ?? 1 } }; },
          };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ query?: string }>) {
      batches.push(statements.map((statement) => statement.query ?? "prepared"));
      return (options.batchChanges ?? statements.map((_, index) => index === 0 ? 1 : 1)).map((changes) => ({ meta: { changes } }));
    },
  };
  return { db: db as unknown as D1Like, queries, bindings, batches };
}

describe("production finance write safety", () => {
  it("reserves both pending and approved refunds in one guarded insert", async () => {
    const { db, queries } = mockDb();
    await new ProductionPaymentRepository(db).createRefund(scope, "user-1", "order-1", { idempotencyKey: "refund-key-1", amountMinor: 5000, reason: "campaign cancelled" }, "2026-11-27T00:00:00.000Z");
    const insert = queries.find((query) => query.includes("INSERT INTO ad_order_refunds")) ?? "";
    expect(insert).toContain("INSERT INTO ad_order_refunds");
    expect(insert).toContain("r.status IN ('pending_review', 'approved')");
    expect(insert).toContain("? <= COALESCE");
  });

  it("returns the original refund on an exact idempotency replay and rejects a changed payload", async () => {
    const existing = { id: "refund-existing", order_id: "order-1", amount_minor: 5000, reason: "campaign cancelled", method: "bank_transfer", transaction_ref: null };
    const { db } = mockDb({ refundIdempotency: existing });
    const repo = new ProductionPaymentRepository(db);
    expect(await repo.createRefund(scope, "user-1", "order-1", { idempotencyKey: "same-refund-key", amountMinor: 5000, reason: "campaign cancelled", method: "bank_transfer" }, "2026-11-27T00:00:00.000Z")).toBe("refund-existing");
    await expect(repo.createRefund(scope, "user-1", "order-1", { idempotencyKey: "same-refund-key", amountMinor: 6000, reason: "campaign cancelled", method: "bank_transfer" }, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("rejects a refund when the atomic reservation insert affects no row", async () => {
    const { db } = mockDb({ insertChanges: 0 });
    await expect(new ProductionPaymentRepository(db).createRefund(scope, "user-1", "order-1", { idempotencyKey: "refund-key-2", amountMinor: 5000, reason: "campaign cancelled" }, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "REFUND_EXCEEDS_PAID" });
  });

  it("uses an atomic D1 batch to review a partial payment and derives schema-valid payment status", async () => {
    const { db, batches, bindings } = mockDb({ orderResult: { orderPaymentStatus: "partially_paid", orderStatus: "pending_payment" } });
    const result = await new ProductionPaymentRepository(db).reviewPayment(scope, "finance-1", "payment-1", { status: "approved" }, "2026-11-27T00:00:00.000Z");
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(result.orderPaymentStatus).toBe("partially_paid");
    expect(result.orderStatus).toBe("pending_payment");
    expect(bindings.some((values) => values.includes("payment:payment-1"))).toBe(true);
  });

  it("approves a refund without treating approval as actual disbursement", async () => {
    const { db, batches, queries } = mockDb();
    const result = await new ProductionPaymentRepository(db).reviewRefund(scope, "finance-1", "refund-1", { status: "approved" }, "2026-11-27T00:00:00.000Z");
    expect(result).toEqual({ orderId: "order-1", status: "approved" });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(queries.some((query) => query.includes("financial_ledger_entries"))).toBe(false);
  });

  it("rejects a missing or different actual refund amount before writing any ledger entry", async () => {
    const { db, batches } = mockDb({ refund: { id: "refund-1", order_id: "order-1", amount_minor: 5000, status: "approved", disbursed_at: null } });
    await expect(new ProductionPaymentRepository(db).disburseRefund(scope, "finance-1", "refund-1", { method: "bank_transfer", transactionRef: "RF-1", actualAmountMinor: 4999 }, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "REFUND_ACTUAL_AMOUNT_MISMATCH" });
    expect(batches).toHaveLength(0);
  });

  it("rejects an unknown refund disbursement method instead of recording it as other", async () => {
    const { db, queries, batches } = mockDb();
    await expect(new ProductionPaymentRepository(db).disburseRefund(scope, "finance-1", "refund-1", { method: "paypal-ish", transactionRef: "RF-1", actualAmountMinor: 5000 }, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "INVALID_REFUND_DISBURSEMENT_METHOD" });
    expect(queries).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });

  it("records an actual refund disbursement atomically with ledger and order-state updates", async () => {
    const { db, batches, bindings } = mockDb({ refund: { id: "refund-1", order_id: "order-1", amount_minor: 5000, status: "approved", disbursed_at: null } });
    const result = await new ProductionPaymentRepository(db).disburseRefund(scope, "finance-1", "refund-1", { method: "bank_transfer", transactionRef: "RF-1", actualAmountMinor: 5000 }, "2026-11-27T00:00:00.000Z");
    expect(result).toEqual({ orderId: "order-1", status: "disbursed" });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(bindings.some((values) => values.includes("refund:refund-1:disbursed"))).toBe(true);
    expect(batches[0][0]).toContain("disbursed_at IS NULL");
  });

  it("rejects reusing an actual disbursement transaction reference", async () => {
    const { db, batches } = mockDb({
      refund: { id: "refund-2", order_id: "order-1", amount_minor: 5000, status: "approved", disbursed_at: null },
      duplicateDisbursementRef: { id: "refund-1" },
    });
    await expect(new ProductionPaymentRepository(db).disburseRefund(scope, "finance-1", "refund-2", { method: "bank_transfer", transactionRef: "RF-1", actualAmountMinor: 5000 }, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "DUPLICATE_TRANSACTION_REF" });
    expect(batches).toHaveLength(0);
  });

  it("reserves payment receivable in the same insert statement and counts rejected transaction refs as occupied", async () => {
    const { db, queries, batches } = mockDb();
    await new ProductionPaymentRepository(db).createPayment(scope, "user-1", "order-1", { idempotencyKey: "payment-key-1", amountMinor: 5000, method: "wechat", transactionRef: "TX-1" }, "2026-11-27T00:00:00.000Z");
    const duplicate = queries.find((query) => query.includes("SELECT id FROM payment_submissions") && query.includes("transaction_no")) ?? "";
    const insert = queries.find((query) => query.includes("INSERT INTO payment_submissions")) ?? "";
    expect(duplicate).not.toContain("status IN");
    expect(insert).toContain("INSERT INTO payment_submissions");
    expect(insert).toContain("p.status IN ('submitted', 'approved')");
    expect(insert).toContain("o.status IN ('pending_payment', 'pending_review')");
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][1]).toContain("payment_status = 'pending_payment'");
  });

  it("rejects an over-limit insert without performing a partial order-status write", async () => {
    const { db, batches } = mockDb({ batchChanges: [0, 0] });
    await expect(new ProductionPaymentRepository(db).createPayment(scope, "user-1", "order-1", { idempotencyKey: "payment-key-2", amountMinor: 15000, method: "wechat" }, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_RECEIVABLE" });
    expect(batches[0]).toHaveLength(2);
  });

  it("returns the original payment on an exact idempotency replay and rejects a changed payload", async () => {
    const existing = { id: "payment-existing", order_id: "order-1", amount_minor: 5000, payment_method: "wechat", transaction_no: "TX-1", proof_file_ref: null };
    const { db, batches } = mockDb({ paymentIdempotency: existing });
    const repo = new ProductionPaymentRepository(db);
    expect(await repo.createPayment(scope, "user-1", "order-1", { idempotencyKey: "same-key", amountMinor: 5000, method: "wechat", transactionRef: "TX-1" }, "2026-11-27T00:00:00.000Z")).toBe("payment-existing");
    await expect(repo.createPayment(scope, "user-1", "order-1", { idempotencyKey: "same-key", amountMinor: 6000, method: "wechat", transactionRef: "TX-1" }, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(batches).toHaveLength(0);
  });

  it("rejects removed payment methods before database writes", async () => {
    const { db, queries, batches } = mockDb();
    await expect(new ProductionPaymentRepository(db).createPayment(scope, "user-1", "order-1", { idempotencyKey: "legacy-method", amountMinor: 1000, method: "bank_transfer" }, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "INVALID_PAYMENT_METHOD" });
    expect(queries).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });
});
