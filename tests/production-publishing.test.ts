import { describe, expect, it } from "vitest";
import { parseProductionScheduleInput, processProductionDuePublishTasks, ProductionPublishRepository } from "../apps/api/src/production-publishing";

describe("production schema publish adapter", () => {
  it("requires the production end_at field and normalizes the timezone contract", () => {
    const now = new Date("2026-11-17T00:00:00.000Z");
    expect(parseProductionScheduleInput({ scheduleType: "once", startAt: "2026-11-17T01:00:00Z", endAt: "2026-11-17T02:00:00Z" }, now)).toMatchObject({ startAt: "2026-11-17T01:00:00.000Z", endAt: "2026-11-17T02:00:00.000Z", timezone: "Asia/Shanghai", intervalMinutes: 0 });
    expect(() => parseProductionScheduleInput({ scheduleType: "once", startAt: "2026-11-17T01:00:00Z" }, now)).toThrow("endAt");
  });

  it("accepts the legacy API field names only as an explicit adapter input", () => {
    expect(parseProductionScheduleInput({ scheduleType: "daily", plannedAt: "2026-11-17T01:00:00Z", plannedEndAt: "2026-11-17T02:00:00Z", timezone: "UTC", intervalMinutes: 1440 }, new Date("2026-11-17T00:00:00Z"))).toMatchObject({ timezone: "UTC", intervalMinutes: 1440 });
  });

  it("does not touch D1 when production dependencies are not configured", async () => {
    await expect(processProductionDuePublishTasks({})).resolves.toEqual({ processed: 0, succeeded: 0, retried: 0, failed: 0, expired: 0, expirationFailed: 0 });
  });

  it("reads production schedule and queue field names without legacy table aliases", async () => {
    const queries: string[] = [];
    const db = { prepare(query: string) { queries.push(query); return { bind() { return { async all<T>() { return { results: [{ id: "row-1" }] as T[] }; } }; } }; } } as never;
    const repository = new ProductionPublishRepository(db);
    await expect(repository.listSchedules("tenant-1", "workspace-1")).resolves.toEqual([{ id: "row-1" }]);
    await expect(repository.listTasks("tenant-1", "workspace-1")).resolves.toEqual([{ id: "row-1" }]);
    expect(queries.join("\n")).toContain("FROM ad_schedules");
    expect(queries.join("\n")).toContain("FROM publish_tasks");
    expect(queries.join("\n")).not.toContain("ad_publish_tasks");
  });

  it("persists each Telegram message against a stable content key and attempt fence", async () => {
    let query = "";
    let values: unknown[] = [];
    const db = {
      prepare(sql: string) {
        query = sql;
        return { bind(...bound: unknown[]) { values = bound; return { async run() { return { meta: { changes: 1 } }; } }; } };
      },
    } as never;
    const repository = new ProductionPublishRepository(db);
    const task = { id: "task", tenant_id: "tenant", workspace_id: "workspace", order_id: "order", schedule_id: "schedule", channel_id: "channel", status: "processing" as const, attempts: 4, max_attempts: 5, available_at: "2026-11-17T00:00:00Z", idempotency_key: "key", created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z" };
    await repository.recordPublishedMessage(task, 82, "creative-asset-4", "2026-11-17T00:01:00Z");
    expect(query).toContain("AND attempts = ?");
    expect(values.at(-1)).toBe(4);
    expect(JSON.parse(String(values[0]))).toEqual({ version: 1, messages: [{ messageId: 82, contentKey: "creative-asset-4" }] });
    expect(task.telegram_message_ids_json).toBe(values[0]);
  });

  it("atomically finalizes success and rejects a stale attempt", async () => {
    const statements: string[] = [];
    let firstChanges = 1;
    const db = {
      prepare(sql: string) { statements.push(sql); return { bind() { return { sql }; } }; },
      async batch(batchStatements: Array<{ sql: string }>) { return batchStatements.map((_statement, index) => ({ meta: { changes: index === 0 ? firstChanges : 1 } })); },
    } as never;
    const repository = new ProductionPublishRepository(db);
    const task = { id: "task", tenant_id: "tenant", workspace_id: "workspace", order_id: "order", schedule_id: "schedule", channel_id: "channel", status: "processing" as const, attempts: 4, max_attempts: 5, available_at: "2026-11-17T00:00:00Z", idempotency_key: "key", created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", telegram_message_ids_json: JSON.stringify({ version: 1, messages: [{ messageId: 82, contentKey: "creative-asset-4" }] }) };
    await repository.markSucceeded(task, [82], "2026-11-17T00:02:00Z");
    expect(statements[0]).toContain("AND attempts = ?");
    expect(statements[1]).toContain("INSERT INTO publish_task_logs");
    expect(statements[2]).toContain("EXISTS (SELECT 1 FROM publish_tasks");
    firstChanges = 0;
    await expect(repository.markSucceeded(task, [82], "2026-11-17T00:03:00Z")).rejects.toMatchObject({ code: "PUBLISH_TASK_LEASE_LOST" });
  });
});
