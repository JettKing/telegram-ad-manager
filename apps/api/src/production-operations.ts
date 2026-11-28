import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./business.js";
import { TelegramBotApiClient } from "./channels.js";

type TaskStatus = "queued" | "processing" | "succeeded" | "failed" | "uncertain" | "cancelled" | "dead_letter";

export interface OperationsSummary {
  taskCounts: Record<string, number>;
  staleProcessing: number;
  openAlerts: number;
  latestCron?: { status: string; checkedAt: string; details: Record<string, unknown> };
}

export interface OperationalAlertInput {
  fingerprint: string;
  tenantId?: string;
  workspaceId?: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  details: Record<string, unknown>;
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

  async retryTask(scope: { tenantId: string; workspaceId: string }, taskId: string, actorUserId: string, now: string, confirmUncertain = false): Promise<void> {
    const task = await this.db.prepare("SELECT id, tenant_id, attempts, status, telegram_message_ids_json FROM publish_tasks WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(taskId, scope.tenantId, scope.workspaceId).first<{ id: string; tenant_id: string; attempts: number; status: TaskStatus; telegram_message_ids_json?: string }>();
    if (!task) throw new BusinessValidationError("PUBLISH_TASK_NOT_FOUND", "发布任务不存在或不属于当前工作空间");
    if (!["failed", "uncertain", "dead_letter", "cancelled"].includes(task.status)) throw new BusinessValidationError("PUBLISH_TASK_NOT_RETRYABLE", "当前任务状态不允许人工重试");
    if (task.status === "uncertain" && !confirmUncertain) throw new BusinessValidationError("PUBLISH_UNCERTAIN_CONFIRMATION_REQUIRED", "Telegram 发送结果不确定，重试可能重复发布；请先人工核对频道并明确确认");
    let progressJson = task.telegram_message_ids_json ?? "[]";
    if (task.status === "uncertain" && confirmUncertain) {
      try { if (Array.isArray(JSON.parse(progressJson))) progressJson = "[]"; } catch { progressJson = "[]"; }
    }
    const updated = await this.db.prepare("UPDATE publish_tasks SET status = 'queued', available_at = ?, locked_at = NULL, completed_at = NULL, telegram_message_ids_json = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = ? AND attempts = ?").bind(now, progressJson, now, taskId, scope.tenantId, scope.workspaceId, task.status, task.attempts).run();
    if ((updated.meta?.changes ?? 0) === 0) throw new BusinessValidationError("PUBLISH_TASK_STATE_CHANGED", "任务状态已变化，请刷新后重新核对");
    await this.db.prepare("INSERT INTO publish_task_logs (id, tenant_id, task_id, attempt, status, message, duration_ms, created_at) VALUES (?, ?, ?, ?, 'manual_retry', ?, NULL, ?)").bind(crypto.randomUUID(), task.tenant_id, taskId, task.attempts, JSON.stringify({ actorUserId }), now).run();
  }

  async cancelTask(scope: { tenantId: string; workspaceId: string }, taskId: string, actorUserId: string, now: string): Promise<void> {
    const task = await this.db.prepare("SELECT id, tenant_id, attempts, status FROM publish_tasks WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(taskId, scope.tenantId, scope.workspaceId).first<{ id: string; tenant_id: string; attempts: number; status: TaskStatus }>();
    if (!task) throw new BusinessValidationError("PUBLISH_TASK_NOT_FOUND", "发布任务不存在或不属于当前工作空间");
    if (!["queued", "failed", "uncertain", "dead_letter"].includes(task.status)) throw new BusinessValidationError("PUBLISH_TASK_NOT_CANCELLABLE", "当前任务状态不允许取消");
    const updated = await this.db.prepare("UPDATE publish_tasks SET status = 'cancelled', locked_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = ?").bind(now, taskId, scope.tenantId, scope.workspaceId, task.status).run();
    if ((updated.meta?.changes ?? 0) === 0) throw new BusinessValidationError("PUBLISH_TASK_STATE_CHANGED", "任务状态已变化，请刷新后重新核对");
    await this.db.prepare("INSERT INTO publish_task_logs (id, tenant_id, task_id, attempt, status, message, duration_ms, created_at) VALUES (?, ?, ?, ?, 'cancelled', ?, NULL, ?)").bind(crypto.randomUUID(), task.tenant_id, taskId, task.attempts, JSON.stringify({ actorUserId }), now).run();
  }

  async recordCronSnapshot(status: "ok" | "degraded" | "down", details: Record<string, unknown>, now: string, tenantId?: string, workspaceId?: string): Promise<void> {
    await this.db.prepare("INSERT INTO ops_health_snapshots (id, tenant_id, workspace_id, component, status, latency_ms, details_json, checked_at, source) VALUES (?, ?, ?, 'production_cron', ?, NULL, ?, ?, 'cron')").bind(crypto.randomUUID(), tenantId ?? null, workspaceId ?? null, status, JSON.stringify(details), now).run();
    if (status === "ok") await resolveOperationalAlert(this.db, "production-cron:execution", details, now);
    else await raiseOperationalAlert(this.db, { fingerprint: "production-cron:execution", tenantId, workspaceId, severity: status === "down" ? "critical" : "warning", title: status === "down" ? "生产 Cron 执行失败" : "生产 Cron 执行异常", message: status === "down" ? "生产 Cron 没有成功完成执行" : "生产 Cron 执行完成但包含异常任务", details }, now);
  }
}

async function enqueueAlertNotifications(db: D1Like, alertId: string, eventType: "triggered" | "recovered", tenantId: string | undefined, workspaceId: string | undefined, now: string): Promise<void> {
  const channels = await all<{ id: string }>(db, "SELECT id FROM ops_notification_channels WHERE channel_type = 'telegram' AND status = 'active' AND ((tenant_id = ? AND workspace_id = ?) OR tenant_id IS NULL)", tenantId ?? null, workspaceId ?? null);
  for (const channel of channels) await db.prepare("INSERT INTO ops_notification_outbox (id, alert_id, channel_id, event_type, status, attempts, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)").bind(crypto.randomUUID(), alertId, channel.id, eventType, now, now, now).run();
}

export async function raiseOperationalAlert(db: D1Like, input: OperationalAlertInput, now = new Date().toISOString()): Promise<string> {
  const existing = await db.prepare("SELECT id FROM ops_alert_events WHERE fingerprint = ? AND status IN ('open', 'acknowledged') ORDER BY last_seen_at DESC LIMIT 1").bind(input.fingerprint).first<{ id: string }>();
  if (existing) {
    await db.prepare("UPDATE ops_alert_events SET severity = ?, message = ?, details_json = ?, occurrence_count = occurrence_count + 1, last_seen_at = ? WHERE id = ?").bind(input.severity, input.message, JSON.stringify(input.details), now, existing.id).run();
    return existing.id;
  }
  const alertId = crypto.randomUUID();
  await db.prepare("INSERT INTO ops_alert_events (id, tenant_id, workspace_id, fingerprint, component, severity, status, title, message, details_json, occurrence_count, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, 'production_operations', ?, 'open', ?, ?, ?, 1, ?, ?)").bind(alertId, input.tenantId ?? null, input.workspaceId ?? null, input.fingerprint, input.severity, input.title, input.message, JSON.stringify(input.details), now, now).run();
  await enqueueAlertNotifications(db, alertId, "triggered", input.tenantId, input.workspaceId, now);
  return alertId;
}

export async function resolveOperationalAlert(db: D1Like, fingerprint: string, details: Record<string, unknown>, now = new Date().toISOString()): Promise<void> {
  const existing = await db.prepare("SELECT id, tenant_id, workspace_id FROM ops_alert_events WHERE fingerprint = ? AND status IN ('open', 'acknowledged') ORDER BY last_seen_at DESC LIMIT 1").bind(fingerprint).first<{ id: string; tenant_id?: string; workspace_id?: string }>();
  if (!existing) return;
  await db.prepare("UPDATE ops_alert_events SET status = 'resolved', resolved_at = ?, last_seen_at = ?, details_json = ? WHERE id = ?").bind(now, now, JSON.stringify(details), existing.id).run();
  await enqueueAlertNotifications(db, existing.id, "recovered", existing.tenant_id, existing.workspace_id, now);
}

export async function processNotificationOutbox(db: D1Like | undefined, token: string | undefined, now = new Date().toISOString()): Promise<{ sent: number; failed: number }> {
  if (!db || !token) return { sent: 0, failed: 0 };
  const rows = await all<{ id: string; destination_ref: string; event_type: string; title: string; message: string; attempts: number }>(db, "SELECT o.id, c.destination_ref, o.event_type, a.title, a.message, o.attempts FROM ops_notification_outbox o JOIN ops_notification_channels c ON c.id = o.channel_id JOIN ops_alert_events a ON a.id = o.alert_id WHERE o.status = 'queued' AND o.available_at <= ? AND c.status = 'active' ORDER BY o.created_at ASC LIMIT 10", now);
  const client = new TelegramBotApiClient(token, (input, init) => fetch(input, init)); const result = { sent: 0, failed: 0 };
  for (const row of rows) {
    await db.prepare("UPDATE ops_notification_outbox SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'").bind(now, row.id).run();
    const text = `${row.event_type === "recovered" ? "[恢复]" : "[告警]"} ${row.title}\n${row.message}`;
    try { await client.sendMessage(row.destination_ref, text); await db.prepare("UPDATE ops_notification_outbox SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").bind(now, now, row.id).run(); result.sent += 1; }
    catch (error) { const next = new Date(Date.parse(now) + Math.min(3600, 60 * 2 ** Math.min(row.attempts, 6)) * 1000).toISOString(); await db.prepare("UPDATE ops_notification_outbox SET status = 'queued', available_at = ?, last_error = ?, updated_at = ? WHERE id = ?").bind(next, error instanceof Error ? error.message.slice(0, 500) : "Telegram notification failed", now, row.id).run(); result.failed += 1; }
  }
  return result;
}

export async function recordProductionCronSnapshot(db: D1Like | undefined, status: "ok" | "degraded" | "down", details: Record<string, unknown>, now = new Date().toISOString()): Promise<void> {
  if (!db) return;
  try { await new ProductionOperationsRepository(db).recordCronSnapshot(status, details, now); } catch (error) { console.warn("production_cron_snapshot_failed", { message: error instanceof Error ? error.message : "unknown" }); }
}
