import type { D1Like } from "@tg-ad-manager/telegram";
import { TelegramBotApiClient } from "./channels.js";

export type CustomerNotificationEvent =
  | "order_created"
  | "payment_submitted"
  | "payment_approved"
  | "payment_rejected"
  | "schedule_confirmed"
  | "publish_succeeded"
  | "publish_failed"
  | "ad_expired";

async function first<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T | null> {
  return db.prepare(query).bind(...values).first<T>();
}

function money(minor: number): string {
  return `¥${(Number(minor || 0) / 100).toFixed(2)}`;
}

function eventTitle(event: CustomerNotificationEvent): string {
  return ({
    order_created: "订单已创建",
    payment_submitted: "付款已提交",
    payment_approved: "付款审核通过",
    payment_rejected: "付款审核未通过",
    schedule_confirmed: "排期已确认",
    publish_succeeded: "广告发布成功",
    publish_failed: "广告发布失败",
    ad_expired: "广告已到期",
  })[event];
}

export async function enqueueCustomerNotification(db: D1Like, input: { tenantId: string; workspaceId: string; orderId: string; event: CustomerNotificationEvent; objectId?: string; now?: string; details?: string }): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  try {
    const row = await first<{ order_no: string; total_due_minor: number; scheduled_at?: string; end_at?: string; display_name?: string; telegram_user_id?: string; telegram_username?: string }>(db, `SELECT o.order_no, o.total_due_minor, o.scheduled_at, c.display_name, c.telegram_user_id, c.telegram_username FROM ad_orders o JOIN ad_customers c ON c.id = o.customer_id WHERE o.id = ? AND o.tenant_id = ? AND o.workspace_id = ? LIMIT 1`, input.orderId, input.tenantId, input.workspaceId);
    if (!row) return false;
    const destination = row.telegram_user_id?.trim() || (row.telegram_username?.trim() ? (row.telegram_username.startsWith("@") ? row.telegram_username : `@${row.telegram_username}`) : "");
    if (!destination) return false;
    const objectId = input.objectId ?? input.orderId;
    const key = `${input.event}:${input.orderId}:${objectId}`;
    let message = `${eventTitle(input.event)}\n订单：${row.order_no}`;
    if (input.event === "order_created") message += `\n应付金额：${money(row.total_due_minor)}`;
    if (input.event === "payment_submitted") message += "\n付款信息已提交，等待 Finance 审核。";
    if (input.event === "payment_approved") message += "\n付款已审核通过，运营将继续安排投放。";
    if (input.event === "payment_rejected") message += `\n付款审核未通过${input.details ? `：${input.details}` : "，请联系运营人员。"}`;
    if (input.event === "schedule_confirmed") message += row.scheduled_at ? `\n预计发布时间：${new Date(row.scheduled_at).toLocaleString("zh-CN")}` : "\n发布时间已确认。";
    if (input.event === "publish_succeeded") message += "\n广告已成功发布到目标频道。";
    if (input.event === "publish_failed") message += `\n广告发布遇到问题${input.details ? `：${input.details}` : "，运营人员将尽快处理。"}`;
    if (input.event === "ad_expired") message += "\n本次投放已到期，广告已进入下线处理。";
    await db.prepare(`INSERT INTO customer_notification_outbox (id, tenant_id, workspace_id, order_id, event_type, destination_ref, message, idempotency_key, status, attempts, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?) ON CONFLICT (tenant_id, workspace_id, idempotency_key) DO NOTHING`).bind(crypto.randomUUID(), input.tenantId, input.workspaceId, input.orderId, input.event, destination, message.slice(0, 3900), key, now, now, now).run();
    return true;
  } catch (error) {
    console.warn("customer_notification_enqueue_failed", { event: input.event, orderId: input.orderId, message: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

export async function processCustomerNotificationOutbox(db: D1Like | undefined, token: string | undefined, now = new Date().toISOString()): Promise<{ sent: number; failed: number }> {
  if (!db || !token) return { sent: 0, failed: 0 };
  const statement = db.prepare("SELECT id, destination_ref, message, attempts FROM customer_notification_outbox WHERE status = 'queued' AND available_at <= ? ORDER BY created_at ASC LIMIT 20").bind(now);
  const rows = statement.all ? (await statement.all<{ id: string; destination_ref: string; message: string; attempts: number }>()).results : [];
  const client = new TelegramBotApiClient(token, (input, init) => fetch(input, init));
  const result = { sent: 0, failed: 0 };
  for (const row of rows) {
    await db.prepare("UPDATE customer_notification_outbox SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'").bind(now, row.id).run();
    try {
      await client.sendMessage(row.destination_ref, row.message);
      await db.prepare("UPDATE customer_notification_outbox SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").bind(now, now, row.id).run();
      result.sent += 1;
    } catch (error) {
      const next = new Date(Date.parse(now) + Math.min(3600, 60 * 2 ** Math.min(row.attempts, 6)) * 1000).toISOString();
      await db.prepare("UPDATE customer_notification_outbox SET status = 'queued', available_at = ?, last_error = ?, updated_at = ? WHERE id = ?").bind(next, error instanceof Error ? error.message.slice(0, 500) : "Telegram customer notification failed", now, row.id).run();
      result.failed += 1;
    }
  }
  return result;
}
