import { describe, expect, it } from "vitest";
import { parseCheckoutInput, parseCheckoutReviewInput } from "../apps/api/src/subscription";

describe("subscription billing contract", () => {
  it("accepts a bounded checkout request", () => {
    expect(parseCheckoutInput({ planCode: "pro", billingPeriod: "monthly", idempotencyKey: "checkout-2026-0001" })).toEqual({ planCode: "pro", billingPeriod: "monthly", idempotencyKey: "checkout-2026-0001" });
  });

  it("defaults the billing period to monthly", () => {
    expect(parseCheckoutInput({ planCode: "business", idempotencyKey: "checkout-2026-0002" }).billingPeriod).toBe("monthly");
  });

  it("rejects free-plan checkout and invalid billing period at the request boundary", () => {
    expect(() => parseCheckoutInput({ planCode: "FREE", billingPeriod: "monthly", idempotencyKey: "checkout-2026-0003" })).not.toThrow();
    expect(() => parseCheckoutInput({ planCode: "pro", billingPeriod: "weekly", idempotencyKey: "checkout-2026-0004" })).toThrow("billingPeriod");
  });

  it("rejects short or malformed idempotency keys", () => {
    expect(() => parseCheckoutInput({ planCode: "pro", idempotencyKey: "short" })).toThrow("idempotencyKey");
    expect(() => parseCheckoutInput({ planCode: "pro", idempotencyKey: "checkout with spaces" })).toThrow("idempotencyKey");
  });

  it("accepts only explicit approval decisions", () => {
    expect(parseCheckoutReviewInput({ decision: "approved", note: "到账已核对" })).toEqual({ decision: "approved", note: "到账已核对" });
    expect(parseCheckoutReviewInput({ decision: "rejected" })).toEqual({ decision: "rejected", note: undefined });
    expect(() => parseCheckoutReviewInput({ decision: "paid" })).toThrow("approved 或 rejected");
  });
});
