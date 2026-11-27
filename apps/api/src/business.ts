import type { D1Like } from "@tg-ad-manager/telegram";
import { resolveAsset, type AssetCode } from "./money.js";
import { BusinessValidationError } from "./errors.js";
export { BusinessValidationError } from "./errors.js";

export type CustomerStatus = "new" | "normal" | "long_term" | "vip" | "potential" | "risk" | "inactive";
export type OrderStatus = "draft" | "pending_payment" | "paid" | "pending_review" | "approved" | "scheduled" | "publishing" | "published" | "completed" | "cancelled" | "refunded" | "partially_refunded" | "failed";

export interface OrderContent {
  text: string;
  assetIds: string[];
  entities: unknown[];
}

export interface CustomerInput {
  name: string;
  contact?: string;
  telegramUserId?: string;
  telegramUsername?: string;
  source?: string;
  notes?: string;
  status?: CustomerStatus;
}

export interface PackageInput {
  name: string;
  description?: string;
  adType: string;
  publishCount?: number;
  displayDurationSeconds?: number;
  pinDurationSeconds?: number;
  publishIntervalSeconds?: number;
  priceMinor: number;
  currency: AssetCode;
  currencyScale: number;
  network: string | null;
  discountPriceMinor?: number;
  autoUnpin?: boolean;
  attemptAutoDelete?: boolean;
  deleteFailurePolicy?: "ignore" | "notify" | "manual";
  isPublic?: boolean;
}

export interface CreateOrderInput {
  customerId: string;
  channelId: string;
  packageId: string;
  discountMinor?: number;
  content: unknown;
}

const customerStatuses = new Set<CustomerStatus>(["new", "normal", "long_term", "vip", "potential", "risk", "inactive"]);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maxLength) : undefined;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new BusinessValidationError("INVALID_" + field.toUpperCase(), `${field} 必须是大于等于 ${minimum} 的整数`);
  return Number(value);
}

export function parseCustomerInput(value: unknown): CustomerInput {
  const input = object(value);
  const name = optionalString(input?.name, 120);
  if (!name) throw new BusinessValidationError("CUSTOMER_NAME_REQUIRED", "客户名称不能为空");
  const status = input?.status === undefined ? "new" : input.status;
  if (typeof status !== "string" || !customerStatuses.has(status as CustomerStatus)) throw new BusinessValidationError("INVALID_CUSTOMER_STATUS", "客户状态不合法");
  return { name, contact: optionalString(input?.contact, 255), telegramUserId: optionalString(input?.telegramUserId, 64), telegramUsername: optionalString(input?.telegramUsername, 120), source: optionalString(input?.source, 80), notes: optionalString(input?.notes, 2000), status: status as CustomerStatus };
}

export function parsePackageInput(value: unknown): PackageInput {
  const input = object(value);
  const name = optionalString(input?.name, 120);
  const adType = optionalString(input?.adType, 50);
  if (!name || !adType) throw new BusinessValidationError("PACKAGE_FIELDS_REQUIRED", "套餐名称和广告类型不能为空");
  const priceMinor = integer(input?.priceMinor, "priceMinor");
  const asset = resolveAsset(input?.currency ?? "CNY", input?.network);
  const discountPriceMinor = input?.discountPriceMinor === undefined ? undefined : integer(input.discountPriceMinor, "discountPriceMinor");
  if (discountPriceMinor !== undefined && discountPriceMinor > priceMinor) throw new BusinessValidationError("INVALID_PACKAGE_DISCOUNT", "折扣价不能高于原价");
  const publishCount = input?.publishCount === undefined ? 1 : integer(input.publishCount, "publishCount", 1);
  const deleteFailurePolicy = input?.deleteFailurePolicy === undefined ? "manual" : input.deleteFailurePolicy;
  if (deleteFailurePolicy !== "ignore" && deleteFailurePolicy !== "notify" && deleteFailurePolicy !== "manual") throw new BusinessValidationError("INVALID_DELETE_FAILURE_POLICY", "删除失败策略不合法");
  return {
    name,
    description: optionalString(input?.description, 2000),
    adType,
    publishCount,
    displayDurationSeconds: input?.displayDurationSeconds === undefined ? undefined : integer(input.displayDurationSeconds, "displayDurationSeconds"),
    pinDurationSeconds: input?.pinDurationSeconds === undefined ? undefined : integer(input.pinDurationSeconds, "pinDurationSeconds"),
    publishIntervalSeconds: input?.publishIntervalSeconds === undefined ? undefined : integer(input.publishIntervalSeconds, "publishIntervalSeconds"),
    priceMinor,
    currency: asset.currency,
    currencyScale: asset.scale,
    network: asset.network,
    discountPriceMinor,
    autoUnpin: input?.autoUnpin === true,
    attemptAutoDelete: input?.attemptAutoDelete === true,
    deleteFailurePolicy,
    isPublic: input?.isPublic === true,
  };
}

export function parseOrderContent(value: unknown): OrderContent {
  const input = object(value);
  const text = typeof input?.text === "string" ? input.text : "";
  if (text.length > 4096) throw new BusinessValidationError("CONTENT_TEXT_TOO_LONG", "广告文本不能超过 4096 个字符");
  const rawAssetIds = input?.assetIds === undefined ? [] : input.assetIds;
  if (!Array.isArray(rawAssetIds) || rawAssetIds.some((id) => typeof id !== "string" || id.length > 100)) throw new BusinessValidationError("INVALID_CONTENT_ASSETS", "素材引用必须是字符串 ID 数组");
  const assetIds = [...new Set(rawAssetIds)] as string[];
  if (assetIds.length > 20) throw new BusinessValidationError("TOO_MANY_CONTENT_ASSETS", "单条广告最多引用 20 个素材");
  const entities = Array.isArray(input?.entities) ? input.entities.slice(0, 100) : [];
  return { text, assetIds, entities };
}

const transitions: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  draft: new Set(["pending_payment", "cancelled"]),
  pending_payment: new Set(["paid", "pending_review", "cancelled"]),
  paid: new Set(["approved", "refunded", "partially_refunded", "cancelled"]),
  pending_review: new Set(["approved", "cancelled"]),
  approved: new Set(["scheduled", "cancelled"]),
  scheduled: new Set(["publishing", "cancelled"]),
  publishing: new Set(["published", "failed"]),
  published: new Set(["completed", "failed"]),
  completed: new Set(["refunded", "partially_refunded"]),
  cancelled: new Set(),
  refunded: new Set(),
  partially_refunded: new Set(),
  failed: new Set(["scheduled", "cancelled"]),
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from]?.has(to) ?? false;
}

function orderNumber(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `TG-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

interface CustomerRow { id: string; name: string; contact?: string; telegram_user_id?: string; telegram_username?: string; source?: string; notes?: string; status: CustomerStatus; total_spend_minor: number; last_order_at?: string; created_at: string; updated_at: string }
interface PackageRow { id: string; name: string; description?: string; ad_type: string; publish_count: number; price_minor: number; currency: AssetCode; currency_scale: number; network?: string | null; discount_price_minor?: number; is_enabled: number; is_public: number; created_at: string; updated_at: string }
interface OrderRow { id: string; order_no: string; customer_id: string; channel_id: string; package_id: string; amount_minor: number; discount_minor: number; receivable_minor: number; currency: AssetCode; currency_scale: number; network?: string | null; payment_status: string; status: OrderStatus; content_json: string; created_at: string; updated_at: string }

async function all<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T[]> {
  const prepared = db.prepare(query).bind(...values);
  if (!prepared.all) return [];
  return (await prepared.all<T>()).results;
}

export class D1BusinessRepository {
  constructor(private readonly db: D1Like) {}

  async listCustomers(tenantId: string, workspaceId: string): Promise<CustomerRow[]> {
    return all<CustomerRow>(this.db, "SELECT id, name, contact, telegram_user_id, telegram_username, source, notes, status, total_spend_minor, last_order_at, created_at, updated_at FROM customers WHERE tenant_id = ? AND workspace_id = ? ORDER BY updated_at DESC LIMIT 200", tenantId, workspaceId);
  }

  async createCustomer(scope: { tenantId: string; workspaceId: string }, input: CustomerInput, now: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.prepare("INSERT INTO customers (id, tenant_id, workspace_id, telegram_user_id, telegram_username, name, contact, source, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, scope.tenantId, scope.workspaceId, input.telegramUserId ?? null, input.telegramUsername ?? null, input.name, input.contact ?? null, input.source ?? null, input.notes ?? null, input.status ?? "new", now, now).run();
    return id;
  }

  async updateCustomer(scope: { tenantId: string; workspaceId: string }, customerId: string, input: CustomerInput, now: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE customers SET telegram_user_id = ?, telegram_username = ?, name = ?, contact = ?, source = ?, notes = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ?").bind(input.telegramUserId ?? null, input.telegramUsername ?? null, input.name, input.contact ?? null, input.source ?? null, input.notes ?? null, input.status ?? "new", now, customerId, scope.tenantId, scope.workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async listPackages(tenantId: string, workspaceId: string): Promise<PackageRow[]> {
    return all<PackageRow>(this.db, "SELECT id, name, description, ad_type, publish_count, price_minor, currency, currency_scale, network, discount_price_minor, is_enabled, is_public, created_at, updated_at FROM ad_packages WHERE tenant_id = ? AND workspace_id = ? ORDER BY updated_at DESC LIMIT 200", tenantId, workspaceId);
  }

  async createPackage(scope: { tenantId: string; workspaceId: string }, input: PackageInput, now: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.prepare("INSERT INTO ad_packages (id, tenant_id, workspace_id, name, description, ad_type, publish_count, display_duration_seconds, pin_duration_seconds, publish_interval_seconds, price_minor, discount_price_minor, auto_unpin, attempt_auto_delete, delete_failure_policy, is_public, currency, currency_scale, network, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, scope.tenantId, scope.workspaceId, input.name, input.description ?? null, input.adType, input.publishCount ?? 1, input.displayDurationSeconds ?? null, input.pinDurationSeconds ?? null, input.publishIntervalSeconds ?? null, input.priceMinor, input.discountPriceMinor ?? null, input.autoUnpin ? 1 : 0, input.attemptAutoDelete ? 1 : 0, input.deleteFailurePolicy ?? "manual", input.isPublic ? 1 : 0, input.currency, input.currencyScale, input.network, now, now).run();
    return id;
  }

  async updatePackage(scope: { tenantId: string; workspaceId: string }, packageId: string, input: PackageInput, now: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE ad_packages SET name = ?, description = ?, ad_type = ?, publish_count = ?, display_duration_seconds = ?, pin_duration_seconds = ?, publish_interval_seconds = ?, price_minor = ?, discount_price_minor = ?, auto_unpin = ?, attempt_auto_delete = ?, delete_failure_policy = ?, is_public = ?, currency = ?, currency_scale = ?, network = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ?").bind(input.name, input.description ?? null, input.adType, input.publishCount ?? 1, input.displayDurationSeconds ?? null, input.pinDurationSeconds ?? null, input.publishIntervalSeconds ?? null, input.priceMinor, input.discountPriceMinor ?? null, input.autoUnpin ? 1 : 0, input.attemptAutoDelete ? 1 : 0, input.deleteFailurePolicy ?? "manual", input.isPublic ? 1 : 0, input.currency, input.currencyScale, input.network, now, packageId, scope.tenantId, scope.workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  private async assertOrderReferences(scope: { tenantId: string; workspaceId: string }, input: CreateOrderInput, content: OrderContent): Promise<{ amountMinor: number; currency: AssetCode; currencyScale: number; network: string | null }> {
    const customer = await this.db.prepare("SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(input.customerId, scope.tenantId, scope.workspaceId).first<{ id: string }>();
    if (!customer) throw new BusinessValidationError("CUSTOMER_NOT_FOUND", "客户不存在或不属于当前工作空间");
    const packageRow = await this.db.prepare("SELECT id, price_minor, discount_price_minor, currency, currency_scale, network FROM ad_packages WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND is_enabled = 1 LIMIT 1").bind(input.packageId, scope.tenantId, scope.workspaceId).first<{ id: string; price_minor: number; discount_price_minor?: number; currency: AssetCode; currency_scale: number; network: string | null }>();
    if (!packageRow) throw new BusinessValidationError("PACKAGE_NOT_FOUND", "套餐不存在、已停用或不属于当前工作空间");
    const channel = await this.db.prepare("SELECT id FROM telegram_channels WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'active' LIMIT 1").bind(input.channelId, scope.tenantId, scope.workspaceId).first<{ id: string }>();
    if (!channel) throw new BusinessValidationError("CHANNEL_NOT_READY", "频道不存在、未验证或不属于当前工作空间");
    if (content.assetIds.length > 0) {
      const assets = await all<{ id: string }>(this.db, `SELECT id FROM media_assets WHERE tenant_id = ? AND workspace_id = ? AND status = 'ready' AND id IN (${content.assetIds.map(() => "?").join(",")})`, scope.tenantId, scope.workspaceId, ...content.assetIds);
      if (assets.length !== content.assetIds.length) throw new BusinessValidationError("MEDIA_ASSET_NOT_READY", "存在不属于当前工作空间或尚未 ready 的素材");
    }
    return { amountMinor: packageRow.discount_price_minor ?? packageRow.price_minor, currency: packageRow.currency, currencyScale: packageRow.currency_scale, network: packageRow.network };
  }

  async createOrder(scope: { tenantId: string; workspaceId: string }, actorUserId: string, input: CreateOrderInput, now: string): Promise<{ orderId: string; orderNo: string; receivableMinor: number }> {
    const content = parseOrderContent(input.content);
    const refs = await this.assertOrderReferences(scope, input, { ...content, assetIds: content.assetIds });
    const discountMinor = input.discountMinor === undefined ? 0 : integer(input.discountMinor, "discountMinor");
    if (discountMinor > refs.amountMinor) throw new BusinessValidationError("DISCOUNT_EXCEEDS_AMOUNT", "折扣金额不能高于应收金额");
    const orderId = crypto.randomUUID();
    const orderNo = orderNumber(new Date(now));
    const receivableMinor = refs.amountMinor - discountMinor;
    await this.db.prepare("INSERT INTO ad_orders (id, order_no, tenant_id, workspace_id, customer_id, channel_id, package_id, amount_minor, discount_minor, receivable_minor, currency, currency_scale, network, payment_status, status, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'draft', ?, ?, ?)").bind(orderId, orderNo, scope.tenantId, scope.workspaceId, input.customerId, input.channelId, input.packageId, refs.amountMinor, discountMinor, receivableMinor, refs.currency, refs.currencyScale, refs.network, JSON.stringify(content), now, now).run();
    for (const [sortOrder, assetId] of content.assetIds.entries()) await this.db.prepare("INSERT INTO ad_order_media_refs (order_id, media_asset_id, role, sort_order) VALUES (?, ?, ?, ?)").bind(orderId, assetId, "content", sortOrder).run();
    await this.db.prepare("INSERT INTO ad_order_revisions (id, order_id, actor_user_id, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), orderId, actorUserId, "created", "{}", JSON.stringify(content), now).run();
    return { orderId, orderNo, receivableMinor };
  }

  async listOrders(tenantId: string, workspaceId: string): Promise<OrderRow[]> {
    return all<OrderRow>(this.db, "SELECT id, order_no, customer_id, channel_id, package_id, amount_minor, discount_minor, receivable_minor, currency, currency_scale, network, payment_status, status, content_json, created_at, updated_at FROM ad_orders WHERE tenant_id = ? AND workspace_id = ? ORDER BY updated_at DESC LIMIT 200", tenantId, workspaceId);
  }

  async getOrder(scope: { tenantId: string; workspaceId: string }, orderId: string): Promise<OrderRow | null> {
    return this.db.prepare("SELECT id, order_no, customer_id, channel_id, package_id, amount_minor, discount_minor, receivable_minor, currency, currency_scale, network, payment_status, status, content_json, created_at, updated_at FROM ad_orders WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(orderId, scope.tenantId, scope.workspaceId).first<OrderRow>();
  }

  async updateOrderContent(scope: { tenantId: string; workspaceId: string }, actorUserId: string, orderId: string, rawContent: unknown, reason: string, now: string): Promise<boolean> {
    const order = await this.getOrder(scope, orderId);
    if (!order) throw new BusinessValidationError("ORDER_NOT_FOUND", "订单不存在或不属于当前工作空间");
    if (!["draft", "pending_payment"].includes(order.status)) throw new BusinessValidationError("ORDER_CONTENT_LOCKED", "当前订单状态不允许编辑内容");
    const content = parseOrderContent(rawContent);
    await this.assertOrderReferences(scope, { customerId: order.customer_id, channelId: order.channel_id, packageId: order.package_id, content }, content);
    const result = await this.db.prepare("UPDATE ad_orders SET content_json = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status IN ('draft', 'pending_payment')").bind(JSON.stringify(content), now, orderId, scope.tenantId, scope.workspaceId).run();
    if ((result.meta?.changes ?? 0) === 0) return false;
    await this.db.prepare("DELETE FROM ad_order_media_refs WHERE order_id = ?").bind(orderId).run();
    for (const [sortOrder, assetId] of content.assetIds.entries()) await this.db.prepare("INSERT INTO ad_order_media_refs (order_id, media_asset_id, role, sort_order) VALUES (?, ?, ?, ?)").bind(orderId, assetId, "content", sortOrder).run();
    await this.db.prepare("INSERT INTO ad_order_revisions (id, order_id, actor_user_id, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), orderId, actorUserId, reason.slice(0, 255) || "content_updated", order.content_json, JSON.stringify(content), now).run();
    return true;
  }

  async transitionOrder(scope: { tenantId: string; workspaceId: string }, actorUserId: string, orderId: string, to: OrderStatus, reason: string, now: string): Promise<boolean> {
    const order = await this.getOrder(scope, orderId);
    if (!order) throw new BusinessValidationError("ORDER_NOT_FOUND", "订单不存在或不属于当前工作空间");
    if (!canTransitionOrder(order.status, to)) throw new BusinessValidationError("INVALID_ORDER_TRANSITION", `订单不能从 ${order.status} 变更为 ${to}`);
    const result = await this.db.prepare("UPDATE ad_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = ?").bind(to, now, orderId, scope.tenantId, scope.workspaceId, order.status).run();
    if ((result.meta?.changes ?? 0) === 0) return false;
    await this.db.prepare("INSERT INTO ad_order_revisions (id, order_id, actor_user_id, reason, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), orderId, actorUserId, reason.slice(0, 255) || "status_changed", JSON.stringify({ status: order.status }), JSON.stringify({ status: to }), now).run();
    return true;
  }
}
