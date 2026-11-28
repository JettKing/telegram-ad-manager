import { describe, expect, it } from "vitest";
import type { D1Like } from "@tg-ad-manager/telegram";
import { D1BusinessRepository } from "../apps/api/src/business";
import { ProductionBusinessRepository } from "../apps/api/src/production-business";
import { D1PaymentRepository } from "../apps/api/src/payments";

const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };

function readTrackingDb() {
  const queries: string[] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      return {
        bind() {
          return {
            async first() { return { status: "pending_payment" }; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  } as unknown as D1Like;
  return { db, queries };
}

describe("financial order state transition guard", () => {
  it("blocks paid, refunded and partially_refunded in the legacy repository before database access", async () => {
    for (const status of ["paid", "refunded", "partially_refunded"] as const) {
      const { db, queries } = readTrackingDb();
      await expect(new D1BusinessRepository(db).transitionOrder(scope, "user-1", "order-1", status, "test", "2026-11-28T00:00:00.000Z"))
        .rejects.toMatchObject({ code: "FINANCIAL_TRANSITION_REQUIRES_PAYMENT_WORKFLOW" });
      expect(queries.some((query) => /^\s*(UPDATE|INSERT|DELETE)/i.test(query))).toBe(false);
    }
  });

  it("blocks paid, refunded and partially_refunded in the production repository before database access", async () => {
    for (const status of ["paid", "refunded", "partially_refunded"] as const) {
      const { db, queries } = readTrackingDb();
      await expect(new ProductionBusinessRepository(db).transitionOrder(scope, "user-1", "order-1", status, "test", "2026-11-28T00:00:00.000Z"))
        .rejects.toMatchObject({ code: "FINANCIAL_TRANSITION_REQUIRES_PAYMENT_WORKFLOW" });
      expect(queries.some((query) => /^\s*(UPDATE|INSERT|DELETE)/i.test(query))).toBe(false);
    }
  });

  it("does not mark a legacy order refunded when a refund request is merely approved", async () => {
    const queries: string[] = [];
    const db = {
      prepare(query: string) {
        queries.push(query);
        return {
          bind() {
            return {
              async first<T>() {
                return query.includes("SELECT r.id, r.order_id")
                  ? { id: "refund-1", order_id: "order-1", amount_minor: 100, status: "pending_review", receivable_minor: 100, payment_status: "paid", order_status: "completed" } as T
                  : null;
              },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
        };
      },
    } as unknown as D1Like;
    const result = await new D1PaymentRepository(db).reviewRefund(scope, "finance-1", "refund-1", { status: "approved" }, "2026-11-28T00:00:00.000Z");
    expect(result).toMatchObject({ orderPaymentStatus: "paid", orderStatus: "completed" });
    expect(queries.some((query) => query.startsWith("UPDATE ad_orders"))).toBe(false);
  });
});
