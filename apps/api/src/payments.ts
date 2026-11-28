import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError, canTransitionOrder, type OrderStatus } from "./business.js";

const allowedPaymentMethods = ["wechat", "alipay", "crypto"] as const;
const allowedRefundMethods = ["wechat", "alipay", "crypto"] as const;

export function assertPaymentMethod(value: string): void {
  if (!allowedPaymentMethods.includes(value as (typeof allowedPaymentMethods)[number])) {
    throw new BusinessValidationError("INVALID_PAYMENT_METHOD", "支付方式仅支持微信、支付宝或数字货币");
  }
}

export function assertRefundMethod(value: string): void {
  if (!allowedRefundMethods.includes(value as (typeof allowedRefundMethods)[number])) {
    throw new BusinessValidationError("INVALID_REFUND_METHOD", "退款申请方式仅支持微信、支付宝或数字货币；未选择时可留空");
  }
}

export type PaymentStatus = "pending_review" | "approved" | "rejected";
export type RefundStatus = "pending_review" | "approved" | "rejected";

export interface PaymentInput {
  method: string;
  amountMinor: number;
  idempotencyKey?: string;
  transactionRef?: string;
  proofAssetId?: string;
}

export interface PaymentReviewInput {
  status: Exclude<PaymentStatus, "pending_review">;
  note?: string;
}

export interface RefundInput {
  amountMinor: number;
  reason: string;
  idempotencyKey?: string;
  method?: string;
  transactionRef?: string;
}

export interface RefundReviewInput {
  status: Exclude<RefundStatus, "pending_review">;
  note?: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(value: unknown, field: string, maxLength: number, required = false): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    if (required) throw new BusinessValidationError(`${field.toUpperCase()}_REQUIRED`, `${field} 不能为空`);
    return undefined;
  }
  return value.trim().slice(0, maxLength);
}

function amount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new BusinessValidationError(`INVALID_${field.toUpperCase()}`, `${field} 必须是大于 0 的整数`);
  return Number(value);
}

export function parsePaymentInput(value: unknown): PaymentInput {
  const input = object(value);
  const method = stringField(input?.method, "payment_method", 50, true)!;
  assertPaymentMethod(method);
  return {
    method,
    amountMinor: amount(input?.amountMinor, "amountMinor"),
    ...(input?.idempotencyKey !== undefined ? { idempotencyKey: stringField(input.idempotencyKey, "idempotency_key", 120, true)! } : {}),
    transactionRef: stringField(input?.transactionRef, "transaction_ref", 255),
    proofAssetId: stringField(input?.proofAssetId, "proof_asset_id", 100),
  };
}

export function parsePaymentReviewInput(value: unknown): PaymentReviewInput {
  const input = object(value);
  const status = input?.status;
  if (status !== "approved" && status !== "rejected") throw new BusinessValidationError("INVALID_PAYMENT_REVIEW_STATUS", "付款审核状态必须是 approved 或 rejected");
  return { status, note: stringField(input?.note, "review_note", 1000) };
}

export function parseRefundInput(value: unknown): RefundInput {
  const input = object(value);
  const method = stringField(input?.method, "refund_method", 50);
  if (method) assertRefundMethod(method);
  return {
    amountMinor: amount(input?.amountMinor, "amountMinor"),
    reason: stringField(input?.reason, "refund_reason", 2000, true)!,
    ...(input?.idempotencyKey !== undefined ? { idempotencyKey: stringField(input.idempotencyKey, "idempotency_key", 120, true)! } : {}),
    ...(method ? { method } : {}),
    transactionRef: stringField(input?.transactionRef, "transaction_ref", 255),
  };
}

export function parseRefundReviewInput(value: unknown): RefundReviewInput {
  const input = object(value);
  const status = input?.status;
  if (status !== "approved" && status !== "rejected") throw new BusinessValidationError("INVALID_REFUND_REVIEW_STATUS", "退款审核状态必须是 approved 或 rejected");
  return { status, note: stringField(input?.note, "review_note", 1000) };
}

interface OrderPaymentContext { id: string; receivable_minor: number; currency: string; currency_scale: number; network?: string | null; payment_status: string; status: OrderStatus }
interface PaymentRow { id: string; order_id: string; method: string; amount_minor: number; currency?: string; amount_scale?: number; network?: string | null; transaction_ref?: string; proof_asset_id?: string; paid_at?: string; status: PaymentStatus; reviewed_by?: string; reviewed_at?: string; review_note?: string; created_at: string }
interface RefundRow { id: string; order_id: string; amount_minor: number; currency?: string; amount_scale?: number; network?: string | null; reason: string; method?: string; transaction_ref?: string; status: RefundStatus; requested_by?: string; reviewed_by?: string; reviewed_at?: string; review_note?: string; created_at: string }

async function all<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T[]> {
  const prepared = db.prepare(query).bind(...values);
  if (!prepared.all) return [];
  return (await prepared.all<T>()).results;
}

export class D1PaymentRepository {
  constructor(private readonly db: D1Like) {}

  private async order(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<OrderPaymentContext> {
    const row = await this.db.prepare("SELECT id, receivable_minor, currency, currency_scale, network, payment_status, status FROM ad_orders WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(orderId, scope.tenantId, scope.workspaceId).first<OrderPaymentContext>();
    if (!row) throw new BusinessValidationError("ORDER_NOT_FOUND", "订单不存在或不属于当前工作空间");
    return row;
  }

  private async approvedOrPendingPayments(orderId: string): Promise<number> {
    const row = await this.db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM ad_order_payments WHERE order_id = ? AND status IN ('pending_review', 'approved')").bind(orderId).first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  private async approvedRefunds(orderId: string): Promise<number> {
    const row = await this.db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM ad_order_refunds WHERE order_id = ? AND status = 'approved'").bind(orderId).first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  private async proofAsset(scope: { tenantId: string; workspaceId: string }, proofAssetId: string | undefined): Promise<void> {
    if (!proofAssetId) return;
    const asset = await this.db.prepare("SELECT id FROM media_assets WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'ready' AND media_type IN ('photo', 'document', 'animation') LIMIT 1").bind(proofAssetId, scope.tenantId, scope.workspaceId).first<{ id: string }>();
    if (!asset) throw new BusinessValidationError("PROOF_ASSET_NOT_READY", "付款凭证素材不存在、不属于当前工作空间或不可用");
  }

  async listPendingPayments(tenantId: string, workspaceId: string): Promise<PaymentRow[]> {
    return all<PaymentRow>(this.db, `SELECT p.id, p.order_id, p.method, p.amount_minor, p.currency, p.amount_scale, p.network, p.transaction_ref, p.proof_asset_id, p.paid_at, p.status, p.reviewed_by, p.reviewed_at, p.review_note, p.created_at
      FROM ad_order_payments p JOIN ad_orders o ON o.id = p.order_id
      WHERE o.tenant_id = ? AND o.workspace_id = ? AND p.status = 'pending_review' ORDER BY p.created_at ASC LIMIT 200`, tenantId, workspaceId);
  }

  async listOrderPayments(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<PaymentRow[]> {
    await this.order(scope, orderId);
    return all<PaymentRow>(this.db, "SELECT id, order_id, method, amount_minor, currency, amount_scale, network, transaction_ref, proof_asset_id, paid_at, status, reviewed_by, reviewed_at, review_note, created_at FROM ad_order_payments WHERE order_id = ? ORDER BY created_at DESC", orderId);
  }

  async createPayment(scope: { tenantId: string; workspaceId: string }, actorUserId: string, orderId: string, input: PaymentInput, now: string): Promise<string> {
    assertPaymentMethod(input.method);
    const order = await this.order(scope, orderId);
    if (!["pending_payment", "pending_review"].includes(order.status)) throw new BusinessValidationError("ORDER_PAYMENT_NOT_OPEN", "当前订单状态不接受付款凭证");
    await this.proofAsset(scope, input.proofAssetId);
    const outstanding = order.receivable_minor - await this.approvedOrPendingPayments(orderId);
    if (input.amountMinor > outstanding) throw new BusinessValidationError("PAYMENT_EXCEEDS_RECEIVABLE", "付款金额超过未核销应收金额");
    const paymentId = crypto.randomUUID();
    await this.db.prepare("INSERT INTO ad_order_payments (id, order_id, method, amount_minor, currency, amount_scale, network, transaction_ref, proof_asset_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)").bind(paymentId, orderId, input.method, input.amountMinor, order.currency, order.currency_scale, order.network ?? null, input.transactionRef ?? null, input.proofAssetId ?? null, now).run();
    await this.db.prepare("UPDATE ad_orders SET payment_status = 'pending_review', updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ?").bind(now, orderId, scope.tenantId, scope.workspaceId).run();
    await this.db.prepare("INSERT INTO ad_order_revisions (id, order_id, actor_user_id, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), orderId, actorUserId, "payment_proof_submitted", JSON.stringify({ paymentStatus: order.payment_status }), JSON.stringify({ paymentStatus: "pending_review", paymentId }), now).run();
    return paymentId;
  }

  async reviewPayment(scope: { tenantId: string; workspaceId: string }, reviewerUserId: string, paymentId: string, input: PaymentReviewInput, now: string): Promise<{ orderId: string; orderPaymentStatus: string; orderStatus: OrderStatus }> {
    const payment = await this.db.prepare("SELECT p.id, p.order_id, p.amount_minor, p.status, o.receivable_minor, o.payment_status, o.status AS order_status FROM ad_order_payments p JOIN ad_orders o ON o.id = p.order_id WHERE p.id = ? AND o.tenant_id = ? AND o.workspace_id = ? LIMIT 1").bind(paymentId, scope.tenantId, scope.workspaceId).first<PaymentRow & { receivable_minor: number; payment_status: string; order_status: OrderStatus }>();
    if (!payment) throw new BusinessValidationError("PAYMENT_NOT_FOUND", "付款记录不存在或不属于当前工作空间");
    if (payment.status !== "pending_review") throw new BusinessValidationError("PAYMENT_ALREADY_REVIEWED", "付款记录已经审核，不能重复处理");
    await this.db.prepare("UPDATE ad_order_payments SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, paid_at = ? WHERE id = ? AND status = 'pending_review'").bind(input.status, reviewerUserId, now, input.note ?? null, input.status === "approved" ? now : null, paymentId).run();
    let orderPaymentStatus = input.status === "rejected" ? "rejected" : "pending_review";
    let orderStatus = payment.order_status;
    if (input.status === "approved") {
      const approvedTotal = await this.db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM ad_order_payments WHERE order_id = ? AND status = 'approved'").bind(payment.order_id).first<{ total: number }>();
      if (Number(approvedTotal?.total ?? 0) >= payment.receivable_minor) {
        orderPaymentStatus = "paid";
        if (canTransitionOrder(payment.order_status, "paid")) orderStatus = "paid";
      }
    }
    await this.db.prepare("UPDATE ad_orders SET payment_status = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ?").bind(orderPaymentStatus, orderStatus, now, payment.order_id, scope.tenantId, scope.workspaceId).run();
    await this.db.prepare("INSERT INTO ad_order_revisions (id, order_id, actor_user_id, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), payment.order_id, reviewerUserId, input.status === "approved" ? "payment_approved" : "payment_rejected", JSON.stringify({ paymentStatus: payment.payment_status, orderStatus: payment.order_status }), JSON.stringify({ paymentStatus: orderPaymentStatus, orderStatus }), now).run();
    return { orderId: payment.order_id, orderPaymentStatus, orderStatus };
  }

  async listOrderRefunds(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<RefundRow[]> {
    await this.order(scope, orderId);
    return all<RefundRow>(this.db, "SELECT id, order_id, amount_minor, reason, method, transaction_ref, status, requested_by, reviewed_by, reviewed_at, review_note, created_at FROM ad_order_refunds WHERE order_id = ? ORDER BY created_at DESC", orderId);
  }

  async listPendingRefunds(tenantId: string, workspaceId: string): Promise<RefundRow[]> {
    return all<RefundRow>(this.db, `SELECT r.id, r.order_id, r.amount_minor, r.reason, r.method, r.transaction_ref, r.status, r.requested_by, r.reviewed_by, r.reviewed_at, r.review_note, r.created_at
      FROM ad_order_refunds r JOIN ad_orders o ON o.id = r.order_id
      WHERE o.tenant_id = ? AND o.workspace_id = ? AND r.status = 'pending_review' ORDER BY r.created_at ASC LIMIT 200`, tenantId, workspaceId);
  }

  async createRefund(scope: { tenantId: string; workspaceId: string }, actorUserId: string, orderId: string, input: RefundInput, now: string): Promise<string> {
    if (input.method) assertRefundMethod(input.method);
    const order = await this.order(scope, orderId);
    if (!["paid", "approved", "scheduled", "published", "completed"].includes(order.status) && !["paid", "partially_refunded"].includes(order.payment_status)) throw new BusinessValidationError("ORDER_REFUND_NOT_OPEN", "当前订单尚未达到可申请退款状态");
    const available = order.receivable_minor - await this.approvedRefunds(orderId);
    if (input.amountMinor > available) throw new BusinessValidationError("REFUND_EXCEEDS_PAID", "退款金额超过可退款金额");
    const refundId = crypto.randomUUID();
    await this.db.prepare("INSERT INTO ad_order_refunds (id, order_id, amount_minor, currency, amount_scale, network, reason, method, transaction_ref, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)").bind(refundId, orderId, input.amountMinor, order.currency, order.currency_scale, order.network ?? null, input.reason, input.method ?? null, input.transactionRef ?? null, actorUserId, now).run();
    await this.db.prepare("INSERT INTO ad_order_revisions (id, order_id, actor_user_id, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), orderId, actorUserId, "refund_requested", JSON.stringify({ paymentStatus: order.payment_status }), JSON.stringify({ refundId, amountMinor: input.amountMinor, status: "pending_review" }), now).run();
    return refundId;
  }

  async reviewRefund(scope: { tenantId: string; workspaceId: string }, reviewerUserId: string, refundId: string, input: RefundReviewInput, now: string): Promise<{ orderId: string; orderPaymentStatus: string; orderStatus: OrderStatus }> {
    const refund = await this.db.prepare("SELECT r.id, r.order_id, r.amount_minor, r.status, o.receivable_minor, o.payment_status, o.status AS order_status FROM ad_order_refunds r JOIN ad_orders o ON o.id = r.order_id WHERE r.id = ? AND o.tenant_id = ? AND o.workspace_id = ? LIMIT 1").bind(refundId, scope.tenantId, scope.workspaceId).first<RefundRow & { receivable_minor: number; payment_status: string; order_status: OrderStatus }>();
    if (!refund) throw new BusinessValidationError("REFUND_NOT_FOUND", "退款记录不存在或不属于当前工作空间");
    if (refund.status !== "pending_review") throw new BusinessValidationError("REFUND_ALREADY_REVIEWED", "退款记录已经审核，不能重复处理");
    await this.db.prepare("UPDATE ad_order_refunds SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND status = 'pending_review'").bind(input.status, reviewerUserId, now, input.note ?? null, refundId).run();
    await this.db.prepare("INSERT INTO ad_order_revisions (id, order_id, actor_user_id, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), refund.order_id, reviewerUserId, input.status === "approved" ? "refund_approved_pending_disbursement" : "refund_rejected", JSON.stringify({ paymentStatus: refund.payment_status, orderStatus: refund.order_status }), JSON.stringify({ paymentStatus: refund.payment_status, orderStatus: refund.order_status, refundStatus: input.status }), now).run();
    return { orderId: refund.order_id, orderPaymentStatus: refund.payment_status, orderStatus: refund.order_status };
  }
}
