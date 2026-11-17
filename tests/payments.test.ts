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
});
