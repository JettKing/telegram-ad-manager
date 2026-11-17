import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { app } from "../apps/api/src/app";
import { MemoryWebhookUpdateStore, validateTelegramInitData, validateWebhookSecret } from "@tg-ad-manager/telegram";

function createSignedInitData(botToken: string, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAHdF6IQ",
    user: JSON.stringify({ id: 123456789, first_name: "Test", username: "tester" }),
  });
  const dataCheckString = [...params.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = createHmac("sha256", botToken).update("WebAppData").digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("Telegram Mini App authentication", () => {
  it("validates the official bot-token HMAC format", async () => {
    const now = 1_700_000_000;
    const result = await validateTelegramInitData(createSignedInitData("123456:ABC", now), "123456:ABC", { nowSeconds: now });
    expect(result.valid).toBe(true);
    expect(result.user?.id).toBe(123456789);
  });

  it("rejects tampering and stale auth_date", async () => {
    const now = 1_700_000_000;
    const signed = createSignedInitData("123456:ABC", now);
    const tampered = signed.replace("tester", "attacker");
    expect((await validateTelegramInitData(tampered, "123456:ABC", { nowSeconds: now })).reason).toBe("invalid_signature");
    expect((await validateTelegramInitData(createSignedInitData("123456:ABC", now - 86_401), "123456:ABC", { nowSeconds: now })).reason).toBe("expired");
  });

  it("fails closed on a replay store hit", async () => {
    const now = 1_700_000_000;
    const signed = createSignedInitData("123456:ABC", now);
    const store = new MemoryWebhookUpdateStore();
    const replayStore = {
      seen: new Set<string>(),
      async has(key: string) { return this.seen.has(key); },
      async put(record: { replayKey: string }) { this.seen.add(record.replayKey); },
    };
    const first = await validateTelegramInitData(signed, "123456:ABC", { nowSeconds: now, replayStore });
    const second = await validateTelegramInitData(signed, "123456:ABC", { nowSeconds: now, replayStore });
    expect(first.valid).toBe(true);
    expect(second.reason).toBe("replay");
    expect(await store.claim({ update_id: 1 })).toEqual({ accepted: true, duplicate: false });
  });
});

describe("Telegram Webhook", () => {
  it("uses constant-time secret matching semantics", () => {
    expect(validateWebhookSecret("s3cr3t_token", "s3cr3t_token")).toBe(true);
    expect(validateWebhookSecret("s3cr3t_token", "wrong")).toBe(false);
  });

  it("rejects unauthorized requests and deduplicates accepted update_ids", async () => {
    const payload = JSON.stringify({ update_id: 88001, message: { text: "/start" } });
    const unauthorized = await app.request("/webhooks/telegram", { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "wrong" }, body: payload }, { TELEGRAM_WEBHOOK_SECRET: "expected" });
    expect(unauthorized.status).toBe(401);

    const first = await app.request("/webhooks/telegram", { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "expected" }, body: payload }, { TELEGRAM_WEBHOOK_SECRET: "expected" });
    const second = await app.request("/webhooks/telegram", { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "expected" }, body: payload }, { TELEGRAM_WEBHOOK_SECRET: "expected" });
    expect(first.status).toBe(200);
    expect((await first.json()).data.duplicate).toBe(false);
    expect((await second.json()).data.duplicate).toBe(true);
  });
});
