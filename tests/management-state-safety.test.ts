import { describe, expect, it } from "vitest";
import type { D1Like } from "@tg-ad-manager/telegram";
import { D1BusinessRepository, parsePackageInput, type CreateOrderInput } from "../apps/api/src/business";
import { ProductionBusinessRepository } from "../apps/api/src/production-business";
import { D1ChannelRepository } from "../apps/api/src/channels";
import { ProductionChannelRepository } from "../apps/api/src/production-channels";

const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
const orderInput: CreateOrderInput = {
  customerId: "customer-1",
  channelId: "channel-1",
  packageId: "package-1",
  content: { text: "广告文案" },
};

function inactiveCustomerDb(production: boolean) {
  const queries: string[] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      return {
        bind() {
          return {
            async first<T>() {
              if (query.includes(production ? "FROM ad_customers" : "FROM customers")) return { id: "customer-1", status: production ? "inactive" : "inactive" } as T;
              return null;
            },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  } as unknown as D1Like;
  return { db, queries };
}

function statementDb(updateChanges = 1) {
  const statements: Array<{ query: string; values: unknown[] }> = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          statements.push({ query, values });
          return {
            async first<T>() { return null as T | null; },
            async run() { return { meta: { changes: updateChanges } }; },
          };
        },
      };
    },
  } as unknown as D1Like;
  return { db, statements };
}

function productionOrderSnapshotDb() {
  const statements: Array<{ query: string; values: unknown[] }> = [];
  let packageRow = { id: "package-1", name: "Original package", price_minor: 1200, currency: "CNY", currency_scale: 2, network: null, status: "active" };
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          statements.push({ query, values });
          return {
            async first<T>() {
              if (query.includes("FROM ad_customers")) return { id: "customer-1", status: "active", display_name: "Original customer" } as T;
              if (query.includes("FROM ad_packages")) return packageRow as T;
              if (query.includes("FROM telegram_channels")) return { id: "channel-1" } as T;
              return null;
            },
            async all<T>() { return { results: [] as T[] }; },
            async run() {
              if (query.startsWith("INSERT INTO ad_creatives")) packageRow = { ...packageRow, name: "Edited package", price_minor: 9900, currency: "USD", currency_scale: 2, network: null };
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Like;
  return { db, statements };
}

const verified = {
  telegramChatId: "-100123",
  title: "Test channel",
  username: "test_channel",
  permissions: { canPost: true, canPin: true, canDelete: true, botStatus: "administrator" as const, checkedAt: "2026-11-29T00:00:00.000Z" },
};

describe("customer, package and channel state safety", () => {
  it("blocks new orders for inactive customers in both development and production repositories", async () => {
    const development = inactiveCustomerDb(false);
    await expect(new D1BusinessRepository(development.db).createOrder(scope, "actor-1", orderInput, "2026-11-29T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "CUSTOMER_INACTIVE" });
    expect(development.queries).toHaveLength(1);
    expect(development.queries[0]).toContain("tenant_id = ? AND workspace_id = ?");

    const production = inactiveCustomerDb(true);
    await expect(new ProductionBusinessRepository(production.db).createOrder(scope, "actor-1", orderInput, "2026-11-29T00:00:00.000Z"))
      .rejects.toMatchObject({ code: "CUSTOMER_INACTIVE" });
    expect(production.queries).toHaveLength(1);
    expect(production.queries[0]).toContain("tenant_id = ? AND workspace_id = ?");
  });

  it("keeps package price and availability writes scoped to the package, never mutating order snapshots", async () => {
    const packageInput = parsePackageInput({ name: "Updated package", adType: "text", priceMinor: 2500, currency: "CNY" });
    for (const Repository of [D1BusinessRepository, ProductionBusinessRepository]) {
      const { db, statements } = statementDb();
      const repository = new Repository(db);
      await repository.updatePackage(scope, "package-1", packageInput, "2026-11-29T00:00:00.000Z");
      await repository.setPackageEnabled(scope, "package-1", false, "2026-11-29T00:00:00.000Z");
      const updates = statements.filter(({ query }) => /^\s*UPDATE/i.test(query));
      expect(updates).toHaveLength(2);
      expect(updates.every(({ query }) => query.includes("UPDATE ad_packages") && query.includes("tenant_id = ? AND workspace_id = ?"))).toBe(true);
      expect(updates.some(({ query }) => query.includes("ad_orders"))).toBe(false);
      expect(statements.at(-2)?.values.slice(-3)).toEqual(["package-1", scope.tenantId, scope.workspaceId]);
      expect(statements.at(-1)?.values.slice(-3)).toEqual(["package-1", scope.tenantId, scope.workspaceId]);
    }
  });

  it("writes production order amounts and currency from the same package snapshot it validated", async () => {
    const { db, statements } = productionOrderSnapshotDb();
    await new ProductionBusinessRepository(db).createOrder(scope, "actor-1", orderInput, "2026-11-29T00:00:00.000Z");
    const orderInsert = statements.find(({ query }) => query.includes("INSERT INTO ad_orders"));
    expect(orderInsert).toBeDefined();
    expect(orderInsert?.query.match(/\?/g)).toHaveLength(orderInsert?.values.length);
    expect(orderInsert?.values.slice(7, 14)).toEqual(["Original customer", "Original package", "广告文案", 1200, "CNY", 2, null]);
    expect(orderInsert?.query).not.toContain("SELECT");
  });

  it("does not apply a recheck result if the channel became unbound while Telegram was queried", async () => {
    for (const Repository of [D1ChannelRepository, ProductionChannelRepository]) {
      const { db, statements } = statementDb(0);
      const saved = await new Repository(db).recheckVerified("channel-1", { ...scope, verified, now: "2026-11-29T00:00:01.000Z" });
      expect(saved).toBeNull();
      expect(statements).toHaveLength(1);
      expect(statements[0].query).toContain("status != 'unbound'");
      expect(statements[0].query).toContain("tenant_id = ? AND workspace_id = ?");
    }
  });

  it("blocks new orders after a permission check fails without overriding an unbound channel", async () => {
    for (const Repository of [D1ChannelRepository, ProductionChannelRepository]) {
      const { db, statements } = statementDb();
      const result = await new Repository(db).markVerificationFailed("channel-1", scope.tenantId, scope.workspaceId, "2026-11-29T00:00:01.000Z", { code: "TELEGRAM_CHECK_FAILED", message: "temporary failure" });
      expect(result).toBe(true);
      expect(statements[0].query).toContain("status = 'permission_error'");
      expect(statements[0].query).toContain("status != 'unbound'");
      expect(statements[0].query).toContain("tenant_id = ? AND workspace_id = ?");
      if (Repository === D1ChannelRepository) expect(statements[0].query).toContain("can_post = 0");
      else expect(statements.some(({ query }) => query.includes("INSERT INTO telegram_channel_permissions") && query.includes("VALUES (?, ?, ?, 0, 0, 0"))).toBe(true);
    }
  });
});
