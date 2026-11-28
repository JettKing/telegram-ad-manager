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
    const { db, queries, runs } = mockDb("uncertain", "[72]");
    await new ProductionOperationsRepository(db).retryTask(scope, "task-1", "user-1", "2026-11-27T00:00:00.000Z", true);
    expect(queries.join("\n")).toContain("AND status = ?");
    expect(runs[1][1]).toBe("[]");
  });

  it("allows cancellation for queued or failed tasks but not succeeded tasks", async () => {
    const { db, queries } = mockDb("queued");
    await new ProductionOperationsRepository(db).cancelTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z");
    expect(queries.join("\n")).toContain("status = 'cancelled'");
    await expect(new ProductionOperationsRepository(mockDb("succeeded").db).cancelTask({ tenantId: "tenant-1", workspaceId: "workspace-1" }, "task-1", "user-1", "2026-11-27T00:00:00.000Z")).rejects.toMatchObject({ code: "PUBLISH_TASK_NOT_CANCELLABLE" });
  });
});
