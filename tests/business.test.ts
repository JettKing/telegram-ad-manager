import { describe, expect, it } from "vitest";
import { BusinessValidationError, canTransitionOrder, parseCustomerInput, parseOrderContent, parsePackageInput } from "../apps/api/src/business";

describe("CRM and package validation", () => {
  it("normalizes customer fields and rejects invalid status", () => {
    expect(parseCustomerInput({ name: " Acme ", contact: "sales@example.test", status: "vip" })).toMatchObject({ name: "Acme", contact: "sales@example.test", status: "vip" });
    expect(() => parseCustomerInput({ name: "Acme", status: "unknown" })).toThrow(BusinessValidationError);
  });

  it("validates package prices and publishing settings", () => {
    expect(parsePackageInput({ name: "首页置顶", adType: "photo", priceMinor: 10000, discountPriceMinor: 8000, publishCount: 2 })).toMatchObject({ priceMinor: 10000, discountPriceMinor: 8000, publishCount: 2 });
    expect(() => parsePackageInput({ name: "bad", adType: "text", priceMinor: 100, discountPriceMinor: 101 })).toThrow("折扣价不能高于原价");
  });
});

describe("order editor and state transitions", () => {
  it("deduplicates asset references and caps editor text", () => {
    expect(parseOrderContent({ text: "广告", assetIds: ["a", "a", "b"], entities: [{ type: "bold" }] })).toEqual({ text: "广告", assetIds: ["a", "b"], entities: [{ type: "bold" }] });
    expect(() => parseOrderContent({ text: "x".repeat(4097) })).toThrow("不能超过 4096");
  });

  it("allows only explicit order lifecycle transitions", () => {
    expect(canTransitionOrder("draft", "pending_payment")).toBe(true);
    expect(canTransitionOrder("draft", "published")).toBe(false);
    expect(canTransitionOrder("published", "completed")).toBe(true);
    expect(canTransitionOrder("completed", "draft")).toBe(false);
  });
});
