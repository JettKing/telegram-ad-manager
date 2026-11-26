import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./business.js";

type TaskStatus = "queued" | "processing" | "succeeded" | "failed" | "uncertain" | "cancelled" | "dead_letter";

export interface OperationsSummary {
  taskCounts: Record<string, number>;
  staleProcessing: number;
  openAlerts: number;
  latestCron?: { status: string; checkedAt: string; details: Record<string, unknown> };
}

async function all<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T[]> {
  const statement = db.prepare(query).bind(...values);
  return statement.all ? (await statement.all<T>()).results : [];
}

export class ProductionOperationsRepository {
  constructor(private readonly db: D1Like) {}

  async summary(scope: { tenantId: string; workspaceId: string }, now: string): Promise<OperationsSummary> {
    const counts = await all<{ status: string; count: number }>(this.db, "SELECT status, COUNT(*) AS count FROM publish_tasks WHERE tenant_id = ? AND workspace_id = ? GROUP BY status", scope.tenantId, scope.workspaceId);
    const stale = await this.db.prepare("SELECT COUNT(*) AS count FROM publish_tasks WHERE tenant_id = ? AND workspace_id = ? AND status = 'processing' AND updated_at <= datetime(?, '-15 minutes')").bind(scope.tenantId, scope.workspaceId, now).first<{ count: number }>();
    const alerts = await this.db.prepare("SELECT COUNT(*) AS count FROM ops_alert_events WHERE status IN ('open', 'acknowledged') AND ((tenant_id = ? AND workspace_id = ?) OR tenant_id IS NULL)").bind(scope.tenantId, scope.workspaceId).first<{ count: number }>();
    const cron = await this.db.prepare("SELECT status, checked_at, details_json FROM ops_health_snapshots WHERE component = 'production_cron' AND (tenant_id = ? OR tenant_id IS NULL) ORDER BY checked_at DESC LIMIT 1").bind(scope.tenantId).first<{ status: string; checked_at: string; details_json: string }>();
    const taskCounts = Object.fromEntries(counts.map((row) => [row.status, Number(row.count)]));
    let details: Record<string, unknown> = {};
    try { details = cron?.details_json ? JSON.parse(cron.details_json) as Record<string, unknown> : {}; } catch { details = { raw: cron?.details_json ?? "" }; }
    return { taskCounts, staleProcessing: Number(stale?.count ?? 0), openAlerts: Number(alerts?.count ?? 0), ...(cron ? { latestCron: { status: cron.status, checkedAt: cron.checked_at, details } } : {}) };
  }

  async retryTask(scope: { tenantId: string; workspaceId: string }, taskId: string, actorUserId: string, now: string): Promise<void> {
    const task = await this.db.prepare("SELECT id, tenant_id, attempts, status FROM publish_tasks WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(taskId, scope.tenantId, scope.workspaceId).first<{ id: string; tenant_id: string; attempts: number; status: TaskStatus }>();
    if (!task) throw new BusinessValidationError("PUBLISH_TASK_NOT_FOUND", "发布任务不存在或不属于当前工作空间");
    if (!["failed", "uncertain", "dead_letter", "cancelled"].includes(task.status)) throw new BusinessValidationError("PUBLISH_TASK_NOT_RETRYABLE", "当前任务状态不允许人工重试");
    await this.db.prepare("UPDATE publish_tasks SET status = 'queued', attempts = 0, available_at = ?, locked_at = NULL, completed_at = NULL, last_error_code = NULL, last_error_message = NULL, updated_at = ? WHERE id = ? AND status = ?").bind(now, now, taskId, task.status).run();
    await this.db.prepare("INSERT INTO publish_task_logs (id, tenant_id, task_id, attempt, status, message, duration_ms, created_at) VALUES (?, ?, ?, ?, 'manual_retry', ?, NULL, ?)").bind(crypto.randomUUID(), task.tenant_id, taskId, task.attempts, JSON.stringify({ actorUserId }), now).run();
  }

  async cancelTask(scope: { tenantId: string; workspaceId: string }, taskId: string, actorUserId: string, now: string): Promise<void> {
    const task = await this.db.prepare("SELECT id, tenant_id, attempts, status FROM publish_tasks WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(taskId, scope.tenantId, scope.workspaceId).first<{ id: string; tenant_id: string; attempts: number; status: TaskStatus }>();
    if (!task) throw new BusinessValidationError("PUBLISH_TASK_NOT_FOUND", "发布任务不存在或不属于当前工作空间");
    if (!["queued", "failed", "uncertain", "dead_letter"].includes(task.status)) throw new BusinessValidationError("PUBLISH_TASK_NOT_CANCELLABLE", "当前任务状态不允许取消");
    await this.db.prepare("UPDATE publish_tasks SET status = 'cancelled', locked_at = NULL, updated_at = ? WHERE id = ? AND status = ?").bind(now, taskId, task.status).run();
    await this.db.prepare("INSERT INTO publish_task_logs (id, tenant_id, task_id, attempt, status, message, duration_ms, created_at) VALUES (?, ?, ?, ?, 'cancelled', ?, NULL, ?)").bind(crypto.randomUUID(), task.tenant_id, taskId, task.attempts, JSON.stringify({ actorUserId }), now).run();
  }

  async recordCronSnapshot(status: "ok" | "degraded" | "down", details: Record<string, unknown>, now: string, tenantId?: string, workspaceId?: string): Promise<void> {
    await this.db.prepare("INSERT INTO ops_health_snapshots (id, tenant_id, workspace_id, component, status, latency_ms, details_json, checked_at, source) VALUES (?, ?, ?, 'production_cron', ?, NULL, ?, ?, 'cron')").bind(crypto.randomUUID(), tenantId ?? null, workspaceId ?? null, status, JSON.stringify(details), now).run();
    const fingerprint = "production-cron:execution";
    const existing = await this.db.prepare("SELECT id FROM ops_alert_events WHERE fingerprint = ? AND status IN ('open', 'acknowledged') ORDER BY last_seen_at DESC LIMIT 1").bind(fingerprint).first<{ id: string }>();
    if (status === "ok") {
      if (existing) await this.db.prepare("UPDATE ops_alert_events SET status = 'resolved', resolved_at = ?, last_seen_at = ?, details_json = ? WHERE id = ?").bind(now, now, JSON.stringify(details), existing.id).run();
      return;
    }
    const severity = status === "down" ? "critical" : "warning";
    const title = status === "down" ? "生产 Cron 执行失败" : "生产 Cron 执行异常";
    if (existing) {
      await this.db.prepare("UPDATE ops_alert_events SET severity = ?, message = ?, details_json = ?, occurrence_count = occurrence_count + 1, last_seen_at = ? WHERE id = ?").bind(severity, title, JSON.stringify(details), now, existing.id).run();
    } else {
      await this.db.prepare("INSERT INTO ops_alert_events (id, tenant_id, workspace_id, fingerprint, component, severity, status, title, message, details_json, occurrence_count, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, 'production_cron', ?, 'open', ?, ?, ?, 1, ?, ?)").bind(crypto.randomUUID(), tenantId ?? null, workspaceId ?? null, fingerprint, severity, title, title, JSON.stringify(details), now, now).run();
    }
  }
}

export async function recordProductionCronSnapshot(db: D1Like | undefined, status: "ok" | "degraded" | "down", details: Record<string, unknown>, now = new Date().toISOString()): Promise<void> {
  if (!db) return;
  try { await new ProductionOperationsRepository(db).recordCronSnapshot(status, details, now); } catch (error) { console.warn("production_cron_snapshot_failed", { message: error instanceof Error ? error.message : "unknown" }); }
}
