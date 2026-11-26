import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { app, parseStartCommand } from "../apps/api/src/app";
import { D1ReplayStore, MemoryWebhookUpdateStore, validateTelegramInitData, validateWebhookSecret } from "@tg-ad-manager/telegram";

function createSignedInitData(botToken: string, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAHdF6IQ",
    user: JSON.stringify({ id: 123456789, first_name: "Test", username: "tester" }),
  });
  const dataCheckString = [...params.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
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

  it("allows the same valid D1 initData to be retried by the same user", async () => {
    const rows = new Map<string, { replay_key: string; telegram_user_id: string; expires_at: number }>();
    const db = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                const key = String(values[0]);
                if (rows.has(key)) return { meta: { changes: 0 } };
                rows.set(key, { replay_key: key, telegram_user_id: String(values[1]), expires_at: Number(values[3]) });
                return { meta: { changes: 1 } };
              },
              async first<T>() {
                if (!query.includes("telegram_user_id")) return null;
                const row = rows.get(String(values[0]));
                return row && row.telegram_user_id === String(values[1]) && row.expires_at > Math.floor(Date.now() / 1000) ? row as T : null;
              },
            };
          },
        };
      },
    };
    const store = new D1ReplayStore(db);
    const record = { replayKey: "same-init-data", userId: "123456789", authDate: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 300 };
    expect(await store.claim(record)).toBe(true);
    expect(await store.claim(record)).toBe(true);
    expect(await store.claim({ ...record, userId: "987654321" })).toBe(false);
  });
});

describe("Telegram Webhook", () => {
  it("parses private /start commands and ignores group messages", () => {
    expect(parseStartCommand({ message: { chat: { id: 6092237879, type: "private" }, text: "/start invite_abc" } })).toEqual({ chatId: "6092237879", payload: "invite_abc" });
    expect(parseStartCommand({ message: { chat: { id: 6092237879, type: "private" }, text: "/start@TGAdOpsBot" } })).toEqual({ chatId: "6092237879" });
    expect(parseStartCommand({ message: { chat: { id: -100123, type: "supergroup" }, text: "/start" } })).toBeNull();
    expect(parseStartCommand({ message: { chat: { id: 6092237879, type: "private" }, text: "hello /start" } })).toBeNull();
  });

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
