import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError, type OrderStatus } from "./business.js";
import { assertPaymentMethod, type PaymentInput, type PaymentReviewInput, type RefundInput, type RefundReviewInput } from "./payments.js";

interface OrderPaymentContext { id: string; receivable_minor: number; currency: string; currency_scale: number; network?: string | null; payment_status: string; status: OrderStatus; customer_id: string }
interface PaymentRow { id: string; order_id: string; method: string; amount_minor: number; currency?: string; amount_scale?: number; network?: string | null; transaction_ref?: string; proof_asset_id?: string; paid_at?: string; status: "pending_review" | "approved" | "rejected"; reviewed_by?: string; reviewed_at?: string; review_note?: string; created_at: string }
interface RefundRow { id: string; order_id: string; payment_submission_id?: string | null; amount_minor: number; currency?: string; amount_scale?: number; network?: string | null; actual_amount_minor?: number | null; reason: string; method?: string; transaction_ref?: string; status: "pending_review" | "approved" | "rejected"; requested_by?: string; reviewed_by?: string; reviewed_at?: string; review_note?: string; disbursed_by?: string; disbursed_at?: string; disbursement_method?: string; disbursement_transaction_ref?: string; disbursement_legacy_inferred?: number; created_at: string }
interface D1Bound { first<T>(): Promise<T | null>; all?<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta?: { changes?: number } }> }
interface BatchResult { meta?: { changes?: number } }

async function all<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T[]> { const prepared = db.prepare(query).bind(...values); return prepared.all ? (await prepared.all<T>()).results : []; }
function refundDisbursementMethod(value: string): string {
  const allowed = ["bank_transfer", "alipay", "wechat", "cash", "crypto", "other"];
  if (!allowed.includes(value)) throw new BusinessValidationError("INVALID_REFUND_DISBURSEMENT_METHOD", "退款出款方式无效");
  return value;
}

export class ProductionPaymentRepository {
  constructor(private readonly db: D1Like) {}

  private async batch(statements: D1Bound[]): Promise<BatchResult[]> {
    if (!this.db.batch) throw new Error("D1_BATCH_NOT_SUPPORTED");
    return this.db.batch(statements as never) as Promise<BatchResult[]>;
  }

  private async order(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<OrderPaymentContext> {
    const row = await this.db.prepare("SELECT id, total_due_minor AS receivable_minor, currency, currency_scale, network, payment_status, status, customer_id FROM ad_orders WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(orderId, scope.tenantId, scope.workspaceId).first<OrderPaymentContext>();
    if (!row) throw new BusinessValidationError("ORDER_NOT_FOUND", "订单不存在或不属于当前工作空间");
    return row;
  }

  private async proofAsset(scope: { tenantId: string; workspaceId: string }, proofAssetId: string | undefined): Promise<void> {
    if (!proofAssetId) return;
    const uploaded = await this.db.prepare("SELECT id FROM payment_proof_uploads WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'ready' LIMIT 1").bind(proofAssetId, scope.tenantId, scope.workspaceId).first<{ id: string }>();
    if (uploaded) return;
    const asset = await this.db.prepare("SELECT id FROM creative_media WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND media_type IN ('photo', 'document', 'animation') LIMIT 1").bind(proofAssetId, scope.tenantId, scope.workspaceId).first<{ id: string }>();
    if (!asset) throw new BusinessValidationError("PROOF_ASSET_NOT_READY", "付款凭证素材不存在、不属于当前工作空间或不可用");
  }

  async listPendingPayments(tenantId: string, workspaceId: string): Promise<PaymentRow[]> {
    return all<PaymentRow>(this.db, `SELECT p.id, p.order_id, p.payment_method AS method, p.amount_minor, p.currency, p.amount_scale, p.network, p.transaction_no AS transaction_ref, p.proof_file_ref AS proof_asset_id, p.paid_at, CASE p.status WHEN 'submitted' THEN 'pending_review' ELSE p.status END AS status, p.reviewed_by, p.reviewed_at, p.review_note, p.created_at FROM payment_submissions p WHERE p.tenant_id = ? AND p.workspace_id = ? AND p.status = 'submitted' ORDER BY p.created_at ASC LIMIT 200`, tenantId, workspaceId);
  }

  async listOrderPayments(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<PaymentRow[]> {
    await this.order(scope, orderId);
    return all<PaymentRow>(this.db, `SELECT id, order_id, payment_method AS method, amount_minor, currency, amount_scale, network, transaction_no AS transaction_ref, proof_file_ref AS proof_asset_id, paid_at, CASE status WHEN 'submitted' THEN 'pending_review' ELSE status END AS status, reviewed_by, reviewed_at, review_note, created_at FROM payment_submissions WHERE tenant_id = ? AND workspace_id = ? AND order_id = ? ORDER BY created_at DESC`, scope.tenantId, scope.workspaceId, orderId);
  }

  async createPayment(scope: { tenantId: string; workspaceId: string }, actorUserId: string, orderId: string, input: PaymentInput, now: string): Promise<string> {
    assertPaymentMethod(input.method);
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) throw new BusinessValidationError("IDEMPOTENCY_KEY_REQUIRED", "付款请求必须包含幂等键");
    const existing = await this.db.prepare("SELECT id, order_id, amount_minor, payment_method, transaction_no, proof_file_ref FROM payment_submissions WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, idempotencyKey).first<{ id: string; order_id: string; amount_minor: number; payment_method: string; transaction_no?: string; proof_file_ref?: string }>();
    if (existing) {
      const sameRequest = existing.order_id === orderId && existing.amount_minor === input.amountMinor && existing.payment_method === input.method && (existing.transaction_no ?? undefined) === input.transactionRef && (existing.proof_file_ref ?? undefined) === input.proofAssetId;
      if (!sameRequest) throw new BusinessValidationError("IDEMPOTENCY_KEY_CONFLICT", "该付款幂等键已用于不同请求，请刷新后重新发起");
      return existing.id;
    }
    const order = await this.order(scope, orderId);
    if (!["pending_payment", "pending_review"].includes(order.status)) throw new BusinessValidationError("ORDER_PAYMENT_NOT_OPEN", "当前订单状态不接受付款凭证");
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new BusinessValidationError("INVALID_PAYMENT_AMOUNT", "付款金额必须是对应资产精度下的大于 0 的原子单位整数");
    await this.proofAsset(scope, input.proofAssetId);
    if (input.transactionRef) {
      // The production unique index reserves a non-empty transaction number for every
      // row, including rejected submissions. Match that constraint before attempting INSERT.
      const duplicate = await this.db.prepare("SELECT id FROM payment_submissions WHERE tenant_id = ? AND workspace_id = ? AND transaction_no = ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, input.transactionRef).first<{ id: string }>();
      if (duplicate) throw new BusinessValidationError("DUPLICATE_TRANSACTION_REF", "交易号已被当前工作空间的其他付款记录使用");
    }

    const id = crypto.randomUUID();
    // Keep the balance check in the same SQL statement as the insert. Concurrent
    // submissions cannot both reserve the same remaining receivable.
    const insert = this.db.prepare(`INSERT INTO payment_submissions (id, tenant_id, workspace_id, order_id, customer_id, amount_minor, currency, amount_scale, network, payment_method, transaction_no, proof_file_ref, paid_at, note, status, idempotency_key, created_at, updated_at)
      SELECT ?, ?, ?, o.id, o.customer_id, ?, o.currency, o.currency_scale, o.network, ?, ?, ?, NULL, ?, 'submitted', ?, ?, ? FROM ad_orders o
      WHERE o.id = ? AND o.tenant_id = ? AND o.workspace_id = ? AND o.status IN ('pending_payment', 'pending_review')
        AND ? <= o.total_due_minor - COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.tenant_id = ? AND p.workspace_id = ? AND p.order_id = o.id AND p.status IN ('submitted', 'approved')), 0)`)
      .bind(id, scope.tenantId, scope.workspaceId, input.amountMinor, input.method, input.transactionRef ?? null, input.proofAssetId ?? null, null, idempotencyKey, now, now, orderId, scope.tenantId, scope.workspaceId, input.amountMinor, scope.tenantId, scope.workspaceId);
    const updateOrder = this.db.prepare(`UPDATE ad_orders SET payment_status = 'pending_payment', updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ?
      AND EXISTS (SELECT 1 FROM payment_submissions p WHERE p.id = ? AND p.tenant_id = ? AND p.workspace_id = ? AND p.status = 'submitted')`)
      .bind(now, orderId, scope.tenantId, scope.workspaceId, id, scope.tenantId, scope.workspaceId);
    let inserted: BatchResult[];
    try { inserted = await this.batch([insert, updateOrder]); }
    catch (error) {
      const replay = await this.db.prepare("SELECT id, order_id, amount_minor, payment_method, transaction_no, proof_file_ref FROM payment_submissions WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, idempotencyKey).first<{ id: string; order_id: string; amount_minor: number; payment_method: string; transaction_no?: string; proof_file_ref?: string }>();
      if (replay) {
        const sameRequest = replay.order_id === orderId && replay.amount_minor === input.amountMinor && replay.payment_method === input.method && (replay.transaction_no ?? undefined) === input.transactionRef && (replay.proof_file_ref ?? undefined) === input.proofAssetId;
        if (sameRequest) return replay.id;
        throw new BusinessValidationError("IDEMPOTENCY_KEY_CONFLICT", "该付款幂等键已用于不同请求，请刷新后重新发起");
      }
      if (input.transactionRef && error instanceof Error && /transaction_unique|payment_submissions\.tenant_id/i.test(error.message)) throw new BusinessValidationError("DUPLICATE_TRANSACTION_REF", "交易号已被当前工作空间的其他付款记录使用");
      throw error;
    }
    if ((inserted[0]?.meta?.changes ?? 0) === 0) {
      const current = await this.order(scope, orderId);
      if (!["pending_payment", "pending_review"].includes(current.status)) throw new BusinessValidationError("ORDER_PAYMENT_NOT_OPEN", "当前订单状态不接受付款凭证");
      throw new BusinessValidationError("PAYMENT_EXCEEDS_RECEIVABLE", "付款金额超过未核销应收金额");
    }
    void actorUserId;
    return id;
  }

  async reviewPayment(scope: { tenantId: string; workspaceId: string }, reviewerUserId: string, paymentId: string, input: PaymentReviewInput, now: string): Promise<{ orderId: string; orderPaymentStatus: string; orderStatus: OrderStatus }> {
    const payment = await this.db.prepare(`SELECT p.id, p.order_id, p.amount_minor, CASE p.status WHEN 'submitted' THEN 'pending_review' ELSE p.status END AS status, o.total_due_minor AS receivable_minor, o.payment_status, o.status AS order_status FROM payment_submissions p JOIN ad_orders o ON o.id = p.order_id WHERE p.id = ? AND p.tenant_id = ? AND p.workspace_id = ? LIMIT 1`).bind(paymentId, scope.tenantId, scope.workspaceId).first<PaymentRow & { receivable_minor: number; payment_status: string; order_status: OrderStatus }>();
    if (!payment) throw new BusinessValidationError("PAYMENT_NOT_FOUND", "付款记录不存在或不属于当前工作空间");
    if (payment.status !== "pending_review") throw new BusinessValidationError("PAYMENT_ALREADY_REVIEWED", "付款记录已经审核，不能重复处理");
    if (input.status === "rejected" && !input.note?.trim()) throw new BusinessValidationError("PAYMENT_REVIEW_NOTE_REQUIRED", "驳回付款必须填写原因");

    const status = input.status;
    const dbStatus = status === "approved" ? "approved" : "rejected";
    const statements: D1Bound[] = [
      this.db.prepare("UPDATE payment_submissions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, paid_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'submitted'").bind(dbStatus, reviewerUserId, now, input.note ?? null, status === "approved" ? now : null, now, paymentId, scope.tenantId, scope.workspaceId),
    ];
    if (status === "approved") {
      statements.push(this.db.prepare(`INSERT OR IGNORE INTO financial_ledger_entries (id, tenant_id, workspace_id, order_id, payment_submission_id, entry_type, direction, amount_minor, currency, amount_scale, network, reason, actor_user_id, created_at)
        SELECT ?, ?, ?, p.order_id, p.id, 'payment', 'credit', p.amount_minor, p.currency, p.amount_scale, p.network, 'payment_submission_approved', ?, ? FROM payment_submissions p
        WHERE p.id = ? AND p.tenant_id = ? AND p.workspace_id = ? AND p.status = 'approved' AND p.reviewed_by = ? AND p.reviewed_at = ?
          AND NOT EXISTS (SELECT 1 FROM financial_ledger_entries l WHERE l.payment_submission_id = p.id AND l.entry_type = 'payment')`)
        .bind(`payment:${paymentId}`, scope.tenantId, scope.workspaceId, reviewerUserId, now, paymentId, scope.tenantId, scope.workspaceId, reviewerUserId, now));
    }
    statements.push(this.db.prepare(`UPDATE ad_orders SET
        payment_status = CASE
          WHEN COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'approved'), 0) - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0), 0) <= 0
            AND EXISTS (SELECT 1 FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0) THEN 'refunded'
          WHEN COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'approved'), 0) - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0), 0) >= total_due_minor THEN 'paid'
          WHEN EXISTS (SELECT 1 FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0) THEN 'partially_refunded'
          WHEN COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'approved'), 0) > 0 THEN 'partially_paid'
          WHEN EXISTS (SELECT 1 FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'submitted') THEN 'pending_payment'
          ELSE 'unpaid' END,
        status = CASE WHEN COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'approved'), 0) - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0), 0) >= total_due_minor AND status IN ('pending_payment', 'pending_review') THEN 'paid' ELSE status END,
        updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ?`)
      .bind(now, payment.order_id, scope.tenantId, scope.workspaceId));

    const results = await this.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) === 0) throw new BusinessValidationError("PAYMENT_ALREADY_REVIEWED", "付款记录已经审核，不能重复处理");
    const updatedOrder = await this.db.prepare("SELECT payment_status AS orderPaymentStatus, status AS orderStatus FROM ad_orders WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(payment.order_id, scope.tenantId, scope.workspaceId).first<{ orderPaymentStatus: string; orderStatus: OrderStatus }>();
    if (!updatedOrder) throw new BusinessValidationError("ORDER_NOT_FOUND", "订单不存在或不属于当前工作空间");
    return { orderId: payment.order_id, orderPaymentStatus: updatedOrder.orderPaymentStatus, orderStatus: updatedOrder.orderStatus };
  }

  async listOrderRefunds(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<RefundRow[]> {
    await this.order(scope, orderId);
    return all<RefundRow>(this.db, "SELECT id, order_id, payment_submission_id, amount_minor, currency, amount_scale, network, actual_amount_minor, reason, method, transaction_ref, status, requested_by, reviewed_by, reviewed_at, review_note, disbursed_by, disbursed_at, disbursement_method, disbursement_transaction_ref, disbursement_legacy_inferred, created_at FROM ad_order_refunds WHERE tenant_id = ? AND workspace_id = ? AND order_id = ? ORDER BY created_at DESC", scope.tenantId, scope.workspaceId, orderId);
  }

  async listPendingRefunds(tenantId: string, workspaceId: string): Promise<RefundRow[]> {
    return all<RefundRow>(this.db, "SELECT id, order_id, payment_submission_id, amount_minor, currency, amount_scale, network, actual_amount_minor, reason, method, transaction_ref, status, requested_by, reviewed_by, reviewed_at, review_note, disbursed_by, disbursed_at, disbursement_method, disbursement_transaction_ref, disbursement_legacy_inferred, created_at FROM ad_order_refunds WHERE tenant_id = ? AND workspace_id = ? AND (status = 'pending_review' OR (status = 'approved' AND disbursed_at IS NULL) OR disbursement_legacy_inferred = 1) ORDER BY created_at ASC LIMIT 200", tenantId, workspaceId);
  }

  async createRefund(scope: { tenantId: string; workspaceId: string }, actorUserId: string, orderId: string, input: RefundInput, now: string): Promise<string> {
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) throw new BusinessValidationError("IDEMPOTENCY_KEY_REQUIRED", "退款请求必须包含幂等键");
    const existing = await this.db.prepare("SELECT id, order_id, amount_minor, reason, method, transaction_ref FROM ad_order_refunds WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, idempotencyKey).first<{ id: string; order_id: string; amount_minor: number; reason: string; method?: string; transaction_ref?: string }>();
    if (existing) {
      const sameRequest = existing.order_id === orderId && existing.amount_minor === input.amountMinor && existing.reason === input.reason && (existing.method ?? undefined) === input.method && (existing.transaction_ref ?? undefined) === input.transactionRef;
      if (!sameRequest) throw new BusinessValidationError("IDEMPOTENCY_KEY_CONFLICT", "该退款幂等键已用于不同请求，请刷新后重新发起");
      return existing.id;
    }
    await this.order(scope, orderId);
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new BusinessValidationError("INVALID_REFUND_AMOUNT", "退款金额必须大于 0");
    const id = crypto.randomUUID();
    // Pending requests reserve funds as well as approved refunds. This single
    // INSERT...SELECT is the atomic reservation point under concurrent requests.
    let result: { meta?: { changes?: number } };
    try { result = await this.db.prepare(`WITH source_payment AS (
        SELECT p.id FROM payment_submissions p
        WHERE p.order_id = ? AND p.tenant_id = ? AND p.workspace_id = ? AND p.status = 'approved'
          AND p.currency = (SELECT o.currency FROM ad_orders o WHERE o.id = p.order_id)
          AND p.amount_scale = (SELECT o.currency_scale FROM ad_orders o WHERE o.id = p.order_id)
          AND p.network IS (SELECT o.network FROM ad_orders o WHERE o.id = p.order_id)
          AND ? <= p.amount_minor
            - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.payment_submission_id = p.id AND r.status IN ('pending_review', 'approved')), 0)
            - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.order_id = p.order_id AND r.payment_submission_id IS NULL AND r.status IN ('pending_review', 'approved')), 0)
        ORDER BY p.created_at, p.id LIMIT 1
      )
      INSERT INTO ad_order_refunds (id, tenant_id, workspace_id, order_id, payment_submission_id, amount_minor, currency, amount_scale, network, reason, method, transaction_ref, idempotency_key, status, requested_by, created_at, updated_at)
      SELECT ?, ?, ?, o.id, (SELECT id FROM source_payment), ?, o.currency, o.currency_scale, o.network, ?, ?, ?, ?, 'pending_review', ?, ?, ? FROM ad_orders o
      WHERE o.id = ? AND o.tenant_id = ? AND o.workspace_id = ? AND EXISTS (SELECT 1 FROM source_payment)
        AND ? <= COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.tenant_id = ? AND p.workspace_id = ? AND p.order_id = o.id AND p.status = 'approved'), 0)
          - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.tenant_id = ? AND r.workspace_id = ? AND r.order_id = o.id AND r.status IN ('pending_review', 'approved')), 0)`)
      .bind(orderId, scope.tenantId, scope.workspaceId, input.amountMinor, id, scope.tenantId, scope.workspaceId, input.amountMinor, input.reason, input.method ?? null, input.transactionRef ?? null, idempotencyKey, actorUserId, now, now, orderId, scope.tenantId, scope.workspaceId, input.amountMinor, scope.tenantId, scope.workspaceId, scope.tenantId, scope.workspaceId).run(); }
    catch (error) {
      const replay = await this.db.prepare("SELECT id, order_id, amount_minor, reason, method, transaction_ref FROM ad_order_refunds WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, idempotencyKey).first<{ id: string; order_id: string; amount_minor: number; reason: string; method?: string; transaction_ref?: string }>();
      if (replay && replay.order_id === orderId && replay.amount_minor === input.amountMinor && replay.reason === input.reason && (replay.method ?? undefined) === input.method && (replay.transaction_ref ?? undefined) === input.transactionRef) return replay.id;
      if (replay) throw new BusinessValidationError("IDEMPOTENCY_KEY_CONFLICT", "该退款幂等键已用于不同请求，请刷新后重新发起");
      throw error;
    }
    if ((result.meta?.changes ?? 0) === 0) throw new BusinessValidationError("REFUND_EXCEEDS_PAID", "退款金额超过可退余额，或没有单笔已审核原始收款可覆盖；可将退款拆分为多个申请");
    return id;
  }

  async reviewRefund(scope: { tenantId: string; workspaceId: string }, reviewerUserId: string, refundId: string, input: RefundReviewInput, now: string): Promise<{ orderId: string; status: string }> {
    const refund = await this.db.prepare("SELECT id, order_id, amount_minor, status FROM ad_order_refunds WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(refundId, scope.tenantId, scope.workspaceId).first<RefundRow>();
    if (!refund) throw new BusinessValidationError("REFUND_NOT_FOUND", "退款申请不存在或不属于当前工作空间");
    if (refund.status !== "pending_review") throw new BusinessValidationError("REFUND_ALREADY_REVIEWED", "退款申请已经审核，不能重复处理");
    if (input.status === "rejected" && !input.note?.trim()) throw new BusinessValidationError("REFUND_REVIEW_NOTE_REQUIRED", "驳回退款必须填写原因");
    const status = input.status === "approved" ? "approved" : "rejected";
    const results = await this.batch([this.db.prepare("UPDATE ad_order_refunds SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'pending_review'").bind(status, reviewerUserId, now, input.note ?? null, now, refundId, scope.tenantId, scope.workspaceId)]);
    if ((results[0]?.meta?.changes ?? 0) === 0) throw new BusinessValidationError("REFUND_ALREADY_REVIEWED", "退款申请已经审核，不能重复处理");
    return { orderId: refund.order_id, status };
  }

  async disburseRefund(scope: { tenantId: string; workspaceId: string }, actorUserId: string, refundId: string, input: { method?: string; transactionRef?: string; actualAmountMinor: number }, now: string): Promise<{ orderId: string; status: string }> {
    const method = refundDisbursementMethod(input.method ?? "bank_transfer");
    if (["bank_transfer", "alipay", "wechat", "crypto"].includes(method) && !input.transactionRef?.trim()) throw new BusinessValidationError("REFUND_DISBURSEMENT_REF_REQUIRED", "银行或电子支付实际出款必须填写转账流水号");
    const refund = await this.db.prepare("SELECT id, order_id, amount_minor, currency, amount_scale, network, status, disbursed_at, disbursement_legacy_inferred FROM ad_order_refunds WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(refundId, scope.tenantId, scope.workspaceId).first<RefundRow>();
    if (!refund) throw new BusinessValidationError("REFUND_NOT_FOUND", "退款申请不存在或不属于当前工作空间");
    if (refund.disbursement_legacy_inferred === 1) throw new BusinessValidationError("REFUND_LEGACY_RECONCILIATION_REQUIRED", "这是迁移前的历史退款，必须先人工核对银行流水，不能直接登记或重复出款");
    if (refund.status !== "approved" || refund.disbursed_at) throw new BusinessValidationError("REFUND_NOT_READY_FOR_DISBURSEMENT", "仅可登记已批准且尚未实际退款的申请");
    const actualAmountMinor = input.actualAmountMinor;
    if (!Number.isSafeInteger(actualAmountMinor) || actualAmountMinor <= 0 || actualAmountMinor !== refund.amount_minor) throw new BusinessValidationError("REFUND_ACTUAL_AMOUNT_MISMATCH", "实际退回数量必须与已批准的退款数量完全一致；如金额不同，请驳回原申请并按实际金额重新申请、审批");
    const transactionRef = input.transactionRef?.trim();
    if (transactionRef) {
      const duplicate = await this.db.prepare("SELECT id FROM ad_order_refunds WHERE tenant_id = ? AND workspace_id = ? AND disbursement_transaction_ref = ? AND id <> ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, transactionRef, refundId).first<{ id: string }>();
      if (duplicate) throw new BusinessValidationError("DUPLICATE_TRANSACTION_REF", "该出款流水号已用于其他退款记录");
    }
    const statements: D1Bound[] = [
      this.db.prepare("UPDATE ad_order_refunds SET actual_amount_minor = ?, actual_currency = currency, actual_network = network, disbursed_by = ?, disbursed_at = ?, disbursement_method = ?, disbursement_transaction_ref = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'approved' AND disbursed_at IS NULL").bind(actualAmountMinor, actorUserId, now, method, transactionRef || null, now, refundId, scope.tenantId, scope.workspaceId),
      this.db.prepare(`INSERT OR IGNORE INTO financial_ledger_entries (id, tenant_id, workspace_id, order_id, payment_submission_id, entry_type, direction, amount_minor, currency, amount_scale, network, reason, actor_user_id, created_at)
        SELECT ?, ?, ?, r.order_id, r.payment_submission_id, 'refund', 'debit', r.actual_amount_minor, r.actual_currency, r.amount_scale, r.actual_network, 'refund_disbursed', ?, ? FROM ad_order_refunds r
        WHERE r.id = ? AND r.tenant_id = ? AND r.workspace_id = ? AND r.status = 'approved' AND r.disbursed_by = ? AND r.disbursed_at = ?`)
        .bind(`refund:${refundId}:disbursed`, scope.tenantId, scope.workspaceId, actorUserId, now, refundId, scope.tenantId, scope.workspaceId, actorUserId, now),
      this.db.prepare(`UPDATE ad_orders SET payment_status = CASE
          WHEN COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'approved'), 0) - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0), 0) <= 0 THEN 'refunded'
          WHEN COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'approved'), 0) - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0), 0) >= total_due_minor THEN 'paid'
          WHEN EXISTS (SELECT 1 FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0) THEN 'partially_refunded'
          WHEN COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'approved'), 0) > 0 THEN 'partially_paid' ELSE 'unpaid' END,
        status = CASE WHEN COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = ad_orders.id AND p.status = 'approved'), 0) - COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.order_id = ad_orders.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0), 0) <= 0 THEN 'refunded' ELSE 'partially_refunded' END,
        updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND EXISTS (SELECT 1 FROM ad_order_refunds r WHERE r.id = ? AND r.status = 'approved' AND r.disbursed_by = ? AND r.disbursed_at = ?)`)
        .bind(now, refund.order_id, scope.tenantId, scope.workspaceId, refundId, actorUserId, now),
    ];
    let results: BatchResult[];
    try { results = await this.batch(statements); }
    catch (error) {
      if (transactionRef && error instanceof Error && /idx_order_refunds_disbursement_ref_unique|ad_order_refunds\.disbursement_transaction_ref/i.test(error.message)) {
        throw new BusinessValidationError("DUPLICATE_TRANSACTION_REF", "该出款流水号已用于其他退款记录");
      }
      throw error;
    }
    if ((results[0]?.meta?.changes ?? 0) === 0) throw new BusinessValidationError("REFUND_NOT_READY_FOR_DISBURSEMENT", "退款状态已变化或已被登记，请刷新后确认");
    return { orderId: refund.order_id, status: "disbursed" };
  }

  async reconciliation(tenantId: string, workspaceId: string): Promise<Array<Record<string, unknown>>> {
    return all<Record<string, unknown>>(this.db, `SELECT o.id AS orderId, o.order_no AS orderNo, o.total_due_minor AS dueMinor, o.currency, o.currency_scale AS amountScale, o.network, COALESCE((SELECT SUM(p.amount_minor) FROM payment_submissions p WHERE p.order_id = o.id AND p.status = 'approved' AND p.currency = o.currency AND p.network IS o.network), 0) AS approvedPaymentMinor, COALESCE((SELECT SUM(r.actual_amount_minor) FROM ad_order_refunds r WHERE r.order_id = o.id AND r.status = 'approved' AND r.disbursed_at IS NOT NULL AND r.disbursement_legacy_inferred = 0 AND r.actual_currency = o.currency AND r.actual_network IS o.network), 0) AS disbursedRefundMinor, COALESCE((SELECT SUM(r.amount_minor) FROM ad_order_refunds r WHERE r.order_id = o.id AND r.status = 'approved' AND r.disbursement_legacy_inferred = 1), 0) AS legacyRefundMinor, o.payment_status AS paymentStatus, o.status FROM ad_orders o WHERE o.tenant_id = ? AND o.workspace_id = ? ORDER BY o.updated_at DESC LIMIT 500`, tenantId, workspaceId);
  }

  async timeline(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<Array<Record<string, unknown>>> {
    await this.order(scope, orderId);
    const events = await all<Record<string, unknown>>(this.db, "SELECT created_at AS createdAt, action AS type, object_type AS objectType, object_id AS objectId, after_summary AS details FROM audit_logs WHERE tenant_id = ? AND workspace_id = ? AND object_id = ?", scope.tenantId, scope.workspaceId, orderId);
    const payments = await all<Record<string, unknown>>(this.db, "SELECT created_at AS createdAt, 'payment' AS type, id AS objectId, status, amount_minor AS amountMinor, currency, amount_scale AS amountScale, network, transaction_no AS transactionRef FROM payment_submissions WHERE tenant_id = ? AND workspace_id = ? AND order_id = ?", scope.tenantId, scope.workspaceId, orderId);
    const refunds = await all<Record<string, unknown>>(this.db, "SELECT COALESCE(r.disbursed_at, r.created_at) AS createdAt, 'refund' AS type, r.id AS objectId, r.payment_submission_id AS paymentSubmissionId, r.status, COALESCE(r.actual_amount_minor, r.amount_minor) AS amountMinor, r.currency, r.amount_scale AS amountScale, COALESCE(r.actual_network, r.network) AS network, r.reason, r.disbursed_at AS disbursedAt, u.display_name AS disbursedBy, r.disbursement_method AS disbursementMethod, r.disbursement_transaction_ref AS disbursementTransactionRef, r.disbursement_legacy_inferred AS disbursementLegacyInferred FROM ad_order_refunds r LEFT JOIN users u ON u.id = r.disbursed_by WHERE r.tenant_id = ? AND r.workspace_id = ? AND r.order_id = ?", scope.tenantId, scope.workspaceId, orderId);
    const ledger = await all<Record<string, unknown>>(this.db, "SELECT created_at AS createdAt, 'ledger' AS type, id AS objectId, entry_type AS entryType, direction, amount_minor AS amountMinor, currency, amount_scale AS amountScale, network, reason FROM financial_ledger_entries WHERE tenant_id = ? AND workspace_id = ? AND order_id = ?", scope.tenantId, scope.workspaceId, orderId);
    return [...events, ...payments, ...refunds, ...ledger].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
}
