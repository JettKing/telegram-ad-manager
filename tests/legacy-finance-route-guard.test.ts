import { describe, expect, it } from "vitest";
import type { D1Like } from "@tg-ad-manager/telegram";
import { app } from "../apps/api/src/app";
import { issuePlatformSession, type ProvisionedIdentity } from "../apps/api/src/identity";

const identity: ProvisionedIdentity = {
  userId: "user-1", telegramUserId: "123", displayName: "Test", tenantId: "tenant-1",
  tenantName: "Tenant", workspaceId: "workspace-1", workspaceName: "Workspace", role: "owner",
};

describe("legacy finance route guard", () => {
  it("rejects refund writes when the production schema contract is absent", async () => {
    const db = {
      prepare(query: string) {
        return {
          bind() {
            return {
              async first<T>() {
                if (query.includes("SELECT us.id AS sessionId")) return {
                  sessionId: "session-1", expiresAt: "2027-01-01T00:00:00.000Z", userId: identity.userId,
                  telegramUserId: identity.telegramUserId, tenantId: identity.tenantId, workspaceId: identity.workspaceId, role: identity.role,
                } as T;
                return null;
              },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
        };
      },
    } as unknown as D1Like;
    const token = (await issuePlatformSession(db, identity, "session-secret")).token;
    const response = await app.request("/api/v1/orders/order-1/refunds", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }, { DB: db, SESSION_SECRET: "session-secret" } as never);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("REFUND_NOT_CONFIGURED");
  });
});
