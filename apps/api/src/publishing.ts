import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./business.js";
import { TelegramApiError, TelegramBotApiClient } from "./channels.js";

export type ScheduleType = "once" | "daily" | "weekly" | "custom";
export type PublishTaskStatus = "queued" | "processing" | "succeeded" | "failed" | "uncertain" | "cancelled";

export interface ScheduleInput {
  scheduleType: ScheduleType;
  plannedAt: string;
  plannedEndAt?: string;
}

export interface PublishContent {
  text: string;
  assetIds: string[];
  entities: unknown[];
}

export interface PublishedMessageProgress { messageId: number; contentKey: string }

interface ScheduleRow { id: string; order_id: string; channel_id: string; schedule_type: ScheduleType; planned_at: string; paused_at?: string; cancelled_at?: string; created_at: string; updated_at: string }
interface TaskRow { id: string; order_id: string; schedule_id?: string; idempotency_key: string; status: PublishTaskStatus; attempts: number; max_attempts: number; next_attempt_at?: string; last_error_code?: string; last_error_message?: string; created_at: string; updated_at: string }
interface PayloadRow { task_id: string; order_id: string; channel_id: string; telegram_chat_id: string; content_json: string; planned_at: string; status: string }
export interface AssetRow { id: string; media_type: "text" | "photo" | "video" | "animation" | "document" | "album"; file_id?: string; caption?: string; sort_order: number }
interface ExpirationRow { order_id: string; telegram_chat_id: string; telegram_message_id: number; planned_end_at: string }

export interface PublishRuntimeEnv {
  DB?: D1Like;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_API_BASE_URL?: string;
  TELEGRAM_BOT_IDENTITY_ID?: string;
}

export class PublishError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "PublishError";
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) throw new BusinessValidationError(`${field.toUpperCase()}_REQUIRED`, `${field} 必须是非空字符串`);
  return value.trim();
}

export function parseScheduleInput(value: unknown, now = new Date()): ScheduleInput {
  const input = object(value);
  const scheduleType = input?.scheduleType;
  if (scheduleType !== "once" && scheduleType !== "daily" && scheduleType !== "weekly" && scheduleType !== "custom") throw new BusinessValidationError("INVALID_SCHEDULE_TYPE", "排期类型必须是 once、daily、weekly 或 custom");
  const plannedAt = requiredString(input?.plannedAt, "plannedAt", 80);
  const plannedTime = Date.parse(plannedAt);
  if (!Number.isFinite(plannedTime) || plannedTime < now.getTime() - 60_000) throw new BusinessValidationError("INVALID_PLANNED_AT", "计划发布时间必须是有效且未过期的时间");
  const plannedEndAt = input?.plannedEndAt === undefined ? undefined : requiredString(input.plannedEndAt, "plannedEndAt", 80);
  if (plannedEndAt && Date.parse(plannedEndAt) <= plannedTime) throw new BusinessValidationError("INVALID_PLANNED_END_AT", "到期时间必须晚于计划发布时间");
  if (scheduleType !== "once" || input?.repeatUntil !== undefined || input?.intervalMinutes !== undefined || input?.occurrenceLimit !== undefined) throw new BusinessValidationError("UNSUPPORTED_REPEAT_SCHEDULE", "当前发布队列只支持单次排期；重复规则尚未实现实例展开");
  return { scheduleType, plannedAt: new Date(plannedTime).toISOString(), plannedEndAt: plannedEndAt ? new Date(Date.parse(plannedEndAt)).toISOString() : undefined };
}

export function retryDelaySeconds(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0) return Math.min(retryAfterSeconds, 3_600);
  return Math.min(30 * (2 ** Math.max(0, attempt - 1)), 3_600);
}

export function classifyPublishError(error: unknown): PublishError {
  if (error instanceof PublishError) return error;
  if (error instanceof TelegramApiError) {
    const retryable = error.errorCode === 429 || error.errorCode === undefined || error.errorCode >= 500;
    return new PublishError(error.errorCode === 429 ? "TELEGRAM_RATE_LIMIT" : "TELEGRAM_API_ERROR", error.message, retryable, error.retryAfterSeconds);
  }
  return new PublishError("PUBLISH_NETWORK_ERROR", error instanceof Error ? error.message : "发布网络请求失败", true);
}

async function all<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T[]> {
  const prepared = db.prepare(query).bind(...values);
  if (!prepared.all) return [];
  return (await prepared.all<T>()).results;
}

export class D1PublishRepository {
  constructor(private readonly db: D1Like) {}

  private async order(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<{ id: string; status: string; channel_id: string }> {
    const row = await this.db.prepare("SELECT id, status, channel_id FROM ad_orders WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(orderId, scope.tenantId, scope.workspaceId).first<{ id: string; status: string; channel_id: string }>();
    if (!row) throw new BusinessValidationError("ORDER_NOT_FOUND", "订单不存在或不属于当前工作空间");
    return row;
  }

  async listSchedules(tenantId: string, workspaceId: string): Promise<ScheduleRow[]> {
    return all<ScheduleRow>(this.db, `SELECT s.id, s.order_id, s.channel_id, s.schedule_type, s.planned_at, s.paused_at, s.cancelled_at, s.created_at, s.updated_at
      FROM ad_schedules s JOIN ad_orders o ON o.id = s.order_id
      WHERE s.tenant_id = ? AND o.workspace_id = ? ORDER BY s.planned_at ASC LIMIT 200`, tenantId, workspaceId);
  }

  async listTasks(tenantId: string, workspaceId: string): Promise<TaskRow[]> {
    return all<TaskRow>(this.db, `SELECT t.id, t.order_id, t.schedule_id, t.idempotency_key, t.status, t.attempts, t.max_attempts, t.next_attempt_at, t.last_error_code, t.last_error_message, t.created_at, t.updated_at
      FROM ad_publish_tasks t JOIN ad_orders o ON o.id = t.order_id
      WHERE t.tenant_id = ? AND o.workspace_id = ? ORDER BY t.created_at DESC LIMIT 200`, tenantId, workspaceId);
  }

  async createSchedule(scope: { tenantId: string; workspaceId: string }, actorUserId: string, orderId: string, input: ScheduleInput, now: string): Promise<{ scheduleId: string; taskId: string }> {
    if (input.scheduleType !== "once") throw new BusinessValidationError("UNSUPPORTED_REPEAT_SCHEDULE", "当前发布队列只支持单次排期；重复规则尚未实现实例展开");
    const order = await this.order(scope, orderId);
    if (order.status !== "approved") throw new BusinessValidationError("ORDER_NOT_APPROVED", "只有 approved 订单可以进入排期");
    const channel = await this.db.prepare("SELECT id FROM telegram_channels WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'active' AND can_post = 1 LIMIT 1").bind(order.channel_id, scope.tenantId, scope.workspaceId).first<{ id: string }>();
    if (!channel) throw new BusinessValidationError("CHANNEL_NOT_READY", "订单频道不存在或不具备发布权限");
    const scheduleId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await this.db.prepare("INSERT INTO ad_schedules (id, order_id, tenant_id, channel_id, schedule_type, planned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(scheduleId, orderId, scope.tenantId, order.channel_id, input.scheduleType, input.plannedAt, now, now).run();
    await this.db.prepare("INSERT INTO ad_publish_tasks (id, order_id, schedule_id, tenant_id, idempotency_key, status, attempts, max_attempts, next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', 0, 5, ?, ?, ?)").bind(taskId, orderId, scheduleId, scope.tenantId, `schedule:${scheduleId}`, input.plannedAt, now, now).run();
    await this.db.prepare("UPDATE ad_orders SET status = 'scheduled', planned_publish_at = ?, planned_end_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'approved'").bind(input.plannedAt, input.plannedEndAt ?? null, now, orderId, scope.tenantId, scope.workspaceId).run();
    await this.db.prepare("INSERT INTO ad_order_revisions (id, order_id, actor_user_id, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), orderId, actorUserId, "scheduled", JSON.stringify({ status: "approved" }), JSON.stringify({ status: "scheduled", scheduleId, plannedAt: input.plannedAt }), now).run();
    return { scheduleId, taskId };
  }

  async claimNextTask(now: string): Promise<TaskRow | null> {
    const candidates = await all<TaskRow>(this.db, "SELECT id, order_id, schedule_id, idempotency_key, status, attempts, max_attempts, next_attempt_at, last_error_code, last_error_message, created_at, updated_at FROM ad_publish_tasks WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY next_attempt_at ASC, created_at ASC LIMIT 20", now);
    for (const candidate of candidates) {
      const result = await this.db.prepare("UPDATE ad_publish_tasks SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'").bind(now, candidate.id).run();
      if ((result.meta?.changes ?? 0) > 0) return { ...candidate, status: "processing", attempts: candidate.attempts + 1, updated_at: now };
    }
    return null;
  }

  async payload(taskId: string): Promise<{ task: TaskRow; payload: PayloadRow; content: PublishContent; assets: AssetRow[] }> {
    const task = await this.db.prepare("SELECT id, order_id, schedule_id, idempotency_key, status, attempts, max_attempts, next_attempt_at, last_error_code, last_error_message, created_at, updated_at FROM ad_publish_tasks WHERE id = ? LIMIT 1").bind(taskId).first<TaskRow>();
    if (!task) throw new PublishError("TASK_NOT_FOUND", "发布任务不存在", false);
    const payload = await this.db.prepare(`SELECT t.id AS task_id, o.id AS order_id, o.channel_id, c.telegram_chat_id, o.content_json, s.planned_at, o.status
      FROM ad_publish_tasks t JOIN ad_orders o ON o.id = t.order_id JOIN telegram_channels c ON c.id = o.channel_id LEFT JOIN ad_schedules s ON s.id = t.schedule_id WHERE t.id = ? LIMIT 1`).bind(taskId).first<PayloadRow>();
    if (!payload) throw new PublishError("PUBLISH_PAYLOAD_NOT_FOUND", "发布任务上下文不存在", false);
    let content: PublishContent;
    try { content = JSON.parse(payload.content_json) as PublishContent; } catch { throw new PublishError("INVALID_ORDER_CONTENT", "订单内容不是有效 JSON", false); }
    const assets = await all<AssetRow>(this.db, `SELECT r.media_asset_id AS id, m.media_type, m.file_id, m.caption, r.sort_order FROM ad_order_media_refs r JOIN media_assets m ON m.id = r.media_asset_id WHERE r.order_id = ? AND m.status = 'ready' ORDER BY r.sort_order ASC`, payload.order_id);
    return { task, payload, content, assets };
  }

  async markSucceeded(task: TaskRow, messageId: number, chatId: string, now: string): Promise<void> {
    await this.db.prepare("UPDATE ad_publish_tasks SET status = 'succeeded', next_attempt_at = NULL, last_error_code = NULL, last_error_message = NULL, updated_at = ? WHERE id = ? AND status = 'processing'").bind(now, task.id).run();
    await this.db.prepare("INSERT INTO ad_publish_logs (id, task_id, telegram_chat_id, telegram_message_id, result, executed_at) VALUES (?, ?, ?, ?, 'succeeded', ?)").bind(crypto.randomUUID(), task.id, chatId, messageId, now).run();
    await this.db.prepare("UPDATE ad_orders SET status = CASE WHEN status IN ('scheduled', 'publishing') THEN 'published' ELSE status END, actual_publish_at = ?, updated_at = ? WHERE id = ?").bind(now, now, task.order_id).run();
  }

  async markFailed(task: TaskRow, error: PublishError, now: string): Promise<{ status: PublishTaskStatus; retryAt?: string }> {
    const shouldRetry = error.retryable && task.attempts < task.max_attempts;
    const retryAt = shouldRetry ? new Date(Date.parse(now) + retryDelaySeconds(task.attempts, error.retryAfterSeconds) * 1000).toISOString() : undefined;
    const status: PublishTaskStatus = shouldRetry ? "queued" : error.code === "PUBLISH_NETWORK_ERROR" || error.code === "PUBLISH_PARTIAL_SEND" ? "uncertain" : "failed";
    await this.db.prepare("UPDATE ad_publish_tasks SET status = ?, next_attempt_at = ?, last_error_code = ?, last_error_message = ?, updated_at = ? WHERE id = ? AND status = 'processing'").bind(status, retryAt ?? null, error.code, error.message.slice(0, 500), now, task.id).run();
    await this.db.prepare("INSERT INTO ad_publish_logs (id, task_id, telegram_chat_id, result, error_code, error_message, retry_after_seconds, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), task.id, "unknown", status === "uncertain" ? "uncertain" : "failed", error.code, error.message.slice(0, 500), error.retryAfterSeconds ?? null, now).run();
    if (status === "failed" || status === "uncertain") await this.db.prepare("UPDATE ad_orders SET status = 'failed', updated_at = ? WHERE id = ? AND status IN ('scheduled', 'publishing')").bind(now, task.order_id).run();
    return { status, retryAt };
  }

  async dueExpirations(now: string): Promise<ExpirationRow[]> {
    return all<ExpirationRow>(this.db, `SELECT o.id AS order_id, o.planned_end_at, l.telegram_chat_id, l.telegram_message_id
      FROM ad_orders o JOIN ad_publish_tasks t ON t.order_id = o.id JOIN ad_publish_logs l ON l.task_id = t.id
      WHERE o.status = 'published' AND o.planned_end_at IS NOT NULL AND o.planned_end_at <= ? AND l.result = 'succeeded' AND l.telegram_message_id IS NOT NULL
      GROUP BY o.id ORDER BY o.planned_end_at ASC LIMIT 50`, now);
  }

  async markExpired(orderId: string, chatId: string, messageId: number, result: "succeeded" | "failed", now: string): Promise<void> {
    await this.db.prepare("UPDATE ad_orders SET status = CASE WHEN ? = 'succeeded' THEN 'completed' ELSE status END, actual_end_at = CASE WHEN ? = 'succeeded' THEN ? ELSE actual_end_at END, updated_at = ? WHERE id = ? AND status = 'published'").bind(result, result, now, now, orderId).run();
    const task = await this.db.prepare("SELECT id FROM ad_publish_tasks WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").bind(orderId).first<{ id: string }>();
    if (task) await this.db.prepare("INSERT INTO ad_publish_logs (id, task_id, telegram_chat_id, telegram_message_id, result, error_code, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), task.id, chatId, messageId, result, result === "failed" ? "EXPIRATION_DELETE_FAILED" : null, now).run();
  }
}

export class TelegramPublisher {
  constructor(public readonly client: TelegramBotApiClient) {}

  async publishMany(chatId: string, content: PublishContent, assets: AssetRow[], onMessage?: (messageId: number, contentKey: string) => Promise<void>, alreadyPublished: PublishedMessageProgress[] = []): Promise<number[]> {
    const caption = content.text || undefined;
    const messageIds = alreadyPublished.map((item) => item.messageId);
    const sentKeys = new Set(alreadyPublished.map((item) => item.contentKey));
    const assetKeys = new Set(assets.filter((asset) => asset.file_id).map((asset) => asset.id));
    if ([...sentKeys].some((key) => key !== "text" && !assetKeys.has(key)) || (sentKeys.has("text") && assetKeys.size > 0)) {
      throw new PublishError("PUBLISH_PROGRESS_SOURCE_CHANGED", "待续发素材与已发送进度不匹配，任务需人工核对", false);
    }
    for (const asset of assets) {
      if (sentKeys.has(asset.id)) continue;
      if (!asset.file_id) continue;
      const result = asset.media_type === "photo"
        ? await this.client.sendPhoto(chatId, asset.file_id, caption)
        : asset.media_type === "video"
          ? await this.client.sendVideo(chatId, asset.file_id, caption)
          : asset.media_type === "document" || asset.media_type === "animation"
            ? await this.client.sendDocument(chatId, asset.file_id, caption)
            : undefined;
      if (result) {
        messageIds.push(result.message_id);
        await onMessage?.(result.message_id, asset.id);
      }
    }
    if (messageIds.length > 0) return messageIds;
    if (!content.text.trim()) throw new PublishError("EMPTY_PUBLISH_CONTENT", "订单没有可发布的文本或素材", false);
    const messageId = (await this.client.sendMessage(chatId, content.text)).message_id;
    await onMessage?.(messageId, "text");
    return [messageId];
  }

  async publish(chatId: string, content: PublishContent, assets: AssetRow[]): Promise<number> {
    const messageIds = await this.publishMany(chatId, content, assets);
    return messageIds[messageIds.length - 1];
  }
}

export async function processDuePublishTasks(env: PublishRuntimeEnv, now = new Date().toISOString()): Promise<{ processed: number; succeeded: number; retried: number; failed: number; expired: number }> {
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN) return { processed: 0, succeeded: 0, retried: 0, failed: 0, expired: 0 };
  const repository = new D1PublishRepository(env.DB);
  const publisher = new TelegramPublisher(new TelegramBotApiClient(env.TELEGRAM_BOT_TOKEN, fetch, env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org"));
  const result = { processed: 0, succeeded: 0, retried: 0, failed: 0, expired: 0 };
  for (let index = 0; index < 10; index += 1) {
    const task = await repository.claimNextTask(now);
    if (!task) break;
    result.processed += 1;
    let sentMessageCount = 0;
    try {
      const data = await repository.payload(task.id);
      const messageIds = await publisher.publishMany(data.payload.telegram_chat_id, data.content, data.assets, async () => { sentMessageCount += 1; });
      const messageId = messageIds[messageIds.length - 1];
      await repository.markSucceeded(task, messageId, data.payload.telegram_chat_id, now);
      result.succeeded += 1;
    } catch (error) {
      const failure = sentMessageCount > 0
        ? new PublishError("PUBLISH_PARTIAL_SEND", "部分 Telegram 消息已发送但发布未完成；系统停止自动重试，请人工核对频道", false)
        : classifyPublishError(error);
      const outcome = await repository.markFailed(task, failure, now);
      if (outcome.status === "queued") result.retried += 1; else result.failed += 1;
    }
  }
  for (const expiration of await repository.dueExpirations(now)) {
    try {
      await publisher.client.deleteMessage(expiration.telegram_chat_id, expiration.telegram_message_id);
      await repository.markExpired(expiration.order_id, expiration.telegram_chat_id, expiration.telegram_message_id, "succeeded", now);
      result.expired += 1;
    } catch {
      await repository.markExpired(expiration.order_id, expiration.telegram_chat_id, expiration.telegram_message_id, "failed", now);
    }
  }
  return result;
}
