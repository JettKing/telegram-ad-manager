import { describe, expect, it } from "vitest";
import { parseProductionScheduleInput, processProductionDuePublishTasks } from "../apps/api/src/production-publishing";

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
    await expect(processProductionDuePublishTasks({})).resolves.toEqual({ processed: 0, succeeded: 0, retried: 0, failed: 0, expired: 0 });
  });
});
