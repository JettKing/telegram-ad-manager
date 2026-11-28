import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./business.js";
import { TelegramApiError, TelegramBotApiClient } from "./channels.js";
import { classifyPublishError, PublishError, retryDelaySeconds, TelegramPublisher, type AssetRow, type PublishContent, type PublishedMessageProgress, type ScheduleType } from "./publishing.js";
import { raiseOperationalAlert } from "./production-operations.js";
import { enqueueCustomerNotification } from "./production-customer-notifications.js";

export interface ProductionScheduleInput {
  scheduleType: ScheduleType;
  startAt: string;
  endAt: string;
  timezone: string;
  repeatUntil?: string;
  intervalMinutes?: number;
  occurrenceLimit?: number;
}

interface ProductionTaskRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  order_id: string;
  schedule_id: string;
  channel_id: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "uncertain" | "cancelled" | "dead_letter";
  attempts: number;
  max_attempts: number;
  available_at: string;
  telegram_message_ids_json?: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

interface ProductionPayload {
  task_id: string;
  tenant_id: string;
  order_id: string;
  schedule_id: string;
  telegram_chat_id: string;
  content_text: string;
  parse_mode?: "HTML" | "MarkdownV2";
  media_type: AssetRow["media_type"] | "media_group";
  media_file_id?: string;
  media_items_json?: string;
}

interface ProductionExpiration {
  order_id: string;
  task_id: string;
  tenant_id: string;
  workspace_id: string;
  channel_id: string;
  telegram_chat_id: string;
  telegram_message_ids_json?: string;
  end_at: string;
}

export interface ProductionPublishRuntimeEnv {
  DB?: D1Like;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_API_BASE_URL?: string;
}

interface StoredPublishProgress {
  messages: PublishedMessageProgress[];
  legacyMessageIds: number[];
}

function parseStoredPublishProgress(raw?: string): StoredPublishProgress {
  if (!raw) return { messages: [], legacyMessageIds: [] };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new PublishError("PUBLISH_PROGRESS_PERSIST_FAILED", "已发送消息进度记录损坏，任务需人工核对", false); }
  if (Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && Number(item) > 0)) return { messages: [], legacyMessageIds: value as number[] };
  const progress = object(value);
  if (progress?.version !== 1 || !Array.isArray(progress.messages)) throw new PublishError("PUBLISH_PROGRESS_PERSIST_FAILED", "已发送消息进度记录格式无效，任务需人工核对", false);
  const messages: PublishedMessageProgress[] = [];
  for (const item of progress.messages) {
    const message = object(item);
    if (!message || !Number.isSafeInteger(message.messageId) || Number(message.messageId) <= 0 || typeof message.contentKey !== "string" || !message.contentKey) {
      throw new PublishError("PUBLISH_PROGRESS_PERSIST_FAILED", "已发送消息进度记录格式无效，任务需人工核对", false);
    }
    messages.push({ messageId: Number(message.messageId), contentKey: message.contentKey });
  }
  return { messages, legacyMessageIds: [] };
}

function serializePublishProgress(messages: PublishedMessageProgress[]): string {
  return JSON.stringify({ version: 1, messages });
}

function progressMessageIds(raw?: string): number[] {
  const progress = parseStoredPublishProgress(raw);
  return [...progress.legacyMessageIds, ...progress.messages.map((message) => message.messageId)];
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, field: string, max = 80): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new BusinessValidationError(`${field.toUpperCase()}_REQUIRED`, `${field} 必须是非空字符串`);
  return value.trim();
}

export function parseProductionScheduleInput(value: unknown, now = new Date()): ProductionScheduleInput {
  const input = object(value);
  const scheduleType = input?.scheduleType;
  if (scheduleType !== "once" && scheduleType !== "daily" && scheduleType !== "weekly" && scheduleType !== "custom") throw new BusinessValidationError("INVALID_SCHEDULE_TYPE", "排期类型必须是 once、daily、weekly 或 custom");
  if (scheduleType !== "once") throw new BusinessValidationError("UNSUPPORTED_REPEAT_SCHEDULE", "当前生产发布队列只支持单次排期；重复规则尚未实现实例展开");
  const startAt = text(input?.startAt ?? input?.plannedAt, "startAt");
  const endAt = text(input?.endAt ?? input?.plannedEndAt, "endAt");
  const startTime = Date.parse(startAt);
  const endTime = Date.parse(endAt);
  if (!Number.isFinite(startTime) || startTime < now.getTime() - 60_000) throw new BusinessValidationError("INVALID_START_AT", "生产排期 startAt 必须是有效且未过期的时间");
  if (!Number.isFinite(endTime) || endTime <= startTime) throw new BusinessValidationError("INVALID_END_AT", "生产排期 endAt 必须晚于 startAt");
  const timezone = typeof input?.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : "Asia/Shanghai";
  const intervalMinutes = input?.intervalMinutes === undefined ? 0 : Number(input.intervalMinutes);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 0) throw new BusinessValidationError("INVALID_INTERVAL_MINUTES", "intervalMinutes 必须是非负整数");
  const occurrenceLimit = input?.occurrenceLimit === undefined ? undefined : Number(input.occurrenceLimit);
  if (occurrenceLimit !== undefined && (!Number.isInteger(occurrenceLimit) || occurrenceLimit <= 0)) throw new BusinessValidationError("INVALID_OCCURRENCE_LIMIT", "occurrenceLimit 必须是正整数");
  if (input?.repeatUntil !== undefined || occurrenceLimit !== undefined || intervalMinutes > 0) throw new BusinessValidationError("UNSUPPORTED_REPEAT_SCHEDULE", "当前生产发布队列只支持单次排期；重复规则尚未实现实例展开");
  const repeatUntil = input?.repeatUntil === undefined ? undefined : text(input.repeatUntil, "repeatUntil");
  if (repeatUntil && (!Number.isFinite(Date.parse(repeatUntil)) || Date.parse(repeatUntil) < endTime)) throw new BusinessValidationError("INVALID_REPEAT_UNTIL", "repeatUntil 必须晚于 endAt");
  return { scheduleType, startAt: new Date(startTime).toISOString(), endAt: new Date(endTime).toISOString(), timezone, repeatUntil: repeatUntil ? new Date(Date.parse(repeatUntil)).toISOString() : undefined, intervalMinutes, occurrenceLimit };
}

async function all<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T[]> {
  const prepared = db.prepare(query).bind(...values);
  if (!prepared.all) return [];
  return (await prepared.all<T>()).results;
}

export class ProductionPublishRepository {
  constructor(private readonly db: D1Like) {}

  async listSchedules(tenantId: string, workspaceId: string): Promise<Array<Record<string, unknown>>> {
    return all<Record<string, unknown>>(this.db, `SELECT id, order_id, channel_id, schedule_type AS scheduleType, start_at AS startAt, end_at AS endAt, timezone, repeat_until AS repeatUntil, interval_minutes AS intervalMinutes, occurrence_limit AS occurrenceLimit, status, created_at AS createdAt, updated_at AS updatedAt FROM ad_schedules WHERE tenant_id = ? AND workspace_id = ? ORDER BY start_at DESC LIMIT 200`, tenantId, workspaceId);
  }

  async listTasks(tenantId: string, workspaceId: string): Promise<Array<Record<string, unknown>>> {
    return all<Record<string, unknown>>(this.db, `SELECT id, order_id, schedule_id, channel_id, status, attempts, max_attempts AS maxAttempts, available_at AS availableAt, locked_at AS lockedAt, completed_at AS completedAt, telegram_message_ids_json AS telegramMessageIdsJson, last_error_code AS lastErrorCode, last_error_message AS lastErrorMessage, created_at AS createdAt, updated_at AS updatedAt FROM publish_tasks WHERE tenant_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 200`, tenantId, workspaceId);
  }

  private async getOrder(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<{ id: string; status: string; channel_id: string }> {
    const order = await this.db.prepare("SELECT id, status, channel_id FROM ad_orders WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(orderId, scope.tenantId, scope.workspaceId).first<{ id: string; status: string; channel_id: string }>();
    if (!order) throw new BusinessValidationError("ORDER_NOT_FOUND", "生产订单不存在或不属于当前工作空间");
    return order;
  }

  async createSchedule(scope: { tenantId: string; workspaceId: string }, orderId: string, input: ProductionScheduleInput, now: string): Promise<{ scheduleId: string; taskId: string; idempotencyKey: string }> {
    if (input.scheduleType !== "once" || input.repeatUntil !== undefined || input.occurrenceLimit !== undefined || (input.intervalMinutes ?? 0) !== 0) throw new BusinessValidationError("UNSUPPORTED_REPEAT_SCHEDULE", "当前生产发布队列只支持单次排期；重复规则尚未实现实例展开");
    const order = await this.getOrder(scope, orderId);
    if (order.status !== "approved") throw new BusinessValidationError("ORDER_NOT_APPROVED", "只有 approved 订单可以进入生产排期");
    const channel = await this.db.prepare(`SELECT c.id FROM telegram_channels c JOIN telegram_channel_permissions p ON p.channel_id = c.id AND p.tenant_id = c.tenant_id
      WHERE c.id = ? AND c.tenant_id = ? AND c.workspace_id = ? AND c.status = 'active' AND p.can_post_messages = 1 AND p.can_delete_messages = 1 ORDER BY p.checked_at DESC LIMIT 1`).bind(order.channel_id, scope.tenantId, scope.workspaceId).first<{ id: string }>();
    if (!channel) throw new BusinessValidationError("CHANNEL_NOT_READY", "生产频道不存在或未同时授予 can_post_messages 与 can_delete_messages 权限");
    const scheduleId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const idempotencyKey = `schedule:${orderId}:${input.startAt}`;
    await this.db.prepare(`INSERT INTO ad_schedules (id, tenant_id, workspace_id, order_id, channel_id, schedule_type, timezone, start_at, end_at, status, idempotency_key, created_at, updated_at, repeat_until, interval_minutes, occurrence_limit, delay_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, 0)`).bind(scheduleId, scope.tenantId, scope.workspaceId, orderId, order.channel_id, input.scheduleType, input.timezone, input.startAt, input.endAt, idempotencyKey, now, now, input.repeatUntil ?? null, input.intervalMinutes ?? 0, input.occurrenceLimit ?? null).run();
    await this.db.prepare(`INSERT INTO publish_tasks (id, tenant_id, workspace_id, order_id, schedule_id, channel_id, status, attempts, max_attempts, available_at, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, 5, ?, ?, ?, ?)`).bind(taskId, scope.tenantId, scope.workspaceId, orderId, scheduleId, order.channel_id, input.startAt, idempotencyKey, now, now).run();
    await this.db.prepare("UPDATE ad_orders SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'approved'").bind(input.startAt, now, orderId, scope.tenantId, scope.workspaceId).run();
    return { scheduleId, taskId, idempotencyKey };
  }

  async claimNextTask(now: string): Promise<ProductionTaskRow | null> {
    const candidates = await all<ProductionTaskRow>(this.db, `SELECT id, tenant_id, workspace_id, order_id, schedule_id, channel_id, status, attempts, max_attempts, available_at, telegram_message_ids_json, idempotency_key, created_at, updated_at
      FROM publish_tasks WHERE status = 'queued' AND available_at <= ? ORDER BY available_at ASC, created_at ASC LIMIT 20`, now);
    for (const candidate of candidates) {
      const result = await this.db.prepare("UPDATE publish_tasks SET status = 'processing', locked_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued' AND attempts = ?").bind(now, now, candidate.id, candidate.attempts).run();
      if ((result.meta?.changes ?? 0) > 0) return { ...candidate, status: "processing", attempts: candidate.attempts + 1, updated_at: now };
    }
    return null;
  }

  async payload(taskId: string): Promise<{ task: ProductionTaskRow; payload: ProductionPayload; content: PublishContent; assets: AssetRow[] }> {
    const task = await this.db.prepare(`SELECT id, tenant_id, workspace_id, order_id, schedule_id, channel_id, status, attempts, max_attempts, available_at, telegram_message_ids_json, idempotency_key, created_at, updated_at
      FROM publish_tasks WHERE id = ? LIMIT 1`).bind(taskId).first<ProductionTaskRow>();
    if (!task) throw new PublishError("TASK_NOT_FOUND", "生产发布任务不存在", false);
    const payload = await this.db.prepare(`SELECT t.id AS task_id, t.tenant_id, o.id AS order_id, t.schedule_id, c.telegram_chat_id, o.content_text, o.parse_mode, o.media_type, o.media_file_id, o.media_items_json
      FROM publish_tasks t JOIN ad_orders o ON o.id = t.order_id JOIN telegram_channels c ON c.id = t.channel_id WHERE t.id = ? LIMIT 1`).bind(taskId).first<ProductionPayload>();
    if (!payload) throw new PublishError("PUBLISH_PAYLOAD_NOT_FOUND", "生产发布上下文不存在", false);
    const content: PublishContent = { text: payload.content_text ?? "", assetIds: [], entities: [] };
    const assets = await all<AssetRow>(this.db, `SELECT id, media_type, file_id, caption, sort_order FROM creative_media WHERE creative_id = (SELECT creative_id FROM ad_orders WHERE id = ?) AND (review_status = 'approved' OR review_status IS NULL) ORDER BY sort_order ASC`, payload.order_id);
    if (payload.media_file_id && assets.length === 0) assets.push({ id: `order-media:${payload.order_id}`, media_type: payload.media_type === "media_group" ? "album" : payload.media_type, file_id: payload.media_file_id, sort_order: 0 });
    if (payload.media_items_json && assets.length === 0) {
      try {
        const items = JSON.parse(payload.media_items_json) as Array<{ fileId?: string; mediaType?: AssetRow["media_type"] }>;
        for (const [index, item] of items.entries()) if (item.fileId) assets.push({ id: `order-media:${payload.order_id}:${index}`, media_type: item.mediaType ?? "document", file_id: item.fileId, sort_order: index });
      } catch { throw new PublishError("INVALID_MEDIA_ITEMS", "生产订单 media_items_json 不是有效 JSON", false); }
    }
    return { task, payload, content, assets };
  }

  async recordPublishedMessage(task: ProductionTaskRow, messageId: number, contentKey: string, now: string): Promise<void> {
    const progress = parseStoredPublishProgress(task.telegram_message_ids_json);
    if (progress.legacyMessageIds.length > 0) throw new PublishError("PUBLISH_PROGRESS_PERSIST_FAILED", "旧版发布进度无法映射到素材，任务需人工核对", false);
    const existing = progress.messages.find((item) => item.contentKey === contentKey);
    if (existing && existing.messageId !== messageId) throw new PublishError("PUBLISH_PROGRESS_PERSIST_FAILED", "同一素材对应多个已发送消息，任务需人工核对", false);
    if (!existing) progress.messages.push({ messageId, contentKey });
    const serialized = serializePublishProgress(progress.messages);
    const result = await this.db.prepare("UPDATE publish_tasks SET telegram_message_ids_json = ?, updated_at = ? WHERE id = ? AND status = 'processing' AND attempts = ?").bind(serialized, now, task.id, task.attempts).run();
    if ((result.meta?.changes ?? 0) === 0) throw new PublishError("PUBLISH_PROGRESS_PERSIST_FAILED", "已发送消息但任务租约已失效；请人工核对频道后再处理", false);
    task.telegram_message_ids_json = serialized;
  }

  async markStaleProcessingUncertain(now: string, leaseMinutes = 30): Promise<number> {
    const cutoff = new Date(Date.parse(now) - leaseMinutes * 60_000).toISOString();
    const result = await this.db.prepare(`UPDATE publish_tasks SET status = 'uncertain', locked_at = NULL, last_error_code = 'STALE_PROCESSING_RECOVERY',
      last_error_message = 'Worker 租约过期，Telegram 发送结果需人工核对；系统未自动重发以避免重复投放', updated_at = ?
      WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at <= ?`).bind(now, cutoff).run();
    const recovered = Number(result.meta?.changes ?? 0);
    if (recovered > 0) await this.db.prepare(`UPDATE ad_orders SET status = 'failed', updated_at = ? WHERE status IN ('scheduled', 'publishing')
      AND id IN (SELECT order_id FROM publish_tasks WHERE status = 'uncertain' AND last_error_code = 'STALE_PROCESSING_RECOVERY' AND updated_at = ?)`).bind(now, now).run();
    return recovered;
  }

  async markSucceeded(task: ProductionTaskRow, messageIds: number[], now: string): Promise<void> {
    const progress = parseStoredPublishProgress(task.telegram_message_ids_json);
    if (progress.legacyMessageIds.length > 0 || JSON.stringify(progress.messages.map((item) => item.messageId)) !== JSON.stringify(messageIds)) {
      throw new PublishError("PUBLISH_PROGRESS_PERSIST_FAILED", "最终消息清单与已持久化进度不一致，任务需人工核对", false);
    }
    if (!this.db.batch) throw new PublishError("PUBLISH_FINALIZE_UNAVAILABLE", "D1 不支持原子发布状态提交，任务需人工核对", false);
    const statements = [
      this.db.prepare("UPDATE publish_tasks SET status = 'succeeded', completed_at = ?, locked_at = NULL, telegram_message_ids_json = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ? WHERE id = ? AND status = 'processing' AND attempts = ?").bind(now, serializePublishProgress(progress.messages), now, task.id, task.attempts),
      this.db.prepare("INSERT INTO publish_task_logs (id, tenant_id, task_id, attempt, status, message, duration_ms, created_at) SELECT ?, ?, ?, ?, 'succeeded', ?, NULL, ? WHERE EXISTS (SELECT 1 FROM publish_tasks WHERE id = ? AND status = 'succeeded' AND attempts = ? AND completed_at = ?)").bind(crypto.randomUUID(), task.tenant_id, task.id, task.attempts, JSON.stringify({ messageIds }), now, task.id, task.attempts, now),
      this.db.prepare("UPDATE ad_orders SET status = CASE WHEN status IN ('scheduled', 'publishing', 'failed') THEN 'published' ELSE status END, published_at = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM publish_tasks WHERE id = ? AND status = 'succeeded' AND attempts = ? AND completed_at = ?)").bind(now, now, task.order_id, task.id, task.attempts, now),
    ];
    const results = await this.db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) === 0) throw new PublishError("PUBLISH_TASK_LEASE_LOST", "发布已完成但任务租约已失效；请人工核对频道", false);
  }

  async markFailed(task: ProductionTaskRow, error: PublishError, now: string): Promise<"queued" | "dead_letter" | "uncertain" | "lease_lost"> {
    let hasPartialProgress = false;
    try { const progress = parseStoredPublishProgress(task.telegram_message_ids_json); hasPartialProgress = progress.legacyMessageIds.length > 0 || progress.messages.length > 0; } catch { hasPartialProgress = true; }
    const outcomeUncertain = hasPartialProgress || error.code === "PUBLISH_NETWORK_ERROR" || error.code === "PUBLISH_PROGRESS_PERSIST_FAILED" || (error.code === "TELEGRAM_API_ERROR" && error.retryable);
    const retry = error.retryable && !outcomeUncertain && task.attempts < task.max_attempts;
    const nextAt = retry ? new Date(Date.parse(now) + retryDelaySeconds(task.attempts, error.retryAfterSeconds) * 1000).toISOString() : null;
    const status = retry ? "queued" : outcomeUncertain ? "uncertain" : "dead_letter";
    if (!this.db.batch) throw new PublishError("PUBLISH_FINALIZE_UNAVAILABLE", "D1 不支持原子发布状态提交，任务需人工核对", false);
    const errorMessage = error.message.slice(0, 500);
    const statements = [
      this.db.prepare("UPDATE publish_tasks SET status = ?, available_at = COALESCE(?, available_at), locked_at = NULL, last_error_code = ?, last_error_message = ?, updated_at = ? WHERE id = ? AND status = 'processing' AND attempts = ?").bind(status, nextAt, error.code, errorMessage, now, task.id, task.attempts),
      this.db.prepare("INSERT INTO publish_task_logs (id, tenant_id, task_id, attempt, status, message, duration_ms, created_at) SELECT ?, ?, ?, ?, ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM publish_tasks WHERE id = ? AND status = ? AND attempts = ? AND last_error_code = ?)").bind(crypto.randomUUID(), task.tenant_id, task.id, task.attempts, status, JSON.stringify({ code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds }), now, task.id, status, task.attempts, error.code),
      this.db.prepare("UPDATE ad_orders SET status = 'failed', updated_at = ? WHERE ? <> 'queued' AND id = ? AND status IN ('scheduled', 'publishing') AND EXISTS (SELECT 1 FROM publish_tasks WHERE id = ? AND status = ? AND attempts = ? AND last_error_code = ?)").bind(now, status, task.order_id, task.id, status, task.attempts, error.code),
    ];
    const results = await this.db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) === 0) return "lease_lost";
    return status;
  }

  async dueExpirations(now: string): Promise<ProductionExpiration[]> {
    return all<ProductionExpiration>(this.db, `SELECT o.id AS order_id, t.id AS task_id, t.tenant_id, t.workspace_id, t.channel_id, c.telegram_chat_id, t.telegram_message_ids_json, s.end_at
      FROM ad_orders o JOIN ad_schedules s ON s.order_id = o.id JOIN publish_tasks t ON t.schedule_id = s.id JOIN telegram_channels c ON c.id = t.channel_id
      WHERE o.status = 'published' AND s.end_at <= ? AND t.status = 'succeeded'
        AND (NOT EXISTS (SELECT 1 FROM publish_expiration_failures f WHERE f.task_id = t.id)
          OR EXISTS (SELECT 1 FROM publish_expiration_failures f WHERE f.task_id = t.id AND f.status IN ('pending', 'retrying') AND f.next_attempt_at <= ?))
      ORDER BY s.end_at ASC LIMIT 50`, now, now);
  }

  async markExpired(expiration: ProductionExpiration, result: "succeeded" | "failed", now: string, errorMessage?: string): Promise<void> {
    if (result === "succeeded") {
      await this.db.prepare("UPDATE ad_orders SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'published'").bind(now, expiration.order_id).run();
      await this.db.prepare("UPDATE publish_expiration_failures SET status = 'succeeded', resolved_at = ?, last_attempt_at = ?, updated_at = ? WHERE task_id = ? AND status NOT IN ('succeeded', 'acknowledged')").bind(now, now, now, expiration.task_id).run(); await enqueueCustomerNotification(this.db, { tenantId: expiration.tenant_id, workspaceId: expiration.workspace_id, orderId: expiration.order_id, event: "ad_expired", objectId: expiration.task_id, now });
    } else {
      const existing = await this.db.prepare("SELECT id, attempts FROM publish_expiration_failures WHERE task_id = ? LIMIT 1").bind(expiration.task_id).first<{ id: string; attempts: number }>();
      const attempts = Number(existing?.attempts ?? 0) + 1;
      const nextAttempt = new Date(Date.parse(now) + Math.min(3600, 60 * 2 ** Math.min(attempts - 1, 6)) * 1000).toISOString();
      if (existing) await this.db.prepare("UPDATE publish_expiration_failures SET status = 'retrying', attempts = ?, next_attempt_at = ?, last_error = ?, last_attempt_at = ?, updated_at = ? WHERE id = ?").bind(attempts, nextAttempt, errorMessage ?? "到期删除失败", now, now, existing.id).run();
      else await this.db.prepare("INSERT INTO publish_expiration_failures (id, tenant_id, workspace_id, order_id, task_id, channel_id, telegram_chat_id, message_ids_json, status, attempts, next_attempt_at, last_error, first_failed_at, last_attempt_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), expiration.tenant_id, expiration.workspace_id, expiration.order_id, expiration.task_id, expiration.channel_id, expiration.telegram_chat_id, expiration.telegram_message_ids_json ?? "[]", attempts, nextAttempt, errorMessage ?? "到期删除失败", now, now, now, now).run();
      await raiseOperationalAlert(this.db, { fingerprint: `expiration-delete:${expiration.task_id}`, tenantId: expiration.tenant_id, workspaceId: expiration.workspace_id, severity: "critical", title: "广告到期删除失败", message: `订单 ${expiration.order_id} 的 Telegram 广告未能按时删除`, details: { taskId: expiration.task_id, attempts, nextAttempt, error: errorMessage ?? "到期删除失败" } }, now);
    }
    await this.db.prepare("INSERT INTO publish_task_logs (id, tenant_id, task_id, attempt, status, message, duration_ms, created_at) SELECT ?, tenant_id, id, attempts, ?, ?, NULL, ? FROM publish_tasks WHERE id = ?").bind(crypto.randomUUID(), result, JSON.stringify({ expiration: true, error: errorMessage ?? null }), now, expiration.task_id).run();
  }

  async listExpirationFailures(scope: { tenantId: string; workspaceId: string }): Promise<Array<Record<string, unknown>>> { return all<Record<string, unknown>>(this.db, "SELECT id, order_id AS orderId, task_id AS taskId, channel_id AS channelId, telegram_chat_id AS telegramChatId, status, attempts, next_attempt_at AS nextAttemptAt, last_error AS lastError, first_failed_at AS firstFailedAt, last_attempt_at AS lastAttemptAt, resolved_at AS resolvedAt, resolution_note AS resolutionNote FROM publish_expiration_failures WHERE tenant_id = ? AND workspace_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'retrying' THEN 1 ELSE 2 END, first_failed_at DESC LIMIT 200", scope.tenantId, scope.workspaceId); }

  async retryExpirationFailure(scope: { tenantId: string; workspaceId: string }, failureId: string, now: string): Promise<void> { const row = await this.db.prepare("SELECT id FROM publish_expiration_failures WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status IN ('pending', 'retrying') LIMIT 1").bind(failureId, scope.tenantId, scope.workspaceId).first<{ id: string }>(); if (!row) throw new BusinessValidationError("EXPIRATION_FAILURE_NOT_FOUND", "到期删除失败记录不存在或不可重试"); await this.db.prepare("UPDATE publish_expiration_failures SET next_attempt_at = ?, updated_at = ? WHERE id = ?").bind(now, now, failureId).run(); }

  async acknowledgeExpirationFailure(scope: { tenantId: string; workspaceId: string }, failureId: string, userId: string, note: string, now: string): Promise<void> { const row = await this.db.prepare("SELECT id FROM publish_expiration_failures WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status IN ('pending', 'retrying') LIMIT 1").bind(failureId, scope.tenantId, scope.workspaceId).first<{ id: string }>(); if (!row) throw new BusinessValidationError("EXPIRATION_FAILURE_NOT_FOUND", "到期删除失败记录不存在或已处理"); await this.db.prepare("UPDATE publish_expiration_failures SET status = 'acknowledged', resolved_at = ?, resolved_by = ?, resolution_note = ?, updated_at = ? WHERE id = ?").bind(now, userId, note, now, failureId).run(); }
}

function isAlreadyDeleted(error: unknown): boolean {
  return error instanceof TelegramApiError && error.errorCode === 400 && /message to delete not found/i.test(error.message);
}

export async function processProductionDuePublishTasks(env: ProductionPublishRuntimeEnv, now = new Date().toISOString()): Promise<{ processed: number; succeeded: number; retried: number; failed: number; expired: number; expirationFailed: number }> {
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN) return { processed: 0, succeeded: 0, retried: 0, failed: 0, expired: 0, expirationFailed: 0 };
  const repository = new ProductionPublishRepository(env.DB);
  const publisher = new TelegramPublisher(new TelegramBotApiClient(env.TELEGRAM_BOT_TOKEN, (input, init) => fetch(input, init), env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org"));
  const result = { processed: 0, succeeded: 0, retried: 0, failed: 0, expired: 0, expirationFailed: 0 };
  result.failed += await repository.markStaleProcessingUncertain(now);
  for (let index = 0; index < 10; index += 1) {
    const task = await repository.claimNextTask(now);
    if (!task) break;
    result.processed += 1;
    let processingTask = task;
    try {
      const data = await repository.payload(task.id);
      processingTask = data.task;
      const progress = parseStoredPublishProgress(data.task.telegram_message_ids_json);
      if (progress.legacyMessageIds.length > 0) throw new PublishError("PUBLISH_PROGRESS_SOURCE_UNKNOWN", "旧版已发送消息无法映射到具体素材，任务需人工核对", false);
      const messageIds = await publisher.publishMany(data.payload.telegram_chat_id, data.content, data.assets, (messageId, contentKey) => repository.recordPublishedMessage(processingTask, messageId, contentKey, now), progress.messages);
      await repository.markSucceeded(processingTask, messageIds, now);
      result.succeeded += 1;
    } catch (error) {
      const failure = classifyPublishError(error);
      const status = await repository.markFailed(processingTask, failure, now);
      if (status === "queued") result.retried += 1; else if (status !== "lease_lost") result.failed += 1;
    }
  }
  for (const expiration of await repository.dueExpirations(now)) {
    let messageIds: number[] = [];
    try { messageIds = progressMessageIds(expiration.telegram_message_ids_json); } catch { messageIds = []; }
    try {
      if (messageIds.length === 0) throw new PublishError("NO_MESSAGE_IDS", "生产任务没有可删除的 Telegram message_id", false);
      for (const messageId of messageIds) {
        try { await publisher.client.deleteMessage(expiration.telegram_chat_id, messageId); }
        catch (error) { if (!isAlreadyDeleted(error)) throw error; }
      }
      await repository.markExpired(expiration, "succeeded", now);
      result.expired += 1;
    } catch (error) {
      const failure = error instanceof TelegramApiError ? error.message : error instanceof Error ? error.message : "到期删除失败";
      console.warn("production_expiration_delete_failed", { orderId: expiration.order_id, message: failure });
      await repository.markExpired(expiration, "failed", now, failure);
      result.expirationFailed += 1;
    }
  }
  return result;
}
