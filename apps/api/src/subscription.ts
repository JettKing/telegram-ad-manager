import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./business.js";

export type EntitlementKey = "max_workspaces" | "max_channels" | "monthly_orders" | "monthly_publish_tasks" | "max_members" | "max_media_assets" | "advanced_analytics";
export type BillingPeriod = "monthly" | "yearly" | "lifetime";
export type CheckoutDecision = "approved" | "rejected";

interface PlanRow { id: string; code: string; name: string; billing_period: BillingPeriod; price_minor: number; is_active: number }
interface SubscriptionRow { id: string; plan_id: string; code: string; name: string; billing_period: BillingPeriod; price_minor: number; status: string; current_period_start: string; current_period_end: string; read_only_after_expiry: number }
interface EntitlementRow { entitlement_key: EntitlementKey; limit_value: number | null; enabled: number }
interface UsageRow { entitlement_key: EntitlementKey; used_value: number }

async function all<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T[]> { const prepared = db.prepare(query).bind(...values); return prepared.all ? (await prepared.all<T>()).results : []; }
function periodKey(date = new Date()): string { return date.toISOString().slice(0, 7); }
function periodEnd(period: BillingPeriod, start = new Date()): string { if (period === "lifetime") return "9999-12-31T23:59:59.999Z"; const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + (period === "yearly" ? 12 : 1)); return end.toISOString(); }
function isEntitlementKey(value: unknown): value is EntitlementKey { return ["max_workspaces", "max_channels", "monthly_orders", "monthly_publish_tasks", "max_members", "max_media_assets", "advanced_analytics"].includes(String(value)); }
function isBillingPeriod(value: unknown): value is BillingPeriod { return value === "monthly" || value === "yearly" || value === "lifetime"; }

export function parseCheckoutInput(value: unknown): { planCode: string; billingPeriod: BillingPeriod; idempotencyKey: string } {
  if (!value || typeof value !== "object") throw new BusinessValidationError("INVALID_SUBSCRIPTION_REQUEST", "订阅请求必须是对象");
  const input = value as Record<string, unknown>; const planCode = typeof input.planCode === "string" ? input.planCode.trim().toLowerCase() : ""; const billingPeriod = input.billingPeriod ?? "monthly"; const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(planCode)) throw new BusinessValidationError("INVALID_PLAN_CODE", "planCode 格式不合法");
  if (!isBillingPeriod(billingPeriod)) throw new BusinessValidationError("INVALID_BILLING_PERIOD", "billingPeriod 必须是 monthly、yearly 或 lifetime");
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(idempotencyKey)) throw new BusinessValidationError("INVALID_IDEMPOTENCY_KEY", "idempotencyKey 长度或格式不合法");
  return { planCode, billingPeriod, idempotencyKey };
}

export function parseCheckoutReviewInput(value: unknown): { decision: CheckoutDecision; note?: string } {
  if (!value || typeof value !== "object") throw new BusinessValidationError("INVALID_CHECKOUT_REVIEW", "审核请求必须是对象"); const input = value as Record<string, unknown>; const decision = input.decision; if (decision !== "approved" && decision !== "rejected") throw new BusinessValidationError("INVALID_CHECKOUT_DECISION", "审核结果必须是 approved 或 rejected"); const note = input.note === undefined ? undefined : typeof input.note === "string" ? input.note.trim().slice(0, 500) : ""; return { decision, note };
}

export class SubscriptionRepository {
  constructor(private readonly db: D1Like) {}

  async listPlans(): Promise<PlanRow[]> { return all<PlanRow>(this.db, "SELECT id, code, name, billing_period, price_minor, is_active FROM subscription_plans WHERE is_active = 1 ORDER BY price_minor ASC"); }

  async ensureFreeSubscription(tenantId: string, now = new Date()): Promise<void> {
    const existing = await this.db.prepare("SELECT id, status, current_period_end FROM tenant_subscriptions WHERE tenant_id = ? AND status IN ('trialing', 'active', 'past_due', 'frozen') LIMIT 1").bind(tenantId).first<{ id: string; status: string; current_period_end: string }>();
    if (existing && Date.parse(existing.current_period_end) > now.getTime()) return;
    if (existing) { await this.db.prepare("UPDATE tenant_subscriptions SET plan_id = 'plan-free', status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ? WHERE id = ?").bind(now.toISOString(), periodEnd("monthly", now), now.toISOString(), existing.id).run(); return; }
    await this.db.prepare("INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, read_only_after_expiry, created_at, updated_at) VALUES (?, ?, 'plan-free', 'active', ?, ?, 1, ?, ?)").bind(crypto.randomUUID(), tenantId, now.toISOString(), periodEnd("monthly", now), now.toISOString(), now.toISOString()).run();
  }

  async current(tenantId: string, now = new Date()): Promise<SubscriptionRow | null> {
    return this.db.prepare(`SELECT ts.id, ts.plan_id, sp.code, sp.name, sp.billing_period, sp.price_minor, ts.status, ts.current_period_start, ts.current_period_end, ts.read_only_after_expiry
      FROM tenant_subscriptions ts JOIN subscription_plans sp ON sp.id = ts.plan_id
      WHERE ts.tenant_id = ? AND ts.status IN ('trialing', 'active', 'past_due', 'frozen') AND ts.current_period_end > ? ORDER BY ts.current_period_end DESC LIMIT 1`).bind(tenantId, now.toISOString()).first<SubscriptionRow>();
  }

  async overview(tenantId: string, now = new Date()): Promise<{ subscription: SubscriptionRow | null; plans: PlanRow[]; entitlements: Array<EntitlementRow & { usedValue: number }>; periodKey: string }> {
    const subscription = await this.current(tenantId, now); const plans = await this.listPlans(); if (!subscription) return { subscription: null, plans, entitlements: [], periodKey: periodKey(now) };
    const entitlements = await all<EntitlementRow>(this.db, "SELECT entitlement_key, limit_value, enabled FROM subscription_entitlements WHERE plan_id = ? ORDER BY entitlement_key", subscription.plan_id); const usage = await all<UsageRow>(this.db, "SELECT entitlement_key, used_value FROM subscription_usage WHERE tenant_id = ? AND period_key = ?", tenantId, periodKey(now)); const usageMap = new Map(usage.map((item) => [item.entitlement_key, item.used_value]));
    return { subscription, plans, periodKey: periodKey(now), entitlements: entitlements.map((item) => ({ ...item, usedValue: usageMap.get(item.entitlement_key) ?? 0 })) };
  }

  private async entitlement(tenantId: string, key: EntitlementKey, now: Date): Promise<{ subscription: SubscriptionRow; entitlement: EntitlementRow; period: string }> {
    const subscription = await this.current(tenantId, now); if (!subscription) throw new BusinessValidationError("SUBSCRIPTION_REQUIRED", "租户没有有效订阅");
    const entitlement = await this.db.prepare("SELECT entitlement_key, limit_value, enabled FROM subscription_entitlements WHERE plan_id = ? AND entitlement_key = ? LIMIT 1").bind(subscription.plan_id, key).first<EntitlementRow>();
    if (!entitlement?.enabled) throw new BusinessValidationError("ENTITLEMENT_DISABLED", "当前订阅未启用该权益");
    return { subscription, entitlement, period: key.startsWith("monthly_") ? periodKey(now) : "lifetime" };
  }

  async assertEntitlementAvailable(tenantId: string, key: EntitlementKey, amount = 1, now = new Date()): Promise<{ allowed: true; limit: number | null; used: number }> {
    if (!isEntitlementKey(key) || amount <= 0 || !Number.isSafeInteger(amount)) throw new BusinessValidationError("INVALID_ENTITLEMENT_USAGE", "权益用量参数不合法");
    const { entitlement, period } = await this.entitlement(tenantId, key, now); const row = await this.db.prepare("SELECT used_value FROM subscription_usage WHERE tenant_id = ? AND period_key = ? AND entitlement_key = ?").bind(tenantId, period, key).first<{ used_value: number }>(); const used = row?.used_value ?? 0;
    if (entitlement.limit_value !== null && used + amount > entitlement.limit_value) throw new BusinessValidationError("ENTITLEMENT_LIMIT_REACHED", `已达到 ${key} 的订阅额度`);
    return { allowed: true, limit: entitlement.limit_value, used };
  }

  async recordEntitlementUsage(tenantId: string, key: EntitlementKey, eventKey: string, amount = 1, now = new Date()): Promise<{ allowed: true; limit: number | null; used: number }> {
    if (!eventKey.trim()) throw new BusinessValidationError("INVALID_ENTITLEMENT_EVENT", "权益用量 eventKey 不能为空"); const { entitlement, period } = await this.entitlement(tenantId, key, now); if (entitlement.limit_value === null) return { allowed: true, limit: null, used: 0 };
    const uniqueEventKey = `${tenantId}:${period}:${key}:${eventKey}`; const event = await this.db.prepare("INSERT OR IGNORE INTO subscription_usage_events (id, tenant_id, event_key, period_key, entitlement_key, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), tenantId, uniqueEventKey, period, key, amount, now.toISOString()).run(); if ((event.meta?.changes ?? 0) === 0) { const existingUsage = await this.db.prepare("SELECT used_value FROM subscription_usage WHERE tenant_id = ? AND period_key = ? AND entitlement_key = ?").bind(tenantId, period, key).first<{ used_value: number }>(); return { allowed: true, limit: entitlement.limit_value, used: existingUsage?.used_value ?? 0 }; }
    await this.db.prepare("INSERT OR IGNORE INTO subscription_usage (tenant_id, period_key, entitlement_key, used_value, updated_at) VALUES (?, ?, ?, 0, ?)").bind(tenantId, period, key, now.toISOString()).run(); const updated = await this.db.prepare("UPDATE subscription_usage SET used_value = used_value + ?, updated_at = ? WHERE tenant_id = ? AND period_key = ? AND entitlement_key = ? AND used_value + ? <= ?").bind(amount, now.toISOString(), tenantId, period, key, amount, entitlement.limit_value).run(); if ((updated.meta?.changes ?? 0) === 0) { await this.db.prepare("DELETE FROM subscription_usage_events WHERE event_key = ?").bind(uniqueEventKey).run(); throw new BusinessValidationError("ENTITLEMENT_LIMIT_REACHED", `已达到 ${key} 的订阅额度`); }
    const row = await this.db.prepare("SELECT used_value FROM subscription_usage WHERE tenant_id = ? AND period_key = ? AND entitlement_key = ?").bind(tenantId, period, key).first<{ used_value: number }>(); return { allowed: true, limit: entitlement.limit_value, used: row?.used_value ?? amount };
  }

  async assertResourceLimit(tenantId: string, key: "max_workspaces" | "max_channels" | "max_members" | "max_media_assets", currentCount: number, now = new Date()): Promise<void> {
    const { entitlement } = await this.entitlement(tenantId, key, now); if (entitlement.limit_value !== null && currentCount >= entitlement.limit_value) throw new BusinessValidationError("ENTITLEMENT_LIMIT_REACHED", `已达到 ${key} 的订阅额度`);
  }

  async requireEntitlement(tenantId: string, key: EntitlementKey, amount = 1, now = new Date(), eventKey = crypto.randomUUID()): Promise<{ allowed: true; limit: number | null; used: number } | never> {
    await this.assertEntitlementAvailable(tenantId, key, amount, now); return this.recordEntitlementUsage(tenantId, key, eventKey, amount, now);
  }

  async reviewCheckout(tenantId: string | undefined, requestId: string, reviewerId: string, decision: CheckoutDecision, note: string | undefined, now = new Date()): Promise<{ requestId: string; status: CheckoutDecision; subscriptionId?: string }> {
    const requestQuery = tenantId ? `SELECT r.id, r.tenant_id, r.plan_id, r.amount_minor, r.status, r.billing_period, p.code, p.name, p.price_minor FROM subscription_checkout_requests r JOIN subscription_plans p ON p.id = r.plan_id WHERE r.id = ? AND r.tenant_id = ? LIMIT 1` : `SELECT r.id, r.tenant_id, r.plan_id, r.amount_minor, r.status, r.billing_period, p.code, p.name, p.price_minor FROM subscription_checkout_requests r JOIN subscription_plans p ON p.id = r.plan_id WHERE r.id = ? LIMIT 1`;
    const request = await (tenantId ? this.db.prepare(requestQuery).bind(requestId, tenantId) : this.db.prepare(requestQuery).bind(requestId)).first<{ id: string; tenant_id: string; plan_id: string; amount_minor: number; status: string; billing_period: BillingPeriod; code: string; name: string; price_minor: number }>();
    if (!request) throw new BusinessValidationError("CHECKOUT_REQUEST_NOT_FOUND", "订阅升级请求不存在或不属于当前租户"); if (request.status !== "pending") throw new BusinessValidationError("CHECKOUT_ALREADY_REVIEWED", "订阅升级请求已经处理"); if (decision !== "approved" && decision !== "rejected") throw new BusinessValidationError("INVALID_CHECKOUT_DECISION", "审核结果必须是 approved 或 rejected");
    await this.db.prepare("UPDATE subscription_checkout_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(decision === "approved" ? "paid" : "rejected", reviewerId, now.toISOString(), note ?? null, now.toISOString(), requestId).run();
    if (decision === "rejected") return { requestId, status: decision };
    const current = await this.db.prepare("SELECT id, plan_id, status, current_period_end FROM tenant_subscriptions WHERE tenant_id = ? AND status IN ('trialing', 'active', 'past_due', 'frozen') LIMIT 1").bind(request.tenant_id).first<{ id: string; plan_id: string; status: string; current_period_end: string }>();
    if (current) await this.db.prepare("UPDATE tenant_subscriptions SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now.toISOString(), current.id).run();
    const subscriptionId = crypto.randomUUID(); await this.db.prepare("INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, read_only_after_expiry, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, 1, ?, ?)").bind(subscriptionId, request.tenant_id, request.plan_id, now.toISOString(), periodEnd(request.billing_period, now), now.toISOString(), now.toISOString()).run();
    await this.db.prepare("INSERT INTO subscription_events (id, tenant_subscription_id, event_type, before_json, after_json, actor_admin_id, created_at) VALUES (?, ?, 'checkout_approved', ?, ?, ?, ?)").bind(crypto.randomUUID(), subscriptionId, current ? JSON.stringify(current) : null, JSON.stringify({ planCode: request.code, billingPeriod: request.billing_period, amountMinor: request.amount_minor }), reviewerId, now.toISOString()).run();
    await this.db.prepare("INSERT INTO financial_transactions (id, tenant_id, source_type, source_id, direction, amount_minor, currency, status, occurred_at, created_at) VALUES (?, ?, 'saas_subscription', ?, 'credit', ?, 'CNY', 'confirmed', ?, ?)").bind(crypto.randomUUID(), request.tenant_id, requestId, request.amount_minor, now.toISOString(), now.toISOString()).run();
    return { requestId, status: decision, subscriptionId };
  }

  async processDueSubscriptions(now = new Date()): Promise<{ renewed: number; expired: number }> {
    const due = await all<{ id: string; tenant_id: string; plan_id: string; code: string; billing_period: BillingPeriod; current_period_end: string }>(this.db, `SELECT ts.id, ts.tenant_id, ts.plan_id, sp.code, sp.billing_period, ts.current_period_end FROM tenant_subscriptions ts JOIN subscription_plans sp ON sp.id = ts.plan_id WHERE ts.status IN ('trialing', 'active', 'past_due') AND ts.current_period_end <= ? ORDER BY ts.current_period_end ASC LIMIT 200`, now.toISOString()); const result = { renewed: 0, expired: 0 };
    for (const item of due) { if (item.code === "free") { const nextEnd = periodEnd("monthly", now); await this.db.prepare("UPDATE tenant_subscriptions SET status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ? WHERE id = ? AND status IN ('trialing', 'active', 'past_due')").bind(now.toISOString(), nextEnd, now.toISOString(), item.id).run(); await this.db.prepare("INSERT INTO subscription_events (id, tenant_subscription_id, event_type, before_json, after_json, created_at) VALUES (?, ?, 'auto_renewed', ?, ?, ?)").bind(crypto.randomUUID(), item.id, JSON.stringify(item), JSON.stringify({ currentPeriodEnd: nextEnd }), now.toISOString()).run(); result.renewed += 1; } else { await this.db.prepare("UPDATE tenant_subscriptions SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('trialing', 'active', 'past_due')").bind(now.toISOString(), item.id).run(); await this.db.prepare("INSERT INTO subscription_events (id, tenant_subscription_id, event_type, before_json, after_json, created_at) VALUES (?, ?, 'expired', ?, ?, ?)").bind(crypto.randomUUID(), item.id, JSON.stringify(item), JSON.stringify({ status: "expired" }), now.toISOString()).run(); result.expired += 1; } }
    return result;
  }

  async requestCheckout(tenantId: string, userId: string, input: { planCode: string; billingPeriod: BillingPeriod; idempotencyKey: string }, now = new Date()): Promise<{ requestId: string; status: "pending"; amountMinor: number; currency: string }> {
    const plan = await this.db.prepare("SELECT id, code, price_minor, billing_period, is_active FROM subscription_plans WHERE code = ? AND is_active = 1 LIMIT 1").bind(input.planCode).first<PlanRow>(); if (!plan) throw new BusinessValidationError("PLAN_NOT_FOUND", "订阅计划不存在或已下架"); if (input.planCode === "free") throw new BusinessValidationError("FREE_PLAN_NO_CHECKOUT", "免费计划不需要付费申请"); if (input.billingPeriod !== plan.billing_period) throw new BusinessValidationError("BILLING_PERIOD_UNAVAILABLE", "该计划当前不支持所选计费周期");
    const existing = await this.db.prepare("SELECT id, amount_minor, currency, status FROM subscription_checkout_requests WHERE idempotency_key = ? AND tenant_id = ? LIMIT 1").bind(input.idempotencyKey, tenantId).first<{ id: string; amount_minor: number; currency: string; status: "pending" }>(); if (existing) return { requestId: existing.id, status: "pending", amountMinor: existing.amount_minor, currency: existing.currency };
    const id = crypto.randomUUID(); await this.db.prepare("INSERT INTO subscription_checkout_requests (id, tenant_id, plan_id, billing_period, amount_minor, currency, status, idempotency_key, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'CNY', 'pending', ?, ?, ?, ?)").bind(id, tenantId, plan.id, input.billingPeriod, plan.price_minor, input.idempotencyKey, userId, now.toISOString(), now.toISOString()).run(); return { requestId: id, status: "pending", amountMinor: plan.price_minor, currency: "CNY" };
  }
}
