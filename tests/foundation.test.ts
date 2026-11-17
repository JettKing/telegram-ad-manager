import { describe, expect, it } from "vitest";
import { telegramServiceState, validateTelegramInitData } from "@tg-ad-manager/telegram";

const validShape = new URLSearchParams({
  auth_date: String(Math.floor(Date.now() / 1000)),
  user: JSON.stringify({ id: 123 }),
  hash: "not-a-real-hash",
}).toString();

describe("foundation boundaries", () => {
  it("does not claim Telegram is configured without a bot token", () => {
    expect(telegramServiceState(undefined)).toBe("not_configured");
    expect(telegramServiceState("  ")).toBe("not_configured");
  });

  it("rejects missing initData before any user identity is trusted", () => {
    expect(validateTelegramInitData(undefined, "token")).toEqual({ valid: false, reason: "missing" });
  });

  it("rejects unsigned initData instead of trusting the user payload", () => {
    expect(validateTelegramInitData(validShape, "token")).toEqual({ valid: false, reason: "invalid_signature" });
  });
});
