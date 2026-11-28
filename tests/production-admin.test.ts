import { describe, expect, it } from "vitest";
import { ProductionAdminRepository } from "../apps/api/src/production-admin";
import type { D1Like } from "@tg-ad-manager/telegram";

const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
function mockDb(current: { role: string; status: string }, anotherOwner: { user_id: string } | null = null, changes = 1, latest = current) {
  const queries: string[] = [];
  const batches: unknown[][] = [];
  let memberReads = 0;
  const db = {
    prepare(query: string) {
      queries.push(query);
      return {
        bind() {
          return {
            async first<T>() {
              if (query.includes("SELECT role, status FROM workspace_members")) { memberReads += 1; return (memberReads > 1 ? latest : current) as T; }
              if (query.includes("SELECT user_id FROM workspace_members") && query.includes("role = 'owner'")) return anotherOwner as T | null;
              return null;
            },
            async all<T>() { return { results: [] as T[] }; },
            async run() { return { meta: { changes } }; },
          };
        },
      };
    },
    async batch(statements: unknown[]) { batches.push(statements); return statements.map(() => ({ meta: { changes } })); },
  };
  return { db: db as unknown as D1Like, queries, batches };
}

describe("production member governance", () => {
  it("does not allow an admin to grant owner", async () => {
    const { db } = mockDb({ role: "manager", status: "active" });
    await expect(new ProductionAdminRepository(db).updateMember(scope, "admin-1", "admin", "member-1", "owner", undefined, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "OWNER_GRANT_FORBIDDEN" });
  });

  it("rechecks current active-owner membership when a session role is stale", async () => {
    const { db, queries } = mockDb({ role: "manager", status: "active" }, null, 0);
    await expect(new ProductionAdminRepository(db).updateMember(scope, "former-owner", "owner", "member-1", "owner", undefined, "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "OWNER_GRANT_FORBIDDEN" });
    expect(queries.some((query) => query.includes("actor.user_id = ?") && query.includes("actor.status = 'active'"))).toBe(true);
  });

  it("prevents suspending the last active owner", async () => {
    const { db } = mockDb({ role: "owner", status: "active" });
    await expect(new ProductionAdminRepository(db).updateMember(scope, "admin-1", "admin", "owner-1", undefined, "suspended", "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "LAST_ACTIVE_OWNER_REQUIRED" });
  });

  it("allows an owner to suspend one of multiple active owners", async () => {
    const { db, queries, batches } = mockDb({ role: "owner", status: "active" }, { user_id: "owner-2" });
    const result = await new ProductionAdminRepository(db).updateMember(scope, "owner-2", "owner", "owner-1", undefined, "suspended", "2026-11-27T00:00:00.000Z");
    expect(result.after).toEqual({ role: "owner", status: "suspended" });
    expect(queries.some((query) => query.includes("other.user_id <> workspace_members.user_id"))).toBe(true);
    expect(batches).toHaveLength(1);
    expect(queries.some((query) => query.includes("UPDATE user_sessions SET revoked_at") && query.includes("wm.status = 'suspended'"))).toBe(true);
  });

  it("does not remove a member promoted to owner concurrently", async () => {
    const { db, queries, batches } = mockDb({ role: "manager", status: "active" }, null, 0, { role: "owner", status: "active" });
    await expect(new ProductionAdminRepository(db).removeMember(scope, "member-1", "2026-11-27T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "OWNER_MEMBER_PROTECTED" });
    expect(batches).toHaveLength(1);
    expect(queries.some((query) => query.includes("status <> 'suspended'") && query.includes("role <> 'owner'"))).toBe(true);
  });

  it("atomically revokes sessions when removing a member", async () => {
    const { db, queries, batches } = mockDb({ role: "manager", status: "active" });
    const result = await new ProductionAdminRepository(db).removeMember(scope, "member-1", "2026-11-27T00:00:00.000Z");
    expect(result.removed).toBe(true);
    expect(batches).toHaveLength(1);
    expect(queries.some((query) => query.includes("UPDATE user_sessions SET revoked_at") && query.includes("wm.status = 'suspended'"))).toBe(true);
  });
});
