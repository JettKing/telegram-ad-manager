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

  it("rejects a replayed D1 initData even when it belongs to the same user", async () => {
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
    expect(await store.claim(record)).toBe(false);
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

  it("retries a failed media ingestion and suppresses duplicates after completion", async () => {
    const updates = new Map<number, { status: string; received_at: string }>();
    const queries: string[] = [];
    let failFirstAssetInsert = true;
    let successfulAssetInserts = 0;
    const db = {
      prepare(query: string) {
        queries.push(query);
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                if (query.includes("INSERT OR IGNORE INTO telegram_updates")) {
                  const updateId = Number(values[0]);
                  if (updates.has(updateId)) return { meta: { changes: 0 } };
                  updates.set(updateId, { status: "received", received_at: String(values[3]) });
                }
                if (query.includes("DELETE FROM telegram_updates")) {
                  const updateId = Number(values[0]);
                  const current = updates.get(updateId);
                  if (current?.status === "received") { updates.delete(updateId); return { meta: { changes: 1 } }; }
                  return { meta: { changes: 0 } };
                }
                if (query.includes("UPDATE telegram_updates SET status = 'processed'")) {
                  const updateId = Number(values[1]);
                  const current = updates.get(updateId);
                  if (current) current.status = "processed";
                }
                if (query.includes("INSERT INTO media_assets")) {
                  if (failFirstAssetInsert) { failFirstAssetInsert = false; throw new Error("simulated temporary D1 failure"); }
                  successfulAssetInserts += 1;
                }
                return { meta: { changes: 1 } };
              },
              async first<T>() {
                if (query.includes("FROM telegram_updates")) return (updates.get(Number(values[0])) ?? null) as T;
                if (query.includes("FROM users u JOIN")) return { tenantId: "tenant", workspaceId: "workspace" } as T;
                if (query.includes("FROM media_assets") && query.includes("tenant_id, workspace_id")) return null;
                if (query.includes("SELECT id FROM media_assets")) return { id: "asset" } as T;
                if (query.includes("FROM media_groups")) return null;
                return null;
              },
            };
          },
        };
      },
    } as never;
    const payload = JSON.stringify({ update_id: 99001, message: { message_id: 700, date: 1794873600, chat: { id: 123, type: "private" }, from: { id: 456 }, photo: [{ file_id: "photo-1" }] } });
    const env = { DB: db, TELEGRAM_WEBHOOK_SECRET: "expected", TELEGRAM_BOT_IDENTITY_ID: "bot-1" } as never;
    const request = () => app.request("/webhooks/telegram", { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "expected" }, body: payload }, env);
    const failedAttempt = await request();
    const retriedAttempt = await request();
    const duplicateAfterCompletion = await request();
    expect(failedAttempt.status).toBe(503);
    expect(retriedAttempt.status).toBe(200);
    expect((await retriedAttempt.json()).data).toMatchObject({ accepted: true, duplicate: false, media: { handled: true, reason: "stored" } });
    expect(duplicateAfterCompletion.status).toBe(200);
    expect((await duplicateAfterCompletion.json()).data).toMatchObject({ duplicate: true, media: { handled: false, reason: "duplicate_update" } });
    expect(queries.filter((query) => query.includes("FROM users u JOIN"))).toHaveLength(2);
    expect(successfulAssetInserts).toBe(1);
  });

  it("allows the configured Mini App origin to read the readiness probe", async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ ready: 1 }) }) }) } as never;
    const origin = "https://telegram-ad-manager.pages.dev";
    const env = { DB: db, D1_SCHEMA_CONTRACT: "production-0009", TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "webhook-secret", TELEGRAM_BOT_IDENTITY_ID: "bot-1", SESSION_SECRET: "session-secret", R2_BUCKET: { put: async () => undefined, get: async () => null, delete: async () => undefined }, WEB_APP_ORIGIN: origin };
    const response = await app.request("/health/ready", { headers: { Origin: origin } }, env as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);

    const untrusted = await app.request("/health/ready", { headers: { Origin: "https://untrusted.example" } }, env as never);
    expect(untrusted.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("marks readiness blocked when the required R2 proof bucket is missing", async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ ready: 1 }) }) }) } as never;
    const baseEnv = { DB: db, D1_SCHEMA_CONTRACT: "production-0009", TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "webhook-secret", TELEGRAM_BOT_IDENTITY_ID: "bot-1", SESSION_SECRET: "session-secret", WEB_APP_ORIGIN: "https://telegram-ad-manager.pages.dev" };
    const blocked = await app.request("/health/ready", {}, baseEnv as never);
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).blocking).toContain("r2");

    const ready = await app.request("/health/ready", {}, { ...baseEnv, R2_BUCKET: { put: async () => undefined, get: async () => null, delete: async () => undefined } } as never);
    expect(ready.status).toBe(200);
    expect((await ready.json()).ready).toBe(true);
  });

  it("reports missing session, origin, webhook, bot identity and production schema readiness dependencies", async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ ready: 1 }) }) }) } as never;
    const response = await app.request("/health/ready", {}, { DB: db, TELEGRAM_BOT_TOKEN: "test-token", R2_BUCKET: { put: async () => undefined, get: async () => null, delete: async () => undefined } } as never);
    expect(response.status).toBe(503);
    expect((await response.json()).blocking).toEqual(expect.arrayContaining(["session_secret", "web_app_origin", "telegram_webhook_secret", "telegram_bot_identity", "database_schema"]));
  });

  it("fails closed instead of using in-memory deduplication in production when webhook persistence is missing", async () => {
    const response = await app.request("/webhooks/telegram", { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "expected" }, body: JSON.stringify({ update_id: 99002 }) }, { ENVIRONMENT: "production", TELEGRAM_WEBHOOK_SECRET: "expected" } as never);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("WEBHOOK_PERSISTENCE_NOT_CONFIGURED");
  });
});
