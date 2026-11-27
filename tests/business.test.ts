import { describe, expect, it } from "vitest";
import { BusinessValidationError, canTransitionOrder, parseCustomerInput, parseOrderContent, parsePackageInput } from "../apps/api/src/business";
import { ASSET_OPTIONS, resolveAsset } from "../apps/api/src/money";
import { ASSETS, formatMoney, parseAtomicAmount } from "../apps/web/src/lib/money";

describe("CRM and package validation", () => {
  it("normalizes customer fields and rejects invalid status", () => {
    expect(parseCustomerInput({ name: " Acme ", contact: "sales@example.test", status: "vip" })).toMatchObject({ name: "Acme", contact: "sales@example.test", status: "vip" });
    expect(() => parseCustomerInput({ name: "Acme", status: "unknown" })).toThrow(BusinessValidationError);
  });

  it("validates package prices and publishing settings", () => {
    expect(parsePackageInput({ name: "首页置顶", adType: "photo", priceMinor: 10000, discountPriceMinor: 8000, publishCount: 2 })).toMatchObject({ priceMinor: 10000, discountPriceMinor: 8000, publishCount: 2 });
    expect(() => parsePackageInput({ name: "bad", adType: "text", priceMinor: 100, discountPriceMinor: 101 })).toThrow("折扣价不能高于原价");
  });

  it("offers assets in the requested order and validates each asset's precision/network", () => {
    expect(ASSET_OPTIONS.map((asset) => asset.code)).toEqual(["CNY", "USD", "TON", "USDT"]);
    expect(ASSETS.map((asset) => asset.label)).toEqual(["CNY", "USD", "TON", "USDT"]);
    expect(resolveAsset("cny")).toEqual({ currency: "CNY", scale: 2, network: null });
    expect(resolveAsset("USD")).toEqual({ currency: "USD", scale: 2, network: null });
    expect(resolveAsset("TON")).toEqual({ currency: "TON", scale: 9, network: "TON" });
    expect(resolveAsset("USDT", "trON")).toEqual({ currency: "USDT", scale: 6, network: "TRON" });
    expect(ASSET_OPTIONS.find((asset) => asset.code === "USDT")?.networks).toEqual(["TON", "TRON"]);
    expect(() => resolveAsset("USDT")).toThrow("必须选择支持的网络");
    expect(() => resolveAsset("USDT", "ETHEREUM")).toThrow("必须选择支持的网络");
    expect(() => resolveAsset("CNY", "TRON")).toThrow("不应填写区块链网络");
    expect(() => resolveAsset("BTC")).toThrow("仅支持 CNY、USD、TON、USDT");
  });

  it("parses decimal display amounts exactly into bounded atomic units", () => {
    expect(parseAtomicAmount("12.34", 2)).toBe(1234);
    expect(parseAtomicAmount("0.000000001", 9)).toBe(1);
    expect(parseAtomicAmount(" 3 ", 6)).toBe(3_000_000);
    expect(formatMoney(123_456_789, "TON", 9, "TON")).toBe("0.123456789 TON · TON");
    expect(formatMoney(1_234_567, "USDT", 6, "TRON")).toBe("1.234567 USDT · TRON");
    expect(() => parseAtomicAmount("1.001", 2)).toThrow("最多支持 2 位小数");
    expect(() => parseAtomicAmount("1e3", 2)).toThrow();
    expect(() => parseAtomicAmount("0", 6)).toThrow("大于 0");
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
