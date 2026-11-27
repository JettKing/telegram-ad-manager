import { describe, expect, it } from "vitest";
import { ProductionOperationsRepository } from "../apps/api/src/production-operations";

function mockDb(status: string) {
  const queries: string[] = [];
  const runs: unknown[][] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      const statement = {
        bind(...values: unknown[]) { runs.push(values); return statement; },
        async first<T>() { return query.startsWith("SELECT id, tenant_id") ? { id: "task-1", tenant_id: "tenant-1", attempts: 3, status } as T : undefined; },
        async run() { return { meta: { changes: 1 } }; },
      };
      return statement;
    },
  } as never;
  return { db, queries, runs };
}

describe("production operations", () => {
  it("only allows retry for terminal or uncertain tasks and resets the task", async () => {
    const { db, queries } = mockDb("dead_letter");
    await new ProductionOperationsRepository(db).retryTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z");
    expect(queries.join("\n")).toContain("status = 'queued'");
    await expect(new ProductionOperationsRepository(mockDb("processing").db).retryTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z")).rejects.toMatchObject({ code: "PUBLISH_TASK_NOT_RETRYABLE" });
  });

  it("requires explicit confirmation before retrying an uncertain Telegram send", async () => {
    const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
    await expect(new ProductionOperationsRepository(mockDb("uncertain").db).retryTask(scope, "task-1", "user-1", "2026-11-27T00:00:00.000Z")).rejects.toMatchObject({ code: "PUBLISH_UNCERTAIN_CONFIRMATION_REQUIRED" });
    const { db, queries } = mockDb("uncertain");
    await new ProductionOperationsRepository(db).retryTask(scope, "task-1", "user-1", "2026-11-27T00:00:00.000Z", true);
    expect(queries.join("\n")).toContain("AND status = ?");
  });

  it("allows cancellation for queued or failed tasks but not succeeded tasks", async () => {
    const { db, queries } = mockDb("queued");
    await new ProductionOperationsRepository(db).cancelTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z");
    expect(queries.join("\n")).toContain("status = 'cancelled'");
    await expect(new ProductionOperationsRepository(mockDb("succeeded").db).cancelTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z")).rejects.toMatchObject({ code: "PUBLISH_TASK_NOT_CANCELLABLE" });
  });
});
