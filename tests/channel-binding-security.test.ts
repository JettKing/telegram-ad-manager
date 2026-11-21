import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Like } from "@tg-ad-manager/telegram";
import { app } from "../apps/api/src/app";
import { D1ChannelRepository, verifyTelegramChannelForBinding, type TelegramBotApi, type VerifiedChannel } from "../apps/api/src/channels";
import { ProductionChannelRepository } from "../apps/api/src/production-channels";
import { issuePlatformSession, type ProvisionedIdentity } from "../apps/api/src/identity";
import { issueProductionPlatformSession } from "../apps/api/src/production-identity";

// Vite's built-in module list predates node:sqlite; require delegates it to Node.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const now = "2026-11-21T00:00:00.000Z";
const token = "123:VERY_SECRET_BOT_TOKEN";
const secret = "session-secret";
type Schema = "legacy" | "production";

// Production base migrations are not in this repository. This fixture models the columns,
// foreign keys and unique conflict key used by the production adapter, not the full schema.
const productionSchema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id TEXT PRIMARY KEY, telegram_user_id TEXT NOT NULL UNIQUE, is_active INTEGER NOT NULL);
  CREATE TABLE tenants (id TEXT PRIMARY KEY);
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE tenant_members (tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, status TEXT NOT NULL);
  CREATE TABLE user_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL, last_seen_at TEXT);
  CREATE TABLE telegram_bot_identities (id TEXT PRIMARY KEY);
  CREATE TABLE telegram_channels (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), bot_identity_id TEXT NOT NULL REFERENCES telegram_bot_identities(id), telegram_chat_id TEXT NOT NULL, username TEXT, title TEXT NOT NULL, status TEXT NOT NULL, last_verified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (bot_identity_id, telegram_chat_id));
  CREATE TABLE telegram_channel_permissions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), channel_id TEXT NOT NULL REFERENCES telegram_channels(id), can_post_messages INTEGER NOT NULL, can_pin_messages INTEGER NOT NULL, can_delete_messages INTEGER NOT NULL, checked_at TEXT NOT NULL, error_code TEXT, error_message TEXT);
`;

function makeDb(schema: Schema) {
  const sqlite = new DatabaseSync(":memory:");
  if (schema === "legacy") {
    sqlite.exec(readFileSync(new URL("../apps/api/migrations/0001_core.sql", import.meta.url), "utf8"));
    sqlite.exec(readFileSync(new URL("../apps/api/migrations/0003_platform_operations.sql", import.meta.url), "utf8"));
    sqlite.exec(`
      INSERT INTO tenants VALUES ('t1','Tenant 1','t1','active','${now}','${now}'), ('t2','Tenant 2','t2','active','${now}','${now}');
      INSERT INTO workspaces VALUES ('w1','t1','Workspace 1','w1','active','${now}','${now}'), ('w2','t2','Workspace 2','w2','active','${now}','${now}'), ('w3','t1','Workspace 3','w3','active','${now}','${now}');
      INSERT INTO telegram_bot_identities VALUES ('bot',NULL,'secret-ref','secret-ref','active','${now}','${now}');
      INSERT INTO subscription_plans VALUES ('plan','test','Test','monthly',0,1,'${now}','${now}');
      INSERT INTO subscription_entitlements VALUES ('plan','max_channels',NULL,1);
      INSERT INTO tenant_subscriptions VALUES ('s1','t1','plan','active','${now}','9999-01-01T00:00:00.000Z',1,'${now}','${now}'), ('s2','t2','plan','active','${now}','9999-01-01T00:00:00.000Z',1,'${now}','${now}');
    `);
  } else {
    sqlite.exec(productionSchema);
    sqlite.exec(`
      INSERT INTO tenants VALUES ('t1'), ('t2');
      INSERT INTO workspaces VALUES ('w1','t1','active','${now}'), ('w2','t2','active','${now}'), ('w3','t1','active','${now}');
      INSERT INTO telegram_bot_identities VALUES ('bot');
    `);
  }
  const writes: string[] = [];
  const db: D1Like = {
    prepare(query) {
      return {
        bind(...values: unknown[]) {
          const args = values as SQLInputValue[];
          return {
            async first<T>() {
              if (/^\s*(INSERT|UPDATE|DELETE)/i.test(query)) writes.push(query);
              return (sqlite.prepare(query).get(...args) as T | undefined) ?? null;
            },
            async all<T>() { return { results: sqlite.prepare(query).all(...args) as T[] }; },
            async run() {
              if (/^\s*(INSERT|UPDATE|DELETE)/i.test(query)) writes.push(query);
              const result = sqlite.prepare(query).run(...args);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
  };
  return { sqlite, db, writes };
}

const verified: VerifiedChannel = {
  telegramChatId: "-100123", title: "Original", username: "test_channel",
  permissions: { canPost: true, canPin: true, canDelete: false, botStatus: "administrator", checkedAt: now },
};
const input = (tenantId: string, workspaceId: string, channel = verified) => ({ tenantId, workspaceId, botIdentityId: "bot", verified: channel, now });

async function session(db: D1Like, sqlite: DatabaseSyncType, schema: Schema, telegramUserId = "123", tenantId = "t1", workspaceId = "w1") {
  const userId = `user-${telegramUserId}-${tenantId}`;
  if (schema === "legacy") {
    sqlite.prepare("INSERT INTO users VALUES (?, ?, NULL, 'User', 1, ?, ?)").run(userId, telegramUserId, now, now);
    sqlite.prepare("INSERT INTO tenant_members VALUES (?, ?, 'owner', 'active', ?, ?)").run(tenantId, userId, now, now);
    sqlite.prepare("INSERT INTO workspace_members VALUES (?, ?, 'owner', ?, ?)").run(workspaceId, userId, now, now);
  } else {
    sqlite.prepare("INSERT INTO users VALUES (?, ?, 1)").run(userId, telegramUserId);
    sqlite.prepare("INSERT INTO tenant_members VALUES (?, ?, 'owner', 'active', ?)").run(tenantId, userId, now);
    sqlite.prepare("INSERT INTO workspace_members VALUES (?, ?, ?, 'owner', 'active')").run(workspaceId, tenantId, userId);
  }
  const identity: ProvisionedIdentity = { userId, telegramUserId, displayName: "User", tenantId, tenantName: "Tenant", workspaceId, workspaceName: "Workspace", role: "owner" };
  return schema === "legacy" ? (await issuePlatformSession(db, identity, secret)).token : (await issueProductionPlatformSession(db, identity, secret)).token;
}

type FakeOptions = { userStatus?: string; botStatus?: string; userFailure?: boolean; userApiError?: boolean; wrongUser?: boolean; missingUser?: boolean; userIsBot?: boolean; chatType?: string; chatId?: number; botCanPost?: boolean };
function mockTelegram(options: FakeOptions = {}) {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    // Never contact Telegram or any other network: every fetch is answered locally.
    const method = String(url).split("/").pop()!;
    const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ method, payload });
    let result: unknown;
    if (method === "getChat") result = { id: options.chatId ?? -100123, type: options.chatType ?? "channel", title: "Test", username: "test_channel" };
    else if (method === "getMe") result = { id: 99, is_bot: true, first_name: "Bot" };
    else if (method === "getChatMember" && payload.user_id === 99) result = { status: options.botStatus ?? "administrator", user: { id: 99, is_bot: true, first_name: "Bot" }, can_post_messages: options.botCanPost ?? true, can_edit_messages: true };
    else if (method === "getChatMember") {
      if (options.userFailure) throw new Error(`network error https://api.telegram.org/bot${token}/getChatMember`);
      if (options.userApiError) return new Response(JSON.stringify({ ok: false, error_code: 400, description: `failure ${token}` }), { status: 400 });
      result = { status: options.userStatus ?? "administrator", ...(options.missingUser ? {} : { user: { id: options.wrongUser ? 777 : payload.user_id, is_bot: options.userIsBot ?? false, first_name: "User" } }) };
    } else throw new Error(`Unexpected method ${method}`);
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

function request(schema: Schema, db: D1Like, sessionToken: string, path = "/api/v1/channels/bind", body: unknown = { chatId: "@test_channel" }) {
  return app.request(path, { method: "POST", headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" }, body: JSON.stringify(body) }, {
    DB: db, SESSION_SECRET: secret, TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_IDENTITY_ID: "bot", TELEGRAM_API_BASE_URL: "https://telegram.invalid", ...(schema === "production" ? { D1_SCHEMA_CONTRACT: "production-0009" } : {}),
  });
}

function rows(sqlite: DatabaseSyncType, table: string) { return sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((row) => ({ ...row })); }
function permissionWrites(writes: string[]) { return writes.filter((query) => /^(?:\s*)(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?telegram_channel_permissions/i.test(query)); }

// Pause one actual SQLite operation, allowing an independent request to commit first.
function gateDb(db: D1Like, matches: (query: string) => boolean) {
  let signalReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => { signalReached = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  let triggered = false;
  const wait = async (query: string) => {
    if (!triggered && matches(query)) { triggered = true; signalReached(); await released; }
  };
  const gated: D1Like = {
    prepare(query) {
      const prepared = db.prepare(query);
      return {
        bind(...values: unknown[]) {
          const statement = prepared.bind(...values);
          return {
            async first<T>() { await wait(query); return statement.first<T>(); },
            async all<T>() { await wait(query); return statement.all ? statement.all<T>() : { results: [] }; },
            async run() { await wait(query); return statement.run(); },
          };
        },
      };
    },
  };
  return { db: gated, reached, release };
}

afterEach(() => vi.unstubAllGlobals());

describe.each(["legacy", "production"] as const)("%s channel binding database", (schema) => {
  it("atomically prevents competing tenants and workspaces from taking the channel or changing permissions", async () => {
    const { db, sqlite, writes } = makeDb(schema);
    const repo = schema === "legacy" ? new D1ChannelRepository(db) : new ProductionChannelRepository(db);
    const attacker = { ...verified, title: "Attacker", permissions: { ...verified.permissions, canPost: false, canDelete: true } };
    const attempts = await Promise.allSettled([repo.upsertVerified(input("t1", "w1")), repo.upsertVerified(input("t2", "w2", attacker))]);
    expect(attempts[0].status).toBe("fulfilled");
    expect(attempts[1].status).toBe("rejected");
    if (attempts[1].status === "rejected") expect(attempts[1].reason.message).toBe("CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE");
    const channelBefore = rows(sqlite, "telegram_channels");
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const permissionWriteCount = permissionWrites(writes).length;
    expect(channelBefore).toHaveLength(1);
    expect(channelBefore[0]).toMatchObject({ tenant_id: "t1", workspace_id: "w1", title: "Original", status: "active" });
    expect(permissionsBefore).toHaveLength(schema === "legacy" ? 3 : 1);
    expect(permissionWriteCount).toBe(schema === "legacy" ? 3 : 2);
    await expect(repo.upsertVerified(input("t1", "w3", attacker))).rejects.toThrow("CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE");
    expect(rows(sqlite, "telegram_channels")).toEqual(channelBefore);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    expect(permissionWrites(writes)).toHaveLength(permissionWriteCount);
    sqlite.close();
  });

  it("returns the real row ID for simultaneous same-workspace upserts and persists permissions against it", async () => {
    const { db, sqlite } = makeDb(schema);
    const repo = schema === "legacy" ? new D1ChannelRepository(db) : new ProductionChannelRepository(db);
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => repo.upsertVerified(input("t1", "w1", { ...verified, title: `Title ${index}` }))));
    const channels = rows(sqlite, "telegram_channels");
    const permissions = rows(sqlite, "telegram_channel_permissions");
    expect(channels).toHaveLength(1);
    expect(results.every((result) => result.channelId === channels[0].id)).toBe(true);
    expect(permissions).toHaveLength(schema === "legacy" ? 3 : 1);
    expect(permissions.every((row) => row.channel_id === channels[0].id)).toBe(true);
    sqlite.close();
  });

  it.each(["administrator", "creator"])("accepts a session user who is %s, ignoring a spoofed request user ID", async (userStatus) => {
    const { db, sqlite } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    const calls = mockTelegram({ userStatus });
    const response = await request(schema, db, sessionToken, undefined, { chatId: "@test_channel", telegramUserId: "999" });
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(json.data).toMatchObject({ status: "active", telegramChatId: "-100123" });
    expect(calls.filter((call) => call.method === "getChatMember").map((call) => call.payload)).toEqual([
      { chat_id: "-100123", user_id: 99 }, { chat_id: "-100123", user_id: 123 },
    ]);
    expect(rows(sqlite, "telegram_channels")).toHaveLength(1);
    sqlite.close();
  });

  it("sends a large safe session ID exactly, without 32-bit truncation", async () => {
    const { db, sqlite } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema, "4503599627370495");
    const calls = mockTelegram();
    const response = await request(schema, db, sessionToken);
    expect(response.status).toBe(201);
    expect(calls.filter((call) => call.method === "getChatMember")[1].payload.user_id).toBe(4503599627370495);
    sqlite.close();
  });

  it.each(["member", "restricted", "left", "kicked"])("rejects session user status %s without persisting anything", async (userStatus) => {
    const { db, sqlite, writes } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram({ userStatus });
    const response = await request(schema, db, sessionToken);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CHANNEL_USER_NOT_ADMIN");
    expect(rows(sqlite, "telegram_channels")).toHaveLength(0);
    expect(permissionWrites(writes)).toHaveLength(0);
    sqlite.close();
  });

  it.each([
    ["query failure", { userFailure: true }],
    ["Telegram API error response", { userApiError: true }],
    ["unknown status", { userStatus: "unknown" }],
    ["wrong user", { wrongUser: true }],
    ["missing user", { missingUser: true }],
    ["bot identity", { userIsBot: true }],
  ])("fails closed for %s without exposing the token", async (_label, options) => {
    const { db, sqlite, writes } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram(options);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await request(schema, db, sessionToken);
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(text).error.code).toBe("CHANNEL_TELEGRAM_CHECK_FAILED");
    expect(text).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    expect(rows(sqlite, "telegram_channels")).toHaveLength(0);
    expect(permissionWrites(writes)).toHaveLength(0);
    log.mockRestore();
    sqlite.close();
  });

  it("does not update an existing channel or its permissions when the session user is no longer an administrator", async () => {
    const { db, sqlite, writes } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    expect((await request(schema, db, sessionToken)).status).toBe(201);
    const channelsBefore = rows(sqlite, "telegram_channels");
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const writeCount = permissionWrites(writes).length;
    mockTelegram({ userStatus: "member", botStatus: "member" });
    const response = await request(schema, db, sessionToken);
    expect(response.status).toBe(403);
    expect(rows(sqlite, "telegram_channels")).toEqual(channelsBefore);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    expect(permissionWrites(writes)).toHaveLength(writeCount);
    sqlite.close();
  });

  it("rejects a non-channel target with a 422 response", async () => {
    const { db, sqlite, writes } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    const calls = mockTelegram({ chatType: "supergroup" });
    const response = await request(schema, db, sessionToken);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("CHANNEL_NOT_CHANNEL");
    expect(calls.map((call) => call.method)).toEqual(["getChat"]);
    expect(rows(sqlite, "telegram_channels")).toHaveLength(0);
    expect(permissionWrites(writes)).toHaveLength(0);
    sqlite.close();
  });

  it("does not log or expose a token in an unexpected persistence error", async () => {
    const { db, sqlite } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const prototype = schema === "legacy" ? D1ChannelRepository.prototype : ProductionChannelRepository.prototype;
    const save = vi.spyOn(prototype, "upsertVerified").mockRejectedValueOnce(new Error(`secret ${token}`));
    const response = await request(schema, db, sessionToken);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    save.mockRestore();
    log.mockRestore();
    sqlite.close();
  });

  it.each(["", "0", "-1", "1e3", "12.0", " 123", "0123", "9007199254740992", "garbage"])("rejects invalid session Telegram ID %s before Telegram or DB writes", async (telegramUserId) => {
    const { db, sqlite, writes } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema, telegramUserId);
    const calls = mockTelegram();
    const response = await request(schema, db, sessionToken);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("CHANNEL_INVALID_TELEGRAM_USER_ID");
    expect(calls).toEqual([]);
    expect(rows(sqlite, "telegram_channels")).toHaveLength(0);
    expect(permissionWrites(writes)).toHaveLength(0);
    sqlite.close();
  });

  it("keeps the Bot permission_error behavior and only checks the Bot during recheck", async () => {
    const { db, sqlite } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram({ botStatus: "member", botCanPost: true });
    const response = await request(schema, db, sessionToken);
    const json = await response.json();
    expect(response.status).toBe(422);
    expect(json.error.code).toBe("CHANNEL_PERMISSION_ERROR");
    expect(json.error.details.permissions).toMatchObject({ canPost: false, botStatus: "not_admin" });
    const channelId = String(rows(sqlite, "telegram_channels")[0].id);
    const calls = mockTelegram({ userStatus: "member" });
    const recheck = await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/recheck`, {});
    expect(recheck.status).toBe(200);
    expect((await recheck.json()).data).toMatchObject({ channelId, status: "active" });
    expect(calls.filter((call) => call.method === "getChatMember").map((call) => call.payload.user_id)).toEqual([99]);
    expect(rows(sqlite, "telegram_channels")[0]).toMatchObject({ id: channelId, status: "active", title: "Test" });
    const permissions = rows(sqlite, "telegram_channel_permissions");
    if (schema === "legacy") expect(permissions.find((row) => row.permission === "post")?.granted).toBe(1);
    else expect(permissions).toMatchObject([{ channel_id: channelId, can_post_messages: 1 }]);
    sqlite.close();
  });

  it("does not reactivate an unbound channel by recheck; binding again requires the user's Telegram admin proof", async () => {
    const { db, sqlite, writes } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    expect((await request(schema, db, sessionToken)).status).toBe(201);
    const channelId = String(rows(sqlite, "telegram_channels")[0].id);
    expect((await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/unbind`, {})).status).toBe(200);
    const before = rows(sqlite, "telegram_channels");
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const writeCount = permissionWrites(writes).length;
    const calls = mockTelegram({ userStatus: "member" });
    const recheck = await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/recheck`, {});
    expect(recheck.status).toBe(409);
    expect((await recheck.json()).error.code).toBe("CHANNEL_NOT_BOUND_OR_CHANGED");
    expect(calls).toEqual([]);
    expect(rows(sqlite, "telegram_channels")).toEqual(before);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    expect(permissionWrites(writes)).toHaveLength(writeCount);
    const deniedBind = await request(schema, db, sessionToken);
    expect(deniedBind.status).toBe(403);
    expect((await deniedBind.json()).error.code).toBe("CHANNEL_USER_NOT_ADMIN");
    expect(rows(sqlite, "telegram_channels")).toEqual(before);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    mockTelegram({ userStatus: "administrator" });
    const allowedBind = await request(schema, db, sessionToken);
    expect(allowedBind.status).toBe(201);
    expect((await allowedBind.json()).data).toMatchObject({ channelId, status: "active" });
    sqlite.close();
  });

  it.each(["archived", "pending_verification", "unknown"])("does not recheck %s or write its snapshots", async (status) => {
    const { db, sqlite, writes } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    expect((await request(schema, db, sessionToken)).status).toBe(201);
    const channelId = String(rows(sqlite, "telegram_channels")[0].id);
    // Legacy has a CHECK excluding archived/unknown. Bypass only in this isolated test
    // to ensure its SQL also fails closed if the schema evolves or data is corrupted.
    sqlite.exec("PRAGMA ignore_check_constraints = ON");
    sqlite.prepare("UPDATE telegram_channels SET status = ? WHERE id = ?").run(status, channelId);
    sqlite.exec("PRAGMA ignore_check_constraints = OFF");
    const before = rows(sqlite, "telegram_channels");
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const writeCount = permissionWrites(writes).length;
    const calls = mockTelegram({ userStatus: "member" });
    const response = await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/recheck`, {});
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CHANNEL_NOT_BOUND_OR_CHANGED");
    expect(calls).toEqual([]);
    expect(rows(sqlite, "telegram_channels")).toEqual(before);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    expect(permissionWrites(writes)).toHaveLength(writeCount);
    // Check the repository predicate independently of the route's early guard.
    const repo = schema === "legacy" ? new D1ChannelRepository(db) : new ProductionChannelRepository(db);
    expect(await repo.recheckVerified({ ...input("t1", "w1"), channelId, expectedUpdatedAt: String(before[0].updated_at) })).toBeNull();
    expect(rows(sqlite, "telegram_channels")).toEqual(before);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    sqlite.close();
  });

  it("rejects every mismatched identity, scope, verified chat and stale version at the atomic update", async () => {
    const { db, sqlite, writes } = makeDb(schema);
    const repo = schema === "legacy" ? new D1ChannelRepository(db) : new ProductionChannelRepository(db);
    const { channelId } = await repo.upsertVerified(input("t1", "w1"));
    const before = rows(sqlite, "telegram_channels");
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const writeCount = permissionWrites(writes).length;
    const check = { ...input("t1", "w1"), channelId, expectedUpdatedAt: now };
    for (const mismatch of [
      { channelId: "missing" }, { tenantId: "t2" }, { workspaceId: "w3" },
      { botIdentityId: "other-bot" }, { verified: { ...verified, telegramChatId: "-100456" } },
      { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
    ]) {
      expect(await repo.recheckVerified({ ...check, ...mismatch })).toBeNull();
      expect(rows(sqlite, "telegram_channels")).toEqual(before);
      expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
      expect(permissionWrites(writes)).toHaveLength(writeCount);
    }
    sqlite.close();
  });

  it("rejects a Telegram response resolving to a different existing chat without changing either row", async () => {
    const { db, sqlite, writes } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    expect((await request(schema, db, sessionToken)).status).toBe(201);
    const channelId = String(rows(sqlite, "telegram_channels")[0].id);
    const repo = schema === "legacy" ? new D1ChannelRepository(db) : new ProductionChannelRepository(db);
    await repo.upsertVerified(input("t1", "w1", { ...verified, telegramChatId: "-100456", title: "Other channel" }));
    const before = rows(sqlite, "telegram_channels");
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const writeCount = permissionWrites(writes).length;
    mockTelegram({ chatId: -100456, userStatus: "member" });
    const response = await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/recheck`, {});
    expect(response.status).toBe(409);
    expect(rows(sqlite, "telegram_channels")).toEqual(before);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    expect(permissionWrites(writes)).toHaveLength(writeCount);
    sqlite.close();
  });

  it("refuses a channel belonging to another bot before contacting Telegram", async () => {
    const { db, sqlite } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    expect((await request(schema, db, sessionToken)).status).toBe(201);
    const channelId = String(rows(sqlite, "telegram_channels")[0].id);
    if (schema === "legacy") sqlite.prepare("INSERT INTO telegram_bot_identities VALUES ('bot2',NULL,'other-ref','other-ref','active',?,?)").run(now, now);
    else sqlite.exec("INSERT INTO telegram_bot_identities VALUES ('bot2')");
    sqlite.prepare("UPDATE telegram_channels SET bot_identity_id = 'bot2' WHERE id = ?").run(channelId);
    const before = rows(sqlite, "telegram_channels");
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const calls = mockTelegram();
    const response = await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/recheck`, {});
    expect(response.status).toBe(409);
    expect(calls).toEqual([]);
    expect(rows(sqlite, "telegram_channels")).toEqual(before);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    sqlite.close();
  });

  it.each([
    ["before the conditional channel update", (query: string) => /^\s*UPDATE telegram_channels SET username/i.test(query)],
    ["after the channel update but before the permission snapshot", (query: string) => /^\s*INSERT INTO telegram_channel_permissions/i.test(query)],
  ])("fails closed when unbind commits %s", async (_label, matches) => {
    const { db, sqlite } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    expect((await request(schema, db, sessionToken)).status).toBe(201);
    const channelId = String(rows(sqlite, "telegram_channels")[0].id);
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const calls = mockTelegram({ userStatus: "member", botCanPost: false });
    const gate = gateDb(db, matches);
    const checking = request(schema, gate.db, sessionToken, `/api/v1/channels/${channelId}/recheck`, {});
    await gate.reached;
    const unbind = await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/unbind`, {});
    expect(unbind.status).toBe(200);
    gate.release();
    const recheck = await checking;
    expect(recheck.status).toBe(409);
    expect((await recheck.json()).error.code).toBe("CHANNEL_NOT_BOUND_OR_CHANGED");
    expect(rows(sqlite, "telegram_channels")).toHaveLength(1);
    expect(rows(sqlite, "telegram_channels")[0].status).toBe("unbound");
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    expect(calls.filter((call) => call.method === "getChatMember").map((call) => call.payload.user_id)).toEqual([99]);
    sqlite.close();
  });

  it("fails closed if unbind interrupts snapshot writes, which may already be partially persisted", async () => {
    const { db, sqlite } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    expect((await request(schema, db, sessionToken)).status).toBe(201);
    const channelId = String(rows(sqlite, "telegram_channels")[0].id);
    // In production, remove the snapshot so the insert is the first real write;
    // in legacy, pause before the second of the three permission upserts.
    if (schema === "production") sqlite.exec("DELETE FROM telegram_channel_permissions");
    let inserts = 0;
    const gate = gateDb(db, (query) => schema === "production"
      ? /^\s*UPDATE telegram_channel_permissions/i.test(query)
      : /^\s*INSERT INTO telegram_channel_permissions/i.test(query) && ++inserts === 2);
    mockTelegram({ botCanPost: false, userStatus: "member" });
    const checking = request(schema, gate.db, sessionToken, `/api/v1/channels/${channelId}/recheck`, {});
    await gate.reached;
    const partial = rows(sqlite, "telegram_channel_permissions");
    if (schema === "legacy") expect(partial.find((row) => row.permission === "post")?.granted).toBe(0);
    else expect(partial).toMatchObject([{ channel_id: channelId, can_post_messages: 0 }]);
    expect((await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/unbind`, {})).status).toBe(200);
    gate.release();
    expect((await checking).status).toBe(409);
    expect(rows(sqlite, "telegram_channels")[0].status).toBe("unbound");
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(partial);
    sqlite.close();
  });

  it.each([
    ["before updating the channel", (query: string) => /^\s*UPDATE telegram_channels SET username/i.test(query)],
    ["before writing permissions", (query: string) => /^\s*INSERT INTO telegram_channel_permissions/i.test(query)],
  ])("rejects a stale recheck %s after unbind and rebind with the same timestamp", async (_label, matches) => {
    const { db, sqlite } = makeDb(schema);
    const repo = schema === "legacy" ? new D1ChannelRepository(db) : new ProductionChannelRepository(db);
    const { channelId } = await repo.upsertVerified(input("t1", "w1"));
    const gate = gateDb(db, matches);
    const gatedRepo = schema === "legacy" ? new D1ChannelRepository(gate.db) : new ProductionChannelRepository(gate.db);
    const stale = { ...verified, title: "Stale recheck", permissions: { ...verified.permissions, canPost: false } };
    const checking = gatedRepo.recheckVerified({ ...input("t1", "w1", stale), channelId, expectedUpdatedAt: now });
    await gate.reached;
    expect(await repo.unbind(channelId, "t1", "w1", now)).toBe(true);
    const rebound = { ...verified, title: "Authorized rebind", permissions: { ...verified.permissions, canDelete: true } };
    // upsertVerified is the persistence step used only after bind's Telegram user-admin check.
    expect((await repo.upsertVerified(input("t1", "w1", rebound))).channelId).toBe(channelId);
    const channelsAfterBind = rows(sqlite, "telegram_channels");
    const permissionsAfterBind = rows(sqlite, "telegram_channel_permissions");
    expect(String(channelsAfterBind[0].updated_at) > now).toBe(true);
    gate.release();
    expect(await checking).toBeNull();
    expect(rows(sqlite, "telegram_channels")).toEqual(channelsAfterBind);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsAfterBind);
    expect(channelsAfterBind[0]).toMatchObject({ id: channelId, title: "Authorized rebind", status: "active" });
    sqlite.close();
  });

  it("leaves the channel unbound when a successful recheck commits before unbind", async () => {
    const { db, sqlite } = makeDb(schema);
    const sessionToken = await session(db, sqlite, schema);
    mockTelegram();
    expect((await request(schema, db, sessionToken)).status).toBe(201);
    const channelId = String(rows(sqlite, "telegram_channels")[0].id);
    expect((await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/recheck`, {})).status).toBe(200);
    expect((await request(schema, db, sessionToken, `/api/v1/channels/${channelId}/unbind`, {})).status).toBe(200);
    expect(rows(sqlite, "telegram_channels")[0].status).toBe("unbound");
    sqlite.close();
  });

  it("returns 409 for a verified administrator from another tenant without changing the owner or permissions", async () => {
    const { db, sqlite, writes } = makeDb(schema);
    const ownerSession = await session(db, sqlite, schema, "123", "t1", "w1");
    const otherSession = await session(db, sqlite, schema, "456", "t2", "w2");
    mockTelegram();
    expect((await request(schema, db, ownerSession)).status).toBe(201);
    const before = rows(sqlite, "telegram_channels");
    const permissionsBefore = rows(sqlite, "telegram_channel_permissions");
    const writeCount = permissionWrites(writes).length;
    const response = await request(schema, db, otherSession);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CHANNEL_ALREADY_BOUND");
    expect(rows(sqlite, "telegram_channels")).toEqual(before);
    expect(rows(sqlite, "telegram_channel_permissions")).toEqual(permissionsBefore);
    expect(permissionWrites(writes)).toHaveLength(writeCount);
    sqlite.close();
  });
});

describe("binding verification input", () => {
  it.each([undefined, null, 123, Number.MAX_SAFE_INTEGER + 1, "", "9007199254740993"])("fails closed for invalid user ID %s", async (userId) => {
    const client = { getChat: vi.fn() } as unknown as TelegramBotApi;
    await expect(verifyTelegramChannelForBinding(client, "@test", userId)).rejects.toMatchObject({ code: "INVALID_TELEGRAM_USER_ID" });
    expect(client.getChat).not.toHaveBeenCalled();
  });
});
