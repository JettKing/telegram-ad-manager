import { describe, expect, it } from "vitest";
import { BusinessValidationError } from "../apps/api/src/business";
import { parsePaymentInput, parsePaymentReviewInput, parseRefundInput, parseRefundReviewInput } from "../apps/api/src/payments";

describe("payment proof validation", () => {
  it("accepts a payment proof reference and minor-unit amount", () => {
    expect(parsePaymentInput({ method: "bank_transfer", amountMinor: 12500, transactionRef: "TX-001", proofAssetId: "asset-1" })).toEqual({ method: "bank_transfer", amountMinor: 12500, transactionRef: "TX-001", proofAssetId: "asset-1" });
  });

  it("rejects non-positive payment amounts and invalid review status", () => {
    expect(() => parsePaymentInput({ method: "cash", amountMinor: 0 })).toThrow(BusinessValidationError);
    expect(() => parsePaymentReviewInput({ status: "pending_review" })).toThrow("approved 或 rejected");
  });

  it("preserves a supplied payment idempotency key and rejects an empty one", () => {
    expect(parsePaymentInput({ method: "cash", amountMinor: 100, idempotencyKey: "pay-request-1" }).idempotencyKey).toBe("pay-request-1");
    expect(() => parsePaymentInput({ method: "cash", amountMinor: 100, idempotencyKey: " " })).toThrow("idempotency_key 不能为空");
  });
});

describe("refund ledger validation", () => {
  it("requires a positive amount and a reason", () => {
    expect(parseRefundInput({ amountMinor: 5000, reason: "campaign cancelled", method: "bank_transfer" })).toMatchObject({ amountMinor: 5000, reason: "campaign cancelled", method: "bank_transfer" });
    expect(() => parseRefundInput({ amountMinor: 5000 })).toThrow("refund_reason 不能为空");
  });

  it("only accepts explicit finance review decisions", () => {
    expect(parseRefundReviewInput({ status: "approved", note: "verified" })).toEqual({ status: "approved", note: "verified" });
    expect(() => parseRefundReviewInput({ status: "queued" })).toThrow(BusinessValidationError);
  });

  it("preserves a supplied refund idempotency key", () => {
    expect(parseRefundInput({ amountMinor: 100, reason: "correction", idempotencyKey: "refund-request-1" }).idempotencyKey).toBe("refund-request-1");
  });
});
