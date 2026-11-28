import { describe, expect, it } from "vitest";
import type { D1Like } from "@tg-ad-manager/telegram";
import { ProductionChannelRepository } from "../apps/api/src/production-channels";

type StoredChannel = { id: string; tenant_id: string; workspace_id: string; bot_identity_id: string; telegram_chat_id: string; status: string };

class ConcurrentChannelDb implements D1Like {
  readonly channels = new Map<string, StoredChannel>();
  readonly channelUpsertStatements: string[] = [];

  prepare(query: string) {
    return {
      bind: (...values: unknown[]) => ({
        first: async <T = unknown>(): Promise<T | null> => {
          if (query.includes("SELECT id, tenant_id, workspace_id FROM telegram_channels")) {
            const key = this.channelKey(String(values[0]), String(values[1]));
            return (this.channels.get(key) ?? null) as T | null;
          }
          return null;
        },
        run: async (): Promise<{ meta: { changes: number } }> => {
          if (query.includes("INSERT INTO telegram_channels")) {
            this.channelUpsertStatements.push(query);
            const [id, tenantId, workspaceId, botIdentityId, telegramChatId, , , status] = values.map(String);
            const key = this.channelKey(botIdentityId, telegramChatId);
            const existing = this.channels.get(key);
            const hasTenantGuard = query.includes("WHERE telegram_channels.tenant_id = excluded.tenant_id");
            const hasWorkspaceGuard = query.includes("AND telegram_channels.workspace_id = excluded.workspace_id");
            if (existing && hasTenantGuard && hasWorkspaceGuard && (existing.tenant_id !== tenantId || existing.workspace_id !== workspaceId)) {
              return { meta: { changes: 0 } };
            }
            this.channels.set(key, {
              id: existing?.id ?? id,
              tenant_id: tenantId,
              workspace_id: workspaceId,
              bot_identity_id: botIdentityId,
              telegram_chat_id: telegramChatId,
              status,
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      }),
    };
  }

  private channelKey(botIdentityId: string, chatId: string): string {
    return `${botIdentityId}:${chatId}`;
  }
}

const verified = {
  telegramChatId: "-100123",
  title: "Production channel",
  username: "production_channel",
  permissions: { canPost: true, canPin: true, canDelete: false, botStatus: "administrator" as const, checkedAt: "2026-11-28T00:00:00.000Z" },
};

function input(workspaceId: string) {
  return { tenantId: "tenant-1", workspaceId, botIdentityId: "bot-1", verified, now: "2026-11-28T00:00:00.000Z" };
}

describe("ProductionChannelRepository atomic workspace binding", () => {
  it("lets at most one concurrent workspace claim a channel and guards the SQL conflict update", async () => {
    const db = new ConcurrentChannelDb();
    const repository = new ProductionChannelRepository(db);

    const results = await Promise.allSettled([
      repository.upsertVerified(input("workspace-a")),
      repository.upsertVerified(input("workspace-b")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatchObject({ message: "CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE" });
    expect(db.channels.size).toBe(1);
    expect(["workspace-a", "workspace-b"]).toContain([...db.channels.values()][0].workspace_id);
    expect(db.channelUpsertStatements).toHaveLength(2);
    for (const statement of db.channelUpsertStatements) {
      expect(statement).toContain("WHERE telegram_channels.tenant_id = excluded.tenant_id");
      expect(statement).toContain("AND telegram_channels.workspace_id = excluded.workspace_id");
    }
  });

  it("continues to reject a different workspace even when the existing channel is unbound", async () => {
    const db = new ConcurrentChannelDb();
    db.channels.set("bot-1:-100123", {
      id: "channel-existing",
      tenant_id: "tenant-1",
      workspace_id: "workspace-owner",
      bot_identity_id: "bot-1",
      telegram_chat_id: "-100123",
      status: "unbound",
    });
    const repository = new ProductionChannelRepository(db);

    await expect(repository.upsertVerified(input("workspace-other"))).rejects.toThrow("CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE");
    expect(db.channels.get("bot-1:-100123")).toMatchObject({ workspace_id: "workspace-owner", status: "unbound" });
    expect(db.channelUpsertStatements).toHaveLength(0);
  });

  it("allows the owning workspace to rebind its existing unbound channel without changing its ID", async () => {
    const db = new ConcurrentChannelDb();
    db.channels.set("bot-1:-100123", {
      id: "channel-existing",
      tenant_id: "tenant-1",
      workspace_id: "workspace-a",
      bot_identity_id: "bot-1",
      telegram_chat_id: "-100123",
      status: "unbound",
    });
    const repository = new ProductionChannelRepository(db);

    const result = await repository.upsertVerified(input("workspace-a"));

    expect(result).toEqual({ channelId: "channel-existing", status: "active" });
    expect(db.channels.get("bot-1:-100123")).toMatchObject({ id: "channel-existing", workspace_id: "workspace-a", status: "active" });
  });
});
