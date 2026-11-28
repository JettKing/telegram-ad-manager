import { describe, expect, it } from "vitest";
import { hasPermission, issuePlatformSession, provisionTelegramIdentity, readPlatformSession, revokePlatformSession, type ProvisionedIdentity } from "../apps/api/src/identity";
import { issueProductionPlatformSession, provisionProductionTelegramIdentity, readProductionPlatformSession } from "../apps/api/src/production-identity";
import type { D1Like } from "@tg-ad-manager/telegram";

type SessionRecord = { id: string; userId: string; tenantId: string; expiresAt: string; revokedAt?: string };

function createSessionDb() {
  const sessions = new Map<string, SessionRecord>();
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (query.includes("SELECT us.id AS sessionId")) {
                const session = sessions.get(String(values[0]));
                if (!session || session.revokedAt || session.expiresAt <= String(values[1])) return null;
                return {
                  sessionId: session.id,
                  expiresAt: session.expiresAt,
                  userId: session.userId,
                  telegramUserId: "123",
                  tenantId: session.tenantId,
                  role: "owner",
                  workspaceId: "workspace-1",
                } as T;
              }
              return null;
            },
            async run() {
              if (query.startsWith("INSERT INTO user_sessions")) {
                sessions.set(String(values[0]), { id: String(values[0]), userId: String(values[1]), tenantId: String(values[2]), expiresAt: String(values[3]) });
              }
              if (query.startsWith("UPDATE user_sessions")) {
                const session = sessions.get(String(values[1]));
                if (session) session.revokedAt = String(values[0]);
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Like;
  return { db, sessions };
}

const identity: ProvisionedIdentity = {
  userId: "user-1",
  telegramUserId: "123",
  displayName: "Test User",
  tenantId: "tenant-1",
  tenantName: "Test Tenant",
  workspaceId: "workspace-1",
  workspaceName: "Default",
  role: "owner",
};

const telegramUser = { id: 123, first_name: "Test", username: "tester" };

function provisionDb(options: { userActive?: number; membership?: { tenant_id: string; tenant_name: string; tenant_slug: string; role: "owner" }; previousMembership?: { tenant_id: string } | null; workspace?: { id: string; name: string } | null } = {}) {
  const queries: string[] = [];
  const batches: unknown[][] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      return {
        bind() {
          return {
            async first<T>() {
              if (query.includes("SELECT id, telegram_user_id, display_name, is_active")) return { id: "user-1", telegram_user_id: "123", display_name: "Test", is_active: options.userActive ?? 1 } as T;
              if (query.includes("SELECT tm.tenant_id, t.name AS tenant_name")) return (options.membership ?? null) as T | null;
              if (query.includes("SELECT tenant_id FROM tenant_members WHERE user_id")) return (options.previousMembership ?? null) as T | null;
              if (query.includes("SELECT w.id, w.name")) return (options.workspace ?? null) as T | null;
              return null;
            },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
    async batch(statements: unknown[]) { batches.push(statements); return statements.map(() => ({ meta: { changes: 1 } })); },
  } as unknown as D1Like;
  return { db, queries, batches };
}

describe("RBAC permission matrix", () => {
  it("keeps finance and settings permissions separated by role", () => {
    expect(hasPermission("viewer", "workspace:read")).toBe(true);
    expect(hasPermission("viewer", "finance:read")).toBe(false);
    expect(hasPermission("finance", "finance:read")).toBe(true);
    expect(hasPermission("finance", "publish:write")).toBe(false);
    expect(hasPermission("manager", "channel:manage")).toBe(true);
    expect(hasPermission("manager", "settings:write")).toBe(false);
    expect(hasPermission("owner", "settings:write")).toBe(true);
  });
});

describe("platform sessions", () => {
  it("issues a signed bearer token, loads it, and revokes it", async () => {
    const { db } = createSessionDb();
    const issued = await issuePlatformSession(db, identity, "test-session-secret", 3_600, new Date("2026-01-01T00:00:00.000Z"));
    expect(issued.token).toContain(".");

    const loaded = await readPlatformSession(db, issued.token, "test-session-secret", new Date("2026-01-01T00:10:00.000Z"));
    expect(loaded?.userId).toBe("user-1");
    expect(loaded?.role).toBe("owner");
    expect(await readPlatformSession(db, issued.token, "wrong-secret")).toBeNull();

    await revokePlatformSession(db, issued.sessionId, new Date("2026-01-01T00:20:00.000Z"));
    expect(await readPlatformSession(db, issued.token, "test-session-secret", new Date("2026-01-01T00:21:00.000Z"))).toBeNull();
  });

  it("requires active tenant status when reading a production session", async () => {
    const queries: string[] = [];
    const db = {
      prepare(query: string) {
        queries.push(query);
        return { bind() { return {
          async first<T>() { return query.includes("SELECT us.id AS sessionId") ? { sessionId: "session-1", expiresAt: "2026-01-01T01:00:00.000Z", userId: "user-1", telegramUserId: "123", tenantId: "tenant-1", workspaceId: "workspace-1", role: "owner" } as T : null; },
          async run() { return { meta: { changes: 1 } }; },
        }; } };
      },
    } as unknown as D1Like;
    const issued = await issueProductionPlatformSession(db, identity, "production-secret", 3600, new Date("2026-01-01T00:00:00.000Z"));
    expect(await readProductionPlatformSession(db, issued.token, "production-secret", new Date("2026-01-01T00:10:00.000Z"))).not.toBeNull();
    expect(queries.some((query) => query.includes("JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'"))).toBe(true);
  });
});

describe("Telegram identity provisioning safeguards", () => {
  it("does not reactivate an inactive production account", async () => {
    const { db, batches } = provisionDb({ userActive: 0 });
    await expect(provisionProductionTelegramIdentity(db, telegramUser)).rejects.toMatchObject({ code: "USER_SUSPENDED" });
    expect(batches).toHaveLength(0);
  });

  it("does not create a new owner tenant for a production user with only suspended membership", async () => {
    const { db, batches } = provisionDb({ previousMembership: { tenant_id: "tenant-old" } });
    await expect(provisionProductionTelegramIdentity(db, telegramUser)).rejects.toMatchObject({ code: "NO_ACTIVE_TENANT_MEMBERSHIP" });
    expect(batches).toHaveLength(0);
  });

  it("does not recreate a production workspace for an existing member", async () => {
    const membership = { tenant_id: "tenant-1", tenant_name: "Tenant", tenant_slug: "tenant", role: "owner" as const };
    const { db, queries, batches } = provisionDb({ membership, workspace: null });
    await expect(provisionProductionTelegramIdentity(db, telegramUser)).rejects.toMatchObject({ code: "NO_ACTIVE_WORKSPACE" });
    expect(queries.some((query) => query.startsWith("INSERT INTO workspaces"))).toBe(false);
    expect(batches).toHaveLength(0);
  });

  it("also refuses to reactivate an inactive account in the legacy schema path", async () => {
    const { db } = provisionDb({ userActive: 0 });
    await expect(provisionTelegramIdentity(db, telegramUser)).rejects.toMatchObject({ code: "USER_SUSPENDED" });
  });
});
