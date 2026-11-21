import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { app, parseStartCommand } from "../apps/api/src/app";
import { MemoryWebhookUpdateStore, validateTelegramInitData, validateWebhookSecret } from "@tg-ad-manager/telegram";

// Offline fixture generated independently with OpenSSL and cross-checked with
// Python's hmac: HMAC-SHA256(key="WebAppData", message="123456:ABC") gives
// 2556576108416a8008e2feec1a78c979a5ae6cad6f1d9c6a79e8d16781f77f11.
// The data-check-string is exactly (with LF separators and no trailing LF):
// auth_date=1700000000
// query_id=AAHdF6IQ
// user={"id":123456789,"first_name":"Test User","username":"tester"}
const FIXTURE_TOKEN = "123456:ABC";
const FIXTURE_NOW = 1_700_000_000;
const FIXTURE_HASH = "2fb923794c39d61e8754dbbc468c2c0f3d62eb4f4ef52ba70b61ff9588b40bd7";
const INCORRECT_LEGACY_HASH = "3ae938c39f320693ffc08d9a8d680450eefdfe7ae83ee706d9f7d6d2d2d6d43d";
const FIXTURE_INIT_DATA = "auth_date=1700000000&query_id=AAHdF6IQ&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test+User%22%2C%22username%22%3A%22tester%22%7D&hash=" + FIXTURE_HASH;

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
  it("validates an independently generated fixed bot-token HMAC vector", async () => {
    const result = await validateTelegramInitData(FIXTURE_INIT_DATA, FIXTURE_TOKEN, { nowSeconds: FIXTURE_NOW });
    expect(result).toMatchObject({
      valid: true,
      userId: "123456789",
      authDate: FIXTURE_NOW,
      user: { id: 123456789, first_name: "Test User", username: "tester" },
    });
    expect(result.replayKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects the old reversed-key algorithm, tampering, and forged signatures", async () => {
    const invalidCases = [
      FIXTURE_INIT_DATA.replace(FIXTURE_HASH, INCORRECT_LEGACY_HASH),
      FIXTURE_INIT_DATA.replace("tester", "attacker"),
      FIXTURE_INIT_DATA.replace(FIXTURE_HASH, "0".repeat(64)),
      FIXTURE_INIT_DATA.replace(FIXTURE_HASH, "not-a-sha256-hash"),
    ];
    for (const initData of invalidCases) {
      expect(await validateTelegramInitData(initData, FIXTURE_TOKEN, { nowSeconds: FIXTURE_NOW })).toMatchObject({ valid: false, reason: "invalid_signature" });
    }
    expect(await validateTelegramInitData(FIXTURE_INIT_DATA, "wrong-token", { nowSeconds: FIXTURE_NOW })).toMatchObject({ valid: false, reason: "invalid_signature" });
  });

  it("retains age and future-skew boundaries and supports explicit limits", async () => {
    const validateAt = (authDate: number, options: { maxAgeSeconds?: number; maxFutureSkewSeconds?: number } = {}) =>
      validateTelegramInitData(createSignedInitData(FIXTURE_TOKEN, authDate), FIXTURE_TOKEN, { nowSeconds: FIXTURE_NOW, ...options });

    expect((await validateAt(FIXTURE_NOW - 86_400)).valid).toBe(true);
    expect((await validateAt(FIXTURE_NOW - 86_401)).reason).toBe("expired");
    expect((await validateAt(FIXTURE_NOW + 60)).valid).toBe(true);
    expect((await validateAt(FIXTURE_NOW + 61)).reason).toBe("expired");
    expect((await validateAt(FIXTURE_NOW - 120, { maxAgeSeconds: 120 })).valid).toBe(true);
    expect((await validateAt(FIXTURE_NOW - 120, { maxAgeSeconds: 119 })).reason).toBe("expired");
    expect((await validateAt(FIXTURE_NOW + 2, { maxFutureSkewSeconds: 1 })).reason).toBe("expired");
  });

  it("rejects reordered or differently encoded replays with the has/put store", async () => {
    const replayStore = {
      seen: new Set<string>(),
      records: [] as Array<{ replayKey: string; userId: string; authDate: number; expiresAt: number }>,
      async has(key: string) { return this.seen.has(key); },
      async put(record: { replayKey: string; userId: string; authDate: number; expiresAt: number }) { this.seen.add(record.replayKey); this.records.push(record); },
    };
    const options = { nowSeconds: FIXTURE_NOW, maxAgeSeconds: 1_000, replayStore };
    const first = await validateTelegramInitData(FIXTURE_INIT_DATA, FIXTURE_TOKEN, options);
    expect(first.valid).toBe(true);
    expect(replayStore.records).toEqual([{ replayKey: first.replayKey, userId: "123456789", authDate: FIXTURE_NOW, expiresAt: FIXTURE_NOW + 1_000 }]);

    const variants = [
      FIXTURE_INIT_DATA,
      FIXTURE_INIT_DATA.split("&").reverse().join("&"),
      FIXTURE_INIT_DATA.replace("Test+User", "Test%20User"),
      FIXTURE_INIT_DATA.replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase()),
      FIXTURE_INIT_DATA + "&hash=ignored-duplicate",
    ];
    for (const variant of variants) {
      const replay = await validateTelegramInitData(variant, FIXTURE_TOKEN, options);
      expect(replay).toMatchObject({ valid: false, reason: "replay", replayKey: first.replayKey });
    }
    expect(replayStore.records).toHaveLength(1);
  });

  it("uses atomic claim for concurrently submitted equivalent initData", async () => {
    const replayStore = {
      seen: new Set<string>(),
      async has(_key: string): Promise<boolean> { throw new Error("claim should be used"); },
      async put(_record: { replayKey: string }): Promise<void> { throw new Error("claim should be used"); },
      async claim(record: { replayKey: string }) {
        if (this.seen.has(record.replayKey)) return false;
        this.seen.add(record.replayKey);
        return true;
      },
    };
    const options = { nowSeconds: FIXTURE_NOW, replayStore };
    const results = await Promise.all([
      validateTelegramInitData(FIXTURE_INIT_DATA, FIXTURE_TOKEN, options),
      validateTelegramInitData(FIXTURE_INIT_DATA.split("&").reverse().join("&"), FIXTURE_TOKEN, options),
    ]);
    expect(results.filter((result) => result.valid)).toHaveLength(1);
    expect(results.filter((result) => result.reason === "replay")).toHaveLength(1);
    expect(results[0].replayKey).toBe(results[1].replayKey);
    expect(replayStore.seen.size).toBe(1);
  });

  it("fails closed when the replay store is unavailable and does not claim invalid signatures", async () => {
    let claims = 0;
    const replayStore = {
      async has(_key: string): Promise<boolean> { throw new Error("unavailable"); },
      async put(_record: { replayKey: string }): Promise<void> { throw new Error("unavailable"); },
      async claim(_record: { replayKey: string }): Promise<boolean> { claims += 1; throw new Error("unavailable"); },
    };
    const options = { nowSeconds: FIXTURE_NOW, replayStore };
    expect((await validateTelegramInitData(FIXTURE_INIT_DATA.replace(FIXTURE_HASH, INCORRECT_LEGACY_HASH), FIXTURE_TOKEN, options)).reason).toBe("invalid_signature");
    expect(claims).toBe(0);
    expect((await validateTelegramInitData(FIXTURE_INIT_DATA, FIXTURE_TOKEN, options)).reason).toBe("replay_store_unavailable");
    expect(claims).toBe(1);

    const fallbackStore = {
      async has(_key: string): Promise<boolean> { throw new Error("unavailable"); },
      async put(_record: { replayKey: string }): Promise<void> { throw new Error("unavailable"); },
    };
    expect((await validateTelegramInitData(FIXTURE_INIT_DATA, FIXTURE_TOKEN, { nowSeconds: FIXTURE_NOW, replayStore: fallbackStore })).reason).toBe("replay_store_unavailable");
  });

  it("authenticates the fixed vector through the API and rejects a reordered replay", async () => {
    const seen = new Set<string>();
    let sessionWrites = 0;
    const db = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first<T>(): Promise<T | null> {
                if (query.includes("FROM users WHERE telegram_user_id")) return { id: "user-1", telegram_user_id: "123456789", display_name: "Test User" } as T;
                if (query.includes("FROM tenant_members tm")) return { tenant_id: "tenant-1", tenant_name: "Test Tenant", tenant_slug: "test", role: "owner" } as T;
                if (query.includes("FROM workspaces w")) return { id: "workspace-1", name: "Test Workspace" } as T;
                if (query.includes("FROM tenant_subscriptions")) return null;
                throw new Error(`Unexpected query: ${query}`);
              },
              async run() {
                if (query.includes("INSERT OR IGNORE INTO telegram_init_data_replays")) {
                  const key = String(values[0]);
                  if (seen.has(key)) return { meta: { changes: 0 } };
                  seen.add(key);
                } else if (query.includes("INSERT INTO user_sessions")) {
                  sessionWrites += 1;
                } else if (!query.includes("INSERT INTO users") && !query.includes("INSERT INTO tenant_subscriptions")) {
                  throw new Error(`Unexpected query: ${query}`);
                }
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };
    const env = { DB: db, SESSION_SECRET: "test-session-secret", TELEGRAM_BOT_TOKEN: FIXTURE_TOKEN, D1_SCHEMA_CONTRACT: "legacy" };
    const request = (initData: string) => app.request("/api/v1/auth/telegram", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData }),
    }, env);
    const clock = vi.spyOn(Date, "now").mockReturnValue(FIXTURE_NOW * 1_000);
    try {
      const invalid = await request(FIXTURE_INIT_DATA.replace(FIXTURE_HASH, INCORRECT_LEGACY_HASH));
      expect(invalid.status).toBe(401);
      expect(sessionWrites).toBe(0);
      expect(seen.size).toBe(0);

      const valid = await request(FIXTURE_INIT_DATA);
      expect(valid.status).toBe(200);
      expect(await valid.json()).toMatchObject({ ok: true, data: { authenticated: true, user: { telegramUserId: "123456789" } } });
      expect(sessionWrites).toBe(1);

      const replay = await request(FIXTURE_INIT_DATA.split("&").reverse().join("&"));
      expect(replay.status).toBe(401);
      expect(await replay.json()).toMatchObject({ ok: false, error: { code: "TELEGRAM_REPLAY" } });
      expect(sessionWrites).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("Telegram Webhook", () => {
  it("claims a new webhook update in the memory store", async () => {
    const store = new MemoryWebhookUpdateStore();
    expect(await store.claim({ update_id: 1 })).toEqual({ accepted: true, duplicate: false });
  });

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
