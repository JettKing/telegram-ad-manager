import { describe, expect, it } from "vitest";
import { BusinessValidationError } from "../apps/api/src/business";
import { parsePaymentInput, parsePaymentReviewInput, parseRefundInput, parseRefundReviewInput } from "../apps/api/src/payments";

describe("payment proof validation", () => {
  it("accepts a payment proof reference and minor-unit amount", () => {
    expect(parsePaymentInput({ method: "wechat", amountMinor: 12500, transactionRef: "TX-001", proofAssetId: "asset-1" })).toEqual({ method: "wechat", amountMinor: 12500, transactionRef: "TX-001", proofAssetId: "asset-1" });
  });

  it("rejects non-positive payment amounts and invalid review status", () => {
    expect(() => parsePaymentInput({ method: "wechat", amountMinor: 0 })).toThrow(BusinessValidationError);
    expect(() => parsePaymentReviewInput({ status: "pending_review" })).toThrow("approved 或 rejected");
  });

  it("rejects removed payment methods and accepts only the three configured channels", () => {
    for (const method of ["bank_transfer", "cash", "other"]) {
      expect(() => parsePaymentInput({ method, amountMinor: 100 })).toThrow("支付方式仅支持微信、支付宝或数字货币");
    }
    for (const method of ["wechat", "alipay", "crypto"]) {
      expect(parsePaymentInput({ method, amountMinor: 100 }).method).toBe(method);
    }
  });

  it("preserves a supplied payment idempotency key and rejects an empty one", () => {
    expect(parsePaymentInput({ method: "wechat", amountMinor: 100, idempotencyKey: "pay-request-1" }).idempotencyKey).toBe("pay-request-1");
    expect(() => parsePaymentInput({ method: "wechat", amountMinor: 100, idempotencyKey: " " })).toThrow("idempotency_key 不能为空");
  });
});

describe("refund ledger validation", () => {
  it("requires a positive amount and a reason", () => {
    expect(parseRefundInput({ amountMinor: 5000, reason: "campaign cancelled" })).toMatchObject({ amountMinor: 5000, reason: "campaign cancelled" });
    expect(() => parseRefundInput({ amountMinor: 5000 })).toThrow("refund_reason 不能为空");
  });

  it("rejects the removed methods for new refund requests", () => {
    for (const method of ["cash", "bank_transfer", "other"]) {
      expect(() => parseRefundInput({ amountMinor: 100, reason: "test", method })).toThrow("退款申请方式仅支持微信、支付宝或数字货币");
    }
    for (const method of ["wechat", "alipay", "crypto"]) {
      expect(parseRefundInput({ amountMinor: 100, reason: "test", method }).method).toBe(method);
    }
  });

  it("only accepts explicit finance review decisions", () => {
    expect(parseRefundReviewInput({ status: "approved", note: "verified" })).toEqual({ status: "approved", note: "verified" });
    expect(() => parseRefundReviewInput({ status: "queued" })).toThrow(BusinessValidationError);
  });

  it("preserves a supplied refund idempotency key", () => {
    expect(parseRefundInput({ amountMinor: 100, reason: "correction", idempotencyKey: "refund-request-1" }).idempotencyKey).toBe("refund-request-1");
  });
});
