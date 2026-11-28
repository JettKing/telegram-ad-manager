import { describe, expect, it } from "vitest";
import { ProductionOperationsRepository } from "../apps/api/src/production-operations";

function mockDb(status: string, progressJson?: string) {
  const queries: string[] = [];
  const runs: unknown[][] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      const statement = {
        bind(...values: unknown[]) { runs.push(values); return statement; },
        async first<T>() { return query.startsWith("SELECT id, tenant_id") ? { id: "task-1", tenant_id: "tenant-1", attempts: 3, status, telegram_message_ids_json: progressJson } as T : undefined; },
        async run() { return { meta: { changes: 1 } }; },
      };
      return statement;
    },
  } as never;
  return { db, queries, runs };
}

describe("production operations", () => {
  it("only allows retry for terminal or uncertain tasks and resets the task", async () => {
    const { db, queries, runs } = mockDb("dead_letter");
    await new ProductionOperationsRepository(db).retryTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z");
    expect(queries.join("\n")).toContain("status = 'queued'");
    expect(queries.join("\n")).not.toContain("attempts = 0");
    expect(queries.join("\n")).toContain("AND attempts = ?");
    expect(runs[1].at(-1)).toBe(3);
    await expect(new ProductionOperationsRepository(mockDb("processing").db).retryTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z")).rejects.toMatchObject({ code: "PUBLISH_TASK_NOT_RETRYABLE" });
  });

  it("requires explicit confirmation before retrying an uncertain Telegram send", async () => {
    const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
    await expect(new ProductionOperationsRepository(mockDb("uncertain").db).retryTask(scope, "task-1", "user-1", "2026-11-27T00:00:00.000Z")).rejects.toMatchObject({ code: "PUBLISH_UNCERTAIN_CONFIRMATION_REQUIRED" });
    const checkpoint = JSON.stringify({ version: 1, messages: [{ messageId: 72, contentKey: "asset-1" }] });
    const { db, queries, runs } = mockDb("uncertain", checkpoint);
    await new ProductionOperationsRepository(db).retryTask(scope, "task-1", "user-1", "2026-11-27T00:00:00.000Z", true);
    expect(queries.join("\n")).toContain("AND status = ?");
    expect(runs[1][1]).toBe(checkpoint);
  });

  it("refuses to retry uncertain tasks when the checkpoint is missing, corrupted, or unmappable", async () => {
    const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
    for (const checkpoint of [undefined, "{broken", "[72]", JSON.stringify({ version: 2, messages: [] }), JSON.stringify({ version: 1, messages: [{ messageId: 72, contentKey: "asset-1" }, { messageId: 73, contentKey: "asset-1" }] })]) {
      const { db, queries } = mockDb("uncertain", checkpoint);
      await expect(new ProductionOperationsRepository(db).retryTask(scope, "task-1", "user-1", "2026-11-27T00:00:00.000Z", true)).rejects.toMatchObject({ code: "PUBLISH_UNCERTAIN_CHECKPOINT_UNSAFE" });
      expect(queries).toHaveLength(1);
    }
  });

  it("preserves an explicit empty checkpoint when manual confirmation permits recovery", async () => {
    const { db, runs } = mockDb("uncertain", "[]");
    await new ProductionOperationsRepository(db).retryTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z", true);
    expect(runs[1][1]).toBe("[]");
  });

  it("allows cancellation for queued or failed tasks but not succeeded tasks", async () => {
    const { db, queries } = mockDb("queued");
    await new ProductionOperationsRepository(db).cancelTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z");
    expect(queries.join("\n")).toContain("status = 'cancelled'");
    await expect(new ProductionOperationsRepository(mockDb("succeeded").db).cancelTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z")).rejects.toMatchObject({ code: "PUBLISH_TASK_NOT_CANCELLABLE" });
  });
});
