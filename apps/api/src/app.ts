import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { ApiErrorPayload, ApiSuccessPayload, HealthPayload, ServiceState } from "@tg-ad-manager/contracts";
import { D1ReplayStore, D1WebhookUpdateStore, MemoryWebhookUpdateStore, ProductionD1WebhookUpdateStore, parseTelegramUpdate, validateTelegramInitData, validateWebhookSecret, type D1Like } from "@tg-ad-manager/telegram";
import { telegramServiceState } from "@tg-ad-manager/telegram";
import { hasPermission, issuePlatformSession, provisionTelegramIdentity, readPlatformSession, revokePlatformSession, type IdentityContext, type Permission } from "./identity.js";
import { ChannelCheckError, D1ChannelRepository, TelegramBotApiClient, verifyTelegramChannel } from "./channels.js";
import { D1MediaRepository } from "./media.js";
import { BusinessValidationError, D1BusinessRepository, canTransitionOrder, parseCustomerInput, parsePackageInput, type OrderStatus } from "./business.js";
import { D1PaymentRepository, parsePaymentInput, parsePaymentReviewInput, parseRefundInput, parseRefundReviewInput } from "./payments.js";
import { D1PublishRepository, parseScheduleInput } from "./publishing.js";
import { ProductionPublishRepository, parseProductionScheduleInput } from "./production-publishing.js";
import { provisionProductionTelegramIdentity, issueProductionPlatformSession, readProductionPlatformSession, revokeProductionPlatformSession } from "./production-identity.js";
import { ProductionChannelRepository } from "./production-channels.js";
import { ProductionMediaRepository } from "./production-media.js";
import { ProductionBusinessRepository } from "./production-business.js";
import { ProductionPaymentRepository } from "./production-payments.js";
import { ProductionOperationsRepository } from "./production-operations.js";
import { processNotificationOutbox, raiseOperationalAlert } from "./production-operations.js";
import { enqueueCustomerNotification } from "./production-customer-notifications.js";
import { parseCheckoutInput, parseCheckoutReviewInput, SubscriptionRepository } from "./subscription.js";
import { ProductionAdminRepository, writeProductionAudit } from "./production-admin.js";

export interface R2BucketLike {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get?(key: string): Promise<{ body?: ReadableStream; httpMetadata?: { contentType?: string }; httpEtag?: string } | null>;
}

export interface ApiBindings {
  DB?: D1Like;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_IDENTITY_ID?: string;
  TELEGRAM_API_BASE_URL?: string;
  D1_SCHEMA_CONTRACT?: string;
  DATABASE_URL?: string;
  R2_BUCKET?: R2BucketLike;
  SESSION_SECRET?: string;
  SESSION_TTL_SECONDS?: string;
  PLATFORM_ADMIN_TELEGRAM_IDS?: string;
  WEB_APP_ORIGIN?: string;
  ENVIRONMENT?: string;
}

type AppEnv = { Bindings: ApiBindings; Variables: { auth?: IdentityContext } };

export const startedAt = Date.now();
export const version = "1.1.0";
export const app = new Hono<AppEnv>();
const developmentWebhookStore = new MemoryWebhookUpdateStore();

function dependencyState(value: string | undefined, fallback: ServiceState = "not_configured"): ServiceState {
  return value?.trim() ? "configured" : fallback;
}

function defaultRuntimeEnv(): ApiBindings {
  return (typeof process !== "undefined" ? process.env : {}) as unknown as ApiBindings;
}

function runtimeEnv(bindings: ApiBindings | undefined): ApiBindings {
  const current = bindings ?? {};
  const fallback = defaultRuntimeEnv();
  return { ...fallback, ...current, DATABASE_URL: current.DATABASE_URL ?? (current.DB ? "d1-binding" : fallback.DATABASE_URL) };
}

function productionContract(env: ApiBindings): boolean { return env.D1_SCHEMA_CONTRACT === "production-0009"; }
function provisionIdentity(db: D1Like, user: Parameters<typeof provisionTelegramIdentity>[1], env: ApiBindings) { return productionContract(env) ? provisionProductionTelegramIdentity(db, user) : provisionTelegramIdentity(db, user); }
function issueSession(db: D1Like, identity: Awaited<ReturnType<typeof provisionTelegramIdentity>>, secret: string, ttl: number, env: ApiBindings) { return productionContract(env) ? issueProductionPlatformSession(db, identity, secret, ttl) : issuePlatformSession(db, identity, secret, ttl); }
function readSession(db: D1Like, token: string | undefined, secret: string, env: ApiBindings) { return productionContract(env) ? readProductionPlatformSession(db, token, secret) : readPlatformSession(db, token, secret); }
function revokeSession(db: D1Like, sessionId: string, env: ApiBindings) { return productionContract(env) ? revokeProductionPlatformSession(db, sessionId) : revokePlatformSession(db, sessionId); }
function channelRepository(db: D1Like, env: ApiBindings) { return productionContract(env) ? new ProductionChannelRepository(db) : new D1ChannelRepository(db); }
function mediaRepository(db: D1Like, env: ApiBindings) { return productionContract(env) ? new ProductionMediaRepository(db) : new D1MediaRepository(db); }
function businessRepository(db: D1Like, env: ApiBindings) { return productionContract(env) ? new ProductionBusinessRepository(db) : new D1BusinessRepository(db); }
function paymentRepository(db: D1Like, env: ApiBindings) { return productionContract(env) ? new ProductionPaymentRepository(db) : new D1PaymentRepository(db); }
function publishRepository(db: D1Like, env: ApiBindings) { return productionContract(env) ? new ProductionPublishRepository(db) : new D1PublishRepository(db); }
function subscriptionRepository(db: D1Like): SubscriptionRepository { return new SubscriptionRepository(db); }

function requiredTransitionPermission(to: OrderStatus): Permission | null {
  if (["paid", "approved", "refunded", "partially_refunded"].includes(to)) return "finance:write";
  if (["scheduled", "publishing", "published", "completed"].includes(to)) return "publish:write";
  return null;
}

export function parseStartCommand(value: unknown): { chatId: string; payload?: string } | null {
  if (!value || typeof value !== "object") return null;
  const message = (value as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  const messageRecord = message as Record<string, unknown>;
  const chat = messageRecord.chat;
  if (!chat || typeof chat !== "object") return null;
  const chatRecord = chat as Record<string, unknown>;
  if (chatRecord.type !== "private" || (typeof chatRecord.id !== "string" && typeof chatRecord.id !== "number")) return null;
  if (typeof messageRecord.text !== "string") return null;
  const match = messageRecord.text.trim().match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { chatId: String(chatRecord.id), ...(match[1]?.trim() ? { payload: match[1].trim() } : {}) };
}

const START_WELCOME_MESSAGE = "欢迎来到 TG Ad Manager！\n点击下方“进入广告管理”，开始绑定频道并管理你的 Telegram 广告。";
const START_WELCOME_MARKUP = { inline_keyboard: [[{ text: "进入广告管理", web_app: { url: "https://telegram-ad-manager.pages.dev" } }]] };

export function healthPayload(env: ApiBindings = defaultRuntimeEnv()): HealthPayload {
  const current = runtimeEnv(env);
  return {
    ok: true,
    service: "tg-ad-manager-api",
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    dependencies: {
      database: dependencyState(current.DATABASE_URL),
      telegram: telegramServiceState(current.TELEGRAM_BOT_TOKEN),
      r2: current.R2_BUCKET ? "configured" : "not_configured",
    },
  };
}

function success<T>(data: T, requestId?: string): ApiSuccessPayload<T> {
  return { ok: true, data, ...(requestId ? { requestId } : {}) };
}

function failure(code: string, message: string, requestId?: string, details?: Record<string, unknown>): ApiErrorPayload {
  return { ok: false, error: { code, message, ...(details ? { details } : {}), ...(requestId ? { requestId } : {}) } };
}

function telegramAuthMessage(reason: string | undefined): string {
  return ({
    missing: "缺少 Telegram initData，请从 @TGAdOpsBot 的“进入广告管理”按钮打开 Mini App",
    invalid_format: "Telegram 登录数据格式无效，请关闭 Mini App 后从 Bot 重新打开",
    invalid_signature: "Telegram 登录签名无效，请从 @TGAdOpsBot 重新打开 Mini App",
    expired: "Telegram 登录已过期，请关闭 Mini App 后重新打开",
    replay: "Telegram 登录请求已处理，请关闭 Mini App 后重新打开",
    not_configured: "Telegram Bot 登录依赖尚未配置",
    replay_store_unavailable: "Telegram 登录存储暂时不可用，请稍后重试",
  } as Record<string, string>)[reason ?? ""] ?? "Telegram 身份验证失败，请关闭 Mini App 后重试";
}

function requestId(context: { res: Response }): string | undefined {
  return context.res.headers.get("x-request-id") ?? undefined;
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token || undefined;
}

function sessionTtlSeconds(value: string | undefined): number {
  const parsed = Number(value ?? 86_400);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 7 * 86_400) : 86_400;
}

function requireAuth(permission?: Permission) {
  return (async (context, next) => {
    const env = runtimeEnv(context.env);
    if (!env.DB || !env.SESSION_SECRET) return context.json(failure("SESSION_NOT_CONFIGURED", "平台会话依赖尚未配置", requestId(context)), 503);
    const auth = await readSession(env.DB, bearerToken(context.req.header("Authorization")), env.SESSION_SECRET, env);
    if (!auth) return context.json(failure("SESSION_UNAUTHORIZED", "平台会话无效或已过期", requestId(context)), 401);
    if (permission && !hasPermission(auth.role, permission)) return context.json(failure("RBAC_FORBIDDEN", "当前角色无权执行此操作", requestId(context), { permission, role: auth.role }), 403);
    context.set("auth", auth);
    await next();
  }) satisfies MiddlewareHandler<AppEnv>;
}

app.use("*", async (context, next) => {
  const id = context.req.header("x-request-id") ?? crypto.randomUUID();
  context.header("x-request-id", id);
  await next();
});

app.use("/api/*", cors({
  origin: (origin, context) => {
    const allowedOrigin = runtimeEnv(context.env).WEB_APP_ORIGIN?.trim();
    return allowedOrigin && origin === allowedOrigin ? origin : undefined;
  },
  allowHeaders: ["Content-Type", "Authorization", "X-Telegram-Init-Data"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposeHeaders: ["X-Request-Id"],
}));

app.get("/", (context) => context.json({ ok: true, service: "tg-ad-manager-api", message: "TG Ad Manager API is running", health: "/health", apiHealth: "/api/v1/health", webhook: "/webhooks/telegram" }));
app.get("/health", (context) => context.json(healthPayload(runtimeEnv(context.env))));
app.get("/health/ready", (context) => {
  const health = healthPayload(runtimeEnv(context.env));
  const requiredConfigured = health.dependencies.database === "configured";
  return context.json({ ...health, ok: requiredConfigured, ready: requiredConfigured, blocking: requiredConfigured ? [] : ["database"] }, requiredConfigured ? 200 : 503);
});

app.get("/api/v1/health", (context) => context.json(success(healthPayload(runtimeEnv(context.env)), requestId(context))));
app.get("/api/v1/metadata", (context) => context.json(success({ name: "TG Ad Manager", version, stage: "production-scheduling-api", schemaContract: runtimeEnv(context.env).D1_SCHEMA_CONTRACT ?? "legacy", externalIntegrations: { telegram: telegramServiceState(runtimeEnv(context.env).TELEGRAM_BOT_TOKEN), cloudflareD1: runtimeEnv(context.env).DB ? "binding_present" : "not_configured" } }, requestId(context))));
app.get("/api/v1/operations/cron-liveness", async (context) => {
  const env = runtimeEnv(context.env);
  if (!env.DB || !productionContract(env)) return context.json(failure("OPERATIONS_NOT_CONFIGURED", "生产运维数据上下文尚未配置", requestId(context)), 503);
  const now = new Date(); const row = await env.DB.prepare("SELECT status, checked_at FROM ops_health_snapshots WHERE component = 'production_cron' ORDER BY checked_at DESC LIMIT 1").bind().first<{ status: string; checked_at: string }>();
  const ageSeconds = row ? Math.max(0, Math.floor((now.getTime() - Date.parse(row.checked_at)) / 1000)) : null; const stale = ageSeconds === null || ageSeconds > 10 * 60;
  if (stale) { await raiseOperationalAlert(env.DB, { fingerprint: "production-cron:liveness", severity: "critical", title: "生产 Cron 长时间未执行", message: row ? `最近一次 Cron 已超过 ${Math.floor((ageSeconds ?? 0) / 60)} 分钟未更新` : "生产 Cron 尚未产生健康快照", details: { lastCheckedAt: row?.checked_at ?? null, ageSeconds } }); await processNotificationOutbox(env.DB, env.TELEGRAM_BOT_TOKEN); }
  return context.json(success({ healthy: !stale, stale, lastCheckedAt: row?.checked_at ?? null, lastStatus: row?.status ?? "missing", ageSeconds }, requestId(context)), stale ? 503 : 200);
});

app.post("/api/v1/auth/telegram", async (context) => {
  const env = runtimeEnv(context.env);
  if (!env.DB || !env.SESSION_SECRET) return context.json(failure("SESSION_NOT_CONFIGURED", "平台会话依赖尚未配置", requestId(context)), 503);
  let body: unknown;
  try { body = await context.req.json(); } catch { return context.json(failure("INVALID_JSON", "请求体必须是有效 JSON", requestId(context)), 400); }
  const rawInitData = typeof body === "object" && body !== null && "initData" in body && typeof body.initData === "string" ? body.initData : context.req.header("x-telegram-init-data");
  if (!rawInitData) return context.json(failure("INIT_DATA_REQUIRED", "缺少 Telegram initData", requestId(context)), 400);
  const validation = await validateTelegramInitData(rawInitData, env.TELEGRAM_BOT_TOKEN, { replayStore: new D1ReplayStore(env.DB) });
  if (!validation.valid || !validation.user) {
    const status = validation.reason === "not_configured" || validation.reason === "replay_store_unavailable" ? 503 : 401;
    return context.json(failure(`TELEGRAM_${validation.reason?.toUpperCase() ?? "INVALID"}`, telegramAuthMessage(validation.reason), requestId(context), { reason: validation.reason }), status);
  }
  try {
    const identity = await provisionIdentity(env.DB, validation.user, env);
    if (!productionContract(env)) await subscriptionRepository(env.DB).ensureFreeSubscription(identity.tenantId);
    const session = await issueSession(env.DB, identity, env.SESSION_SECRET, sessionTtlSeconds(env.SESSION_TTL_SECONDS), env);
    return context.json(success({ authenticated: true, user: { id: identity.userId, telegramUserId: identity.telegramUserId, displayName: identity.displayName }, tenant: { id: identity.tenantId, name: identity.tenantName }, workspace: { id: identity.workspaceId, name: identity.workspaceName }, role: identity.role, session: { token: session.token, expiresAt: session.expiresAt }, authDate: validation.authDate }, requestId(context)));
  } catch (error) {
    console.error("telegram_identity_provision_error", { requestId: requestId(context), message: error instanceof Error ? error.message : "unknown" });
    return context.json(failure("IDENTITY_PROVISION_FAILED", "生产数据库初始化失败，请稍后重试", requestId(context)), 503);
  }
});

app.get("/api/v1/auth/me", requireAuth(), (context) => {
  const auth = context.get("auth");
  return context.json(success({ authenticated: true, sessionId: auth?.sessionId, userId: auth?.userId, telegramUserId: auth?.telegramUserId, tenantId: auth?.tenantId, workspaceId: auth?.workspaceId, role: auth?.role, expiresAt: auth?.expiresAt }, requestId(context)));
});

app.post("/api/v1/auth/logout", requireAuth(), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (auth && env.DB) await revokeSession(env.DB, auth.sessionId, env);
  return context.json(success({ loggedOut: true }, requestId(context)));
});

app.get("/api/v1/workspace/context", requireAuth("workspace:read"), (context) => {
  const auth = context.get("auth");
  return context.json(success({ tenantId: auth?.tenantId, workspaceId: auth?.workspaceId, role: auth?.role, permissions: auth?.role ? ["workspace:read", "channel:read", "customer:read", "order:read", "publish:read", "finance:read"].filter((permission) => hasPermission(auth.role, permission as Permission)) : [] }, requestId(context)));
});

app.get("/api/v1/workspace/members", requireAuth("workspace:manage"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("MEMBERS_NOT_CONFIGURED", "生产成员管理上下文尚未配置", requestId(context)), 503);
  try { return context.json(success({ members: await new ProductionAdminRepository(env.DB).listMembers({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }) }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.patch("/api/v1/workspace/members/:userId", requireAuth("workspace:manage"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("MEMBERS_NOT_CONFIGURED", "生产成员管理上下文尚未配置", requestId(context)), 503);
  try { const body = await context.req.json() as Record<string, unknown>; const role = body.role === undefined ? undefined : String(body.role) as "owner" | "admin" | "manager" | "editor" | "finance" | "viewer"; const status = body.status === undefined ? undefined : String(body.status) as "active" | "suspended"; const now = new Date().toISOString(); const result = await new ProductionAdminRepository(env.DB).updateMember({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, auth.role, context.req.param("userId"), role, status, now); await writeProductionAudit(env.DB, { tenantId: auth.tenantId, workspaceId: auth.workspaceId, actorUserId: auth.userId, action: "member.updated", entityType: "workspace_member", entityId: context.req.param("userId"), before: result.before, after: result.after, createdAt: now }); return context.json(success({ updated: result.updated }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.delete("/api/v1/workspace/members/:userId", requireAuth("workspace:manage"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("MEMBERS_NOT_CONFIGURED", "生产成员管理上下文尚未配置", requestId(context)), 503);
  try { const now = new Date().toISOString(); const result = await new ProductionAdminRepository(env.DB).removeMember({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("userId"), now); if (result.removed) await writeProductionAudit(env.DB, { tenantId: auth.tenantId, workspaceId: auth.workspaceId, actorUserId: auth.userId, action: "member.suspended", entityType: "workspace_member", entityId: context.req.param("userId"), before: result.before, after: { ...result.before, status: "suspended" }, createdAt: now }); return context.json(success({ removed: result.removed }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/audit-logs", requireAuth("workspace:manage"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("AUDIT_NOT_CONFIGURED", "生产审计查询上下文尚未配置", requestId(context)), 503);
  try { const rawLimit = Number(context.req.query("limit") ?? 100); return context.json(success({ logs: await new ProductionAdminRepository(env.DB).listAudit({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, Number.isFinite(rawLimit) ? rawLimit : 100) }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/subscription/plans", requireAuth("workspace:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || productionContract(env)) return context.json(failure("SUBSCRIPTION_SCHEMA_NOT_CONFIGURED", "当前生产 schema 尚未接入订阅表", requestId(context)), 503);
  return context.json(success({ plans: await subscriptionRepository(env.DB).listPlans() }, requestId(context)));
});

app.get("/api/v1/subscription", requireAuth("workspace:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || productionContract(env)) return context.json(failure("SUBSCRIPTION_SCHEMA_NOT_CONFIGURED", "当前生产 schema 尚未接入订阅表", requestId(context)), 503);
  return context.json(success(await subscriptionRepository(env.DB).overview(auth.tenantId), requestId(context)));
});

app.post("/api/v1/subscription/checkout", requireAuth("settings:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || productionContract(env)) return context.json(failure("SUBSCRIPTION_SCHEMA_NOT_CONFIGURED", "当前生产 schema 尚未接入订阅表", requestId(context)), 503);
  try { const result = await subscriptionRepository(env.DB).requestCheckout(auth.tenantId, auth.userId, parseCheckoutInput(await context.req.json())); return context.json(success(result, requestId(context)), 202); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/admin/subscriptions/:requestId/review", requireAuth("settings:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth"); const configuredAdmins = (env.PLATFORM_ADMIN_TELEGRAM_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!env.DB || !auth || productionContract(env)) return context.json(failure("SUBSCRIPTION_SCHEMA_NOT_CONFIGURED", "当前生产 schema 尚未接入订阅表", requestId(context)), 503);
  if (configuredAdmins.length === 0) return context.json(failure("PLATFORM_ADMIN_NOT_CONFIGURED", "平台管理员白名单尚未配置", requestId(context)), 503);
  if (!configuredAdmins.includes(auth.telegramUserId)) return context.json(failure("PLATFORM_ADMIN_REQUIRED", "只有平台管理员可以审核订阅升级", requestId(context)), 403);
  try { const input = parseCheckoutReviewInput(await context.req.json()); const result = await subscriptionRepository(env.DB).reviewCheckout(undefined, context.req.param("requestId"), auth.userId, input.decision, input.note); return context.json(success(result, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/finance/access", requireAuth("finance:read"), (context) => {
  const auth = context.get("auth");
  return context.json(success({ authorized: true, tenantId: auth?.tenantId, role: auth?.role }, requestId(context)));
});

function businessError(context: { json: (body: unknown, status?: number) => Response; req: { path: string; method: string } }, error: unknown, requestIdValue?: string): Response {
  if (error instanceof BusinessValidationError) {
    const status = error.code.endsWith("_NOT_FOUND") || error.code === "ORDER_NOT_FOUND" ? 404 : error.code.includes("TRANSITION") || error.code.includes("LOCKED") || error.code.includes("ALREADY") || error.code.includes("IDEMPOTENCY") || error.code.includes("DUPLICATE") ? 409 : 400;
    return context.json(failure(error.code, error.message, requestIdValue), status);
  }
  console.error("business_api_error", {
    requestId: requestIdValue,
    method: context.req.method,
    path: context.req.path,
    errorType: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : "unknown",
  });
  return context.json(failure("BUSINESS_OPERATION_FAILED", "业务操作失败", requestIdValue), 503);
}

app.get("/api/v1/finance/payments/pending", requireAuth("finance:read"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("FINANCE_NOT_CONFIGURED", "财务数据库上下文尚未配置", requestId(context)), 503);
  return context.json(success({ payments: await paymentRepository(env.DB, env).listPendingPayments(auth.tenantId, auth.workspaceId) }, requestId(context)));
});

app.get("/api/v1/finance/refunds/pending", requireAuth("finance:read"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("FINANCE_NOT_CONFIGURED", "财务数据库上下文尚未配置", requestId(context)), 503);
  return context.json(success({ refunds: await paymentRepository(env.DB, env).listPendingRefunds(auth.tenantId, auth.workspaceId) }, requestId(context)));
});

app.get("/api/v1/finance/reconciliation", requireAuth("finance:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("FINANCE_NOT_CONFIGURED", "生产财务对账上下文尚未配置", requestId(context)), 503);
  try { return context.json(success({ orders: await new ProductionPaymentRepository(env.DB).reconciliation(auth.tenantId, auth.workspaceId) }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/orders/:orderId/payments", requireAuth("order:read"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("PAYMENT_NOT_CONFIGURED", "付款数据库上下文尚未配置", requestId(context)), 503);
  try {
    const payments = await paymentRepository(env.DB, env).listOrderPayments({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("orderId"));
    return context.json(success({ payments }, requestId(context)));
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/orders/:orderId/timeline", requireAuth("order:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("TIMELINE_NOT_CONFIGURED", "生产订单时间线上下文尚未配置", requestId(context)), 503);
  try { return context.json(success({ events: await new ProductionPaymentRepository(env.DB).timeline({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("orderId")) }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/payments/proofs/:proofId", requireAuth("finance:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth"); const proofId = context.req.param("proofId");
  if (!env.DB || !auth || !env.R2_BUCKET?.get) return context.json(failure("PAYMENT_PROOF_NOT_CONFIGURED", "付款凭证下载存储尚未配置", requestId(context)), 503);
  try {
    const proof = await env.DB.prepare("SELECT object_key, file_name, mime_type, status FROM payment_proof_uploads WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status = 'ready' LIMIT 1").bind(proofId, auth.tenantId, auth.workspaceId).first<{ object_key: string; file_name: string; mime_type: string; status: string }>();
    if (!proof) return context.json(failure("PAYMENT_PROOF_NOT_FOUND", "付款凭证不存在或不属于当前工作空间", requestId(context)), 404);
    const object = await env.R2_BUCKET.get(proof.object_key);
    if (!object?.body) return context.json(failure("PAYMENT_PROOF_OBJECT_NOT_FOUND", "付款凭证文件已不存在", requestId(context)), 404);
    const safeName = proof.file_name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "payment-proof";
    return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || proof.mime_type, "Content-Disposition": `inline; filename="${safeName}"`, "Cache-Control": "private, no-store", ...(object.httpEtag ? { ETag: object.httpEtag } : {}) } });
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/payments/proofs/upload", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !env.R2_BUCKET) return context.json(failure("PAYMENT_PROOF_NOT_CONFIGURED", "付款凭证上传存储尚未配置", requestId(context)), 503);
  try {
    const form = await context.req.raw.formData(); const candidate = form.get("file");
    if (!(candidate instanceof File)) throw new BusinessValidationError("PAYMENT_PROOF_FILE_REQUIRED", "请选择付款凭证文件");
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    if (!allowed.has(candidate.type)) throw new BusinessValidationError("PAYMENT_PROOF_TYPE_NOT_ALLOWED", "付款凭证仅支持 JPG、PNG、WebP 或 PDF");
    if (candidate.size <= 0 || candidate.size > 10 * 1024 * 1024) throw new BusinessValidationError("PAYMENT_PROOF_SIZE_INVALID", "付款凭证大小必须在 1B 到 10MB 之间");
    const id = crypto.randomUUID(); const original = candidate.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "proof"; const objectKey = `${auth.tenantId}/${auth.workspaceId}/${id}-${original}`; const now = new Date().toISOString();
    await env.R2_BUCKET.put(objectKey, candidate.stream(), { httpMetadata: { contentType: candidate.type }, customMetadata: { tenantId: auth.tenantId, workspaceId: auth.workspaceId, uploadedBy: auth.userId, purpose: "payment_proof" } });
    await env.DB.prepare("INSERT INTO payment_proof_uploads (id, tenant_id, workspace_id, object_key, file_name, mime_type, file_size, status, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)").bind(id, auth.tenantId, auth.workspaceId, objectKey, original, candidate.type, candidate.size, auth.userId, now).run();
    return context.json(success({ proofAssetId: id, fileName: original, mimeType: candidate.type, fileSize: candidate.size, status: "ready" }, requestId(context)), 201);
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/orders/:orderId/payments", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("PAYMENT_NOT_CONFIGURED", "付款数据库上下文尚未配置", requestId(context)), 503);
  try {
    const now = new Date().toISOString(); const paymentId = await paymentRepository(env.DB, env).createPayment({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("orderId"), parsePaymentInput(await context.req.json()), now); if (productionContract(env)) await enqueueCustomerNotification(env.DB, { tenantId: auth.tenantId, workspaceId: auth.workspaceId, orderId: context.req.param("orderId"), event: "payment_submitted", objectId: paymentId, now });
    return context.json(success({ paymentId, status: "pending_review" }, requestId(context)), 201);
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/finance/payments/:paymentId/review", requireAuth("finance:write"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("FINANCE_NOT_CONFIGURED", "财务数据库上下文尚未配置", requestId(context)), 503);
  try {
    const reviewInput = parsePaymentReviewInput(await context.req.json()); const result = await paymentRepository(env.DB, env).reviewPayment({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("paymentId"), reviewInput, new Date().toISOString()); if (productionContract(env) && result.orderId) await enqueueCustomerNotification(env.DB, { tenantId: auth.tenantId, workspaceId: auth.workspaceId, orderId: result.orderId, event: reviewInput.status === "approved" ? "payment_approved" : "payment_rejected", objectId: context.req.param("paymentId"), details: reviewInput.status === "rejected" ? reviewInput.note : undefined });
    return context.json(success(result, requestId(context)));
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/orders/:orderId/refunds", requireAuth("order:read"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("REFUND_NOT_CONFIGURED", "退款数据库上下文尚未配置", requestId(context)), 503);
  try {
    const refunds = await paymentRepository(env.DB, env).listOrderRefunds({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("orderId"));
    return context.json(success({ refunds }, requestId(context)));
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/orders/:orderId/refunds", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("REFUND_NOT_CONFIGURED", "退款数据库上下文尚未配置", requestId(context)), 503);
  try {
    const refundId = await paymentRepository(env.DB, env).createRefund({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("orderId"), parseRefundInput(await context.req.json()), new Date().toISOString());
    return context.json(success({ refundId, status: "pending_review" }, requestId(context)), 201);
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/finance/refunds/:refundId/review", requireAuth("finance:write"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("FINANCE_NOT_CONFIGURED", "财务数据库上下文尚未配置", requestId(context)), 503);
  try {
    const result = await paymentRepository(env.DB, env).reviewRefund({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("refundId"), parseRefundReviewInput(await context.req.json()), new Date().toISOString());
    return context.json(success(result, requestId(context)));
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/finance/refunds/:refundId/disburse", requireAuth("finance:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("FINANCE_NOT_CONFIGURED", "生产退款出款登记尚未配置", requestId(context)), 503);
  try {
    const body = await context.req.json<Record<string, unknown>>();
    const method = typeof body.method === "string" ? body.method : "bank_transfer";
    const transactionRef = typeof body.transactionRef === "string" ? body.transactionRef.trim() : undefined;
    const actualAmountMinor = body.actualAmountMinor === undefined ? NaN : Number.isSafeInteger(body.actualAmountMinor) ? Number(body.actualAmountMinor) : NaN;
    const result = await new ProductionPaymentRepository(env.DB).disburseRefund({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("refundId"), { method, transactionRef, actualAmountMinor }, new Date().toISOString());
    return context.json(success(result, requestId(context)));
  } catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/customers", requireAuth("customer:read"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("CRM_NOT_CONFIGURED", "CRM 数据库上下文尚未配置", requestId(context)), 503);
  return context.json(success({ customers: await businessRepository(env.DB, env).listCustomers(auth.tenantId, auth.workspaceId) }, requestId(context)));
});

app.post("/api/v1/customers", requireAuth("customer:write"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("CRM_NOT_CONFIGURED", "CRM 数据库上下文尚未配置", requestId(context)), 503);
  try { const id = await businessRepository(env.DB, env).createCustomer({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, parseCustomerInput(await context.req.json()), new Date().toISOString()); return context.json(success({ customerId: id }, requestId(context)), 201); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.patch("/api/v1/customers/:customerId", requireAuth("customer:write"), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("CRM_NOT_CONFIGURED", "CRM 数据库上下文尚未配置", requestId(context)), 503);
  try { const updated = await businessRepository(env.DB, env).updateCustomer({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("customerId"), parseCustomerInput(await context.req.json()), new Date().toISOString()); if (!updated) return context.json(failure("CUSTOMER_NOT_FOUND", "客户不存在或不属于当前工作空间", requestId(context)), 404); return context.json(success({ updated: true }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/packages", requireAuth("order:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("PACKAGE_NOT_CONFIGURED", "套餐数据库上下文尚未配置", requestId(context)), 503);
  return context.json(success({ packages: await businessRepository(env.DB, env).listPackages(auth.tenantId, auth.workspaceId) }, requestId(context)));
});

app.post("/api/v1/packages", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("PACKAGE_NOT_CONFIGURED", "套餐数据库上下文尚未配置", requestId(context)), 503);
  try { const id = await businessRepository(env.DB, env).createPackage({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, parsePackageInput(await context.req.json()), new Date().toISOString()); return context.json(success({ packageId: id }, requestId(context)), 201); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.patch("/api/v1/packages/:packageId", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("PACKAGE_NOT_CONFIGURED", "套餐数据库上下文尚未配置", requestId(context)), 503);
  try { const updated = await businessRepository(env.DB, env).updatePackage({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("packageId"), parsePackageInput(await context.req.json()), new Date().toISOString()); if (!updated) return context.json(failure("PACKAGE_NOT_FOUND", "套餐不存在或不属于当前工作空间", requestId(context)), 404); return context.json(success({ updated: true }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/orders", requireAuth("order:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("ORDER_NOT_CONFIGURED", "订单数据库上下文尚未配置", requestId(context)), 503);
  return context.json(success({ orders: await businessRepository(env.DB, env).listOrders(auth.tenantId, auth.workspaceId) }, requestId(context)));
});

app.post("/api/v1/orders", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("ORDER_NOT_CONFIGURED", "订单数据库上下文尚未配置", requestId(context)), 503);
  try { const body = await context.req.json() as Record<string, unknown>; const now = new Date(); if (!productionContract(env)) await subscriptionRepository(env.DB).assertEntitlementAvailable(auth.tenantId, "monthly_orders", 1, now); const result = await businessRepository(env.DB, env).createOrder({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, { customerId: String(body.customerId ?? ""), channelId: String(body.channelId ?? ""), packageId: String(body.packageId ?? ""), discountMinor: body.discountMinor as number | undefined, content: body.content }, now.toISOString()); if (productionContract(env)) await enqueueCustomerNotification(env.DB, { tenantId: auth.tenantId, workspaceId: auth.workspaceId, orderId: result.orderId, event: "order_created", now: now.toISOString() }); if (!productionContract(env)) await subscriptionRepository(env.DB).recordEntitlementUsage(auth.tenantId, "monthly_orders", `order:${result.orderId}`, 1, now); return context.json(success(result, requestId(context)), 201); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/orders/:orderId", requireAuth("order:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("ORDER_NOT_CONFIGURED", "订单数据库上下文尚未配置", requestId(context)), 503);
  const order = await businessRepository(env.DB, env).getOrder({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("orderId"));
  if (!order) return context.json(failure("ORDER_NOT_FOUND", "订单不存在或不属于当前工作空间", requestId(context)), 404);
  return context.json(success({ order }, requestId(context)));
});

app.patch("/api/v1/orders/:orderId/content", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("ORDER_NOT_CONFIGURED", "订单数据库上下文尚未配置", requestId(context)), 503);
  try { const body = await context.req.json() as Record<string, unknown>; const updated = await businessRepository(env.DB, env).updateOrderContent({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("orderId"), body.content, typeof body.reason === "string" ? body.reason : "content_updated", new Date().toISOString()); return context.json(success({ updated }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/orders/:orderId/submit", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("ORDER_NOT_CONFIGURED", "订单数据库上下文尚未配置", requestId(context)), 503);
  try { const updated = await businessRepository(env.DB, env).transitionOrder({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("orderId"), "pending_payment", "submitted_for_payment", new Date().toISOString()); return context.json(success({ updated, status: "pending_payment" }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/orders/:orderId/transition", requireAuth("order:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("ORDER_NOT_CONFIGURED", "订单数据库上下文尚未配置", requestId(context)), 503);
  try { const body = await context.req.json() as Record<string, unknown>; const to = body.to; if (typeof to !== "string" || !["pending_payment", "paid", "pending_review", "approved", "scheduled", "publishing", "published", "completed", "cancelled", "refunded", "partially_refunded", "failed"].includes(to)) throw new BusinessValidationError("INVALID_ORDER_STATUS", "订单目标状态不合法"); const permission = requiredTransitionPermission(to as OrderStatus); if (permission && !hasPermission(auth.role, permission)) return context.json(failure("ORDER_TRANSITION_FORBIDDEN", `订单状态 ${to} 只能由具备 ${permission} 权限的角色推进`, requestId(context)), 403); const updated = await businessRepository(env.DB, env).transitionOrder({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("orderId"), to as OrderStatus, typeof body.reason === "string" ? body.reason : "status_changed", new Date().toISOString()); return context.json(success({ updated, status: to }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/schedules", requireAuth("publish:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("SCHEDULE_NOT_CONFIGURED", "排期数据库上下文尚未配置", requestId(context)), 503);
  return context.json(success({ schedules: await publishRepository(env.DB, env).listSchedules(auth.tenantId, auth.workspaceId) }, requestId(context)));
});

app.get("/api/v1/publish-tasks", requireAuth("publish:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("PUBLISH_QUEUE_NOT_CONFIGURED", "发布队列数据库上下文尚未配置", requestId(context)), 503);
  return context.json(success({ tasks: await publishRepository(env.DB, env).listTasks(auth.tenantId, auth.workspaceId) }, requestId(context)));
});

app.get("/api/v1/operations/summary", requireAuth("publish:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("OPERATIONS_NOT_CONFIGURED", "生产运维数据上下文尚未配置", requestId(context)), 503);
  try { return context.json(success(await new ProductionOperationsRepository(env.DB).summary({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, new Date().toISOString()), requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/publish-tasks/:taskId/retry", requireAuth("publish:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("OPERATIONS_NOT_CONFIGURED", "生产运维数据上下文尚未配置", requestId(context)), 503);
  try { const body = await context.req.json<{ confirmUncertain?: boolean }>().catch(() => ({} as { confirmUncertain?: boolean })); await new ProductionOperationsRepository(env.DB).retryTask({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("taskId"), auth.userId, new Date().toISOString(), body.confirmUncertain === true); return context.json(success({ retried: true, status: "queued" }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/publish-tasks/:taskId/cancel", requireAuth("publish:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("OPERATIONS_NOT_CONFIGURED", "生产运维数据上下文尚未配置", requestId(context)), 503);
  try { await new ProductionOperationsRepository(env.DB).cancelTask({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("taskId"), auth.userId, new Date().toISOString()); return context.json(success({ cancelled: true, status: "cancelled" }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.get("/api/v1/expiration-failures", requireAuth("publish:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("OPERATIONS_NOT_CONFIGURED", "生产运维数据上下文尚未配置", requestId(context)), 503);
  try { return context.json(success({ failures: await new ProductionPublishRepository(env.DB).listExpirationFailures({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }) }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/expiration-failures/:failureId/retry", requireAuth("publish:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("OPERATIONS_NOT_CONFIGURED", "生产运维数据上下文尚未配置", requestId(context)), 503);
  try { await new ProductionPublishRepository(env.DB).retryExpirationFailure({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("failureId"), new Date().toISOString()); return context.json(success({ retried: true, status: "retrying" }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/expiration-failures/:failureId/acknowledge", requireAuth("publish:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("OPERATIONS_NOT_CONFIGURED", "生产运维数据上下文尚未配置", requestId(context)), 503);
  try { const raw = await context.req.json<{ note?: string }>(); const note = typeof raw?.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 500) : "已人工确认处理"; await new ProductionPublishRepository(env.DB).acknowledgeExpirationFailure({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("failureId"), auth.userId, note, new Date().toISOString()); return context.json(success({ acknowledged: true, status: "acknowledged" }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/operations/notification-channels/telegram", requireAuth("settings:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth || !productionContract(env)) return context.json(failure("OPERATIONS_NOT_CONFIGURED", "生产运维数据上下文尚未配置", requestId(context)), 503);
  try { const raw = await context.req.json<{ chatId?: string }>(); const chatId = typeof raw?.chatId === "string" ? raw.chatId.trim() : ""; if (!chatId || chatId.length > 100) throw new BusinessValidationError("TELEGRAM_CHAT_ID_REQUIRED", "Telegram 告警 chatId 必须有效"); const now = new Date().toISOString(); const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO ops_notification_channels (id, tenant_id, workspace_id, channel_type, destination_ref, status, created_at, updated_at) VALUES (?, ?, ?, 'telegram', ?, 'active', ?, ?) ON CONFLICT (tenant_id, workspace_id, channel_type, destination_ref) DO UPDATE SET status = 'active', updated_at = excluded.updated_at").bind(id, auth.tenantId, auth.workspaceId, chatId, now, now).run(); return context.json(success({ configured: true, channelType: "telegram" }, requestId(context))); }
  catch (error) { return businessError(context, error, requestId(context)); }
});

app.post("/api/v1/orders/:orderId/schedules", requireAuth("publish:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("SCHEDULE_NOT_CONFIGURED", "排期数据库上下文尚未配置", requestId(context)), 503);
  try {
    const raw = await context.req.json();
    const result = productionContract(env)
      ? await new ProductionPublishRepository(env.DB).createSchedule({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("orderId"), parseProductionScheduleInput(raw), new Date().toISOString())
      : await new D1PublishRepository(env.DB).createSchedule({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, auth.userId, context.req.param("orderId"), parseScheduleInput(raw), new Date().toISOString());
    if (productionContract(env)) await enqueueCustomerNotification(env.DB, { tenantId: auth.tenantId, workspaceId: auth.workspaceId, orderId: context.req.param("orderId"), event: "schedule_confirmed", objectId: result.taskId, now: new Date().toISOString() }); return context.json(success({ ...result, status: "queued" }, requestId(context)), 201);
  } catch (error) { return businessError(context, error, requestId(context)); }
});

function channelApiConfig(env: ApiBindings): { db: D1Like; botIdentityId: string; client: TelegramBotApiClient } | null {
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_IDENTITY_ID) return null;
  return { db: env.DB, botIdentityId: env.TELEGRAM_BOT_IDENTITY_ID, client: new TelegramBotApiClient(env.TELEGRAM_BOT_TOKEN, (input, init) => fetch(input, init), env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org") };
}

app.get("/api/v1/channels", requireAuth("channel:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("CHANNELS_NOT_CONFIGURED", "频道数据库上下文尚未配置", requestId(context)), 503);
  return context.json(success({ channels: await channelRepository(env.DB, env).listScoped(auth.tenantId, auth.workspaceId) }, requestId(context)));
});

app.post("/api/v1/channels/bind", requireAuth("channel:manage"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth"); const config = channelApiConfig(env);
  if (!config || !auth) return context.json(failure("CHANNEL_BINDING_NOT_CONFIGURED", "频道绑定依赖尚未配置", requestId(context)), 503);
  let body: unknown; try { body = await context.req.json(); } catch { return context.json(failure("INVALID_JSON", "请求体必须是有效 JSON", requestId(context)), 400); }
  const chatId = typeof body === "object" && body !== null && "chatId" in body && typeof body.chatId === "string" ? body.chatId.trim() : "";
  if (!chatId || chatId.length > 255) return context.json(failure("CHANNEL_ID_REQUIRED", "需要 Telegram channel chat_id 或 @username", requestId(context)), 400);
  if (!productionContract(env)) { const count = await config.db.prepare("SELECT COUNT(*) AS count FROM telegram_channels WHERE tenant_id = ? AND workspace_id = ? AND status IN ('active', 'pending_verification', 'permission_error')").bind(auth.tenantId, auth.workspaceId).first<{ count: number }>(); try { await subscriptionRepository(config.db).assertResourceLimit(auth.tenantId, "max_channels", Number(count?.count ?? 0)); } catch (error) { return businessError(context, error, requestId(context)); } }
  try { const verified = await verifyTelegramChannel(config.client, chatId); const saved = await channelRepository(config.db, env).upsertVerified({ tenantId: auth.tenantId, workspaceId: auth.workspaceId, botIdentityId: config.botIdentityId, verified, now: new Date().toISOString() }); const data = { channelId: saved.channelId, status: saved.status, telegramChatId: verified.telegramChatId, title: verified.title, username: verified.username, permissions: verified.permissions }; if (saved.status !== "active") return context.json(failure("CHANNEL_PERMISSION_ERROR", "频道已记录，但 Bot 不是管理员或缺少发布权限", requestId(context), data), 422); return context.json(success(data, requestId(context)), 201); }
  catch (error) { if (error instanceof ChannelCheckError) return context.json(failure(`CHANNEL_${error.code}`, error.message, requestId(context)), error.code === "NOT_CHANNEL" ? 422 : 503); if (error instanceof Error && error.message === "CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE") return context.json(failure("CHANNEL_ALREADY_BOUND", "频道已绑定到其他工作空间", requestId(context)), 409); console.error("telegram_channel_bind_error", { message: error instanceof Error ? error.message : "unknown" }); return context.json(failure("CHANNEL_BIND_FAILED", "频道绑定失败", requestId(context)), 503); }
});

app.post("/api/v1/channels/:channelId/recheck", requireAuth("channel:manage"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth"); const config = channelApiConfig(env);
  if (!config || !auth) return context.json(failure("CHANNEL_RECHECK_NOT_CONFIGURED", "频道复核依赖尚未配置", requestId(context)), 503);
  const channelId = context.req.param("channelId"); const repo = channelRepository(config.db, env); const existing = await repo.findByIdScoped(channelId, auth.tenantId, auth.workspaceId); if (!existing) return context.json(failure("CHANNEL_NOT_FOUND", "频道不存在或不属于当前工作空间", requestId(context)), 404);
  try { const verified = await verifyTelegramChannel(config.client, existing.telegram_chat_id); const saved = await repo.upsertVerified({ tenantId: auth.tenantId, workspaceId: auth.workspaceId, botIdentityId: config.botIdentityId, verified, now: new Date().toISOString() }); return context.json(success({ channelId: saved.channelId, status: saved.status, permissions: verified.permissions }, requestId(context))); }
  catch (error) { if (error instanceof ChannelCheckError) return context.json(failure(`CHANNEL_${error.code}`, error.message, requestId(context)), 503); return context.json(failure("CHANNEL_RECHECK_FAILED", "频道权限复核失败", requestId(context)), 503); }
});

app.post("/api/v1/channels/:channelId/unbind", requireAuth("channel:manage"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth");
  if (!env.DB || !auth) return context.json(failure("CHANNEL_UNBIND_NOT_CONFIGURED", "频道解绑依赖尚未配置", requestId(context)), 503);
  const unbound = await channelRepository(env.DB, env).unbind(context.req.param("channelId"), auth.tenantId, auth.workspaceId, new Date().toISOString()); if (!unbound) return context.json(failure("CHANNEL_NOT_FOUND", "频道不存在、已解绑或不属于当前工作空间", requestId(context)), 404); return context.json(success({ unbound: true, channelId: context.req.param("channelId") }, requestId(context)));
});

app.get("/api/v1/media-assets", requireAuth("media:read"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth"); if (!env.DB || !auth) return context.json(failure("MEDIA_NOT_CONFIGURED", "素材数据库上下文尚未配置", requestId(context)), 503); return context.json(success({ assets: await mediaRepository(env.DB, env).listAssets(auth.tenantId, auth.workspaceId) }, requestId(context)));
});
app.post("/api/v1/media-assets/:assetId/review", requireAuth("media:write"), async (context) => { const env = runtimeEnv(context.env); const auth = context.get("auth"); if (!env.DB || !auth || !productionContract(env)) return context.json(failure("MEDIA_REVIEW_NOT_CONFIGURED", "生产素材审核上下文尚未配置", requestId(context)), 503); try { const body = await context.req.json() as { status?: string; note?: string }; if (body.status !== "approved" && body.status !== "rejected") throw new BusinessValidationError("INVALID_MEDIA_REVIEW_STATUS", "素材审核状态必须是 approved 或 rejected"); const updated = await new ProductionMediaRepository(env.DB).reviewAsset({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("assetId"), auth.userId, body.status, typeof body.note === "string" ? body.note : "", new Date().toISOString()); return context.json(success({ updated, status: body.status }, requestId(context))); } catch (error) { return businessError(context, error, requestId(context)); } });
app.post("/api/v1/media-assets/:assetId/replace", requireAuth("media:write"), async (context) => { const env = runtimeEnv(context.env); const auth = context.get("auth"); if (!env.DB || !auth || !productionContract(env)) return context.json(failure("MEDIA_REPLACE_NOT_CONFIGURED", "生产素材替换上下文尚未配置", requestId(context)), 503); try { const body = await context.req.json() as { replacementAssetId?: string }; if (typeof body.replacementAssetId !== "string" || !body.replacementAssetId.trim()) throw new BusinessValidationError("REPLACEMENT_ASSET_REQUIRED", "请选择替换素材"); const updated = await new ProductionMediaRepository(env.DB).replaceAsset({ tenantId: auth.tenantId, workspaceId: auth.workspaceId }, context.req.param("assetId"), body.replacementAssetId.trim(), new Date().toISOString()); return context.json(success({ updated, status: "pending" }, requestId(context))); } catch (error) { return businessError(context, error, requestId(context)); } });
app.get("/api/v1/media-assets/:assetId/preview", requireAuth("media:read"), async (context) => { const env = runtimeEnv(context.env); const auth = context.get("auth"); if (!env.DB || !auth || !env.TELEGRAM_BOT_TOKEN || !productionContract(env)) return context.json(failure("MEDIA_PREVIEW_NOT_CONFIGURED", "素材预览上下文尚未配置", requestId(context)), 503); try { const asset = await env.DB.prepare("SELECT file_id, file_name, mime_type FROM creative_media WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(context.req.param("assetId"), auth.tenantId, auth.workspaceId).first<{ file_id: string; file_name?: string; mime_type?: string }>(); if (!asset?.file_id) return context.json(failure("MEDIA_ASSET_NOT_FOUND", "素材不存在或没有可预览文件", requestId(context)), 404); const apiBase = env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org"; const fileResponse = await fetch(`${apiBase}/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(asset.file_id)}`); const filePayload = await fileResponse.json() as { ok?: boolean; result?: { file_path?: string } }; if (!fileResponse.ok || !filePayload.ok || !filePayload.result?.file_path) return context.json(failure("MEDIA_FILE_LOOKUP_FAILED", "Telegram 文件信息读取失败", requestId(context)), 502); const content = await fetch(`${apiBase}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePayload.result.file_path}`); if (!content.ok || !content.body) return context.json(failure("MEDIA_FILE_DOWNLOAD_FAILED", "Telegram 文件下载失败", requestId(context)), 502); return new Response(content.body, { headers: { "Content-Type": asset.mime_type || content.headers.get("content-type") || "application/octet-stream", "Content-Disposition": `inline; filename="${(asset.file_name || "telegram-media").replace(/[^A-Za-z0-9._-]/g, "_")}"`, "Cache-Control": "private, no-store" } }); } catch (error) { return businessError(context, error, requestId(context)); } });

app.post("/api/v1/media-groups/:groupId/settle", requireAuth("media:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth"); if (!env.DB || !auth) return context.json(failure("MEDIA_GROUP_NOT_CONFIGURED", "相册数据库上下文尚未配置", requestId(context)), 503); const settling = await mediaRepository(env.DB, env).startSettlement(context.req.param("groupId"), auth.tenantId, auth.workspaceId); if (!settling) return context.json(failure("MEDIA_GROUP_NOT_FOUND_OR_NOT_COLLECTING", "相册不存在、已隔离或不在 collecting 状态", requestId(context)), 404); return context.json(success({ groupId: context.req.param("groupId"), state: "settling" }, requestId(context)));
});

app.post("/api/v1/media-groups/:groupId/pending-confirmation", requireAuth("media:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth"); if (!env.DB || !auth) return context.json(failure("MEDIA_GROUP_NOT_CONFIGURED", "相册数据库上下文尚未配置", requestId(context)), 503); const pending = await mediaRepository(env.DB, env).markPendingConfirmation(context.req.param("groupId"), auth.tenantId, auth.workspaceId); if (!pending) return context.json(failure("MEDIA_GROUP_NOT_SETTLING", "相册不存在或尚未进入 settling", requestId(context)), 409); return context.json(success({ groupId: context.req.param("groupId"), state: "pending_confirmation" }, requestId(context)));
});

app.post("/api/v1/media-groups/:groupId/confirm", requireAuth("media:write"), async (context) => {
  const env = runtimeEnv(context.env); const auth = context.get("auth"); if (!env.DB || !auth) return context.json(failure("MEDIA_GROUP_NOT_CONFIGURED", "相册数据库上下文尚未配置", requestId(context)), 503); const completed = await mediaRepository(env.DB, env).confirmGroup(context.req.param("groupId"), auth.tenantId, auth.workspaceId, new Date().toISOString()); if (!completed) return context.json(failure("MEDIA_GROUP_NOT_PENDING_CONFIRMATION", "相册不存在或尚未进入 pending_confirmation", requestId(context)), 409); return context.json(success({ groupId: context.req.param("groupId"), state: "completed" }, requestId(context)));
});

app.post("/webhooks/telegram", async (context) => {
  const env = runtimeEnv(context.env); const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET; if (!expectedSecret) return context.json(failure("WEBHOOK_NOT_CONFIGURED", "Telegram Webhook Secret 尚未配置", requestId(context)), 503); if (!validateWebhookSecret(context.req.header("X-Telegram-Bot-Api-Secret-Token"), expectedSecret)) return context.json(failure("WEBHOOK_UNAUTHORIZED", "Webhook Secret 校验失败", requestId(context)), 401);
  let body: unknown; try { body = await context.req.json(); } catch { return context.json(failure("INVALID_JSON", "Webhook 请求体必须是有效 JSON", requestId(context)), 400); }
  const update = parseTelegramUpdate(body); if (!update) return context.json(failure("INVALID_UPDATE", "Webhook 请求缺少有效 update_id", requestId(context)), 400);
  try { const store = env.DB && env.TELEGRAM_BOT_IDENTITY_ID ? (productionContract(env) ? new ProductionD1WebhookUpdateStore(env.DB, env.TELEGRAM_BOT_IDENTITY_ID) : new D1WebhookUpdateStore(env.DB, env.TELEGRAM_BOT_IDENTITY_ID)) : developmentWebhookStore; const result = await store.claim(update, JSON.stringify(body), new Date().toISOString()); const media = env.DB && env.TELEGRAM_BOT_IDENTITY_ID ? await mediaRepository(env.DB, env).ingest(env.TELEGRAM_BOT_IDENTITY_ID, body) : { handled: false, reason: "scope_not_found" as const }; let welcomeSent = false; const start = result.accepted ? parseStartCommand(body) : null; if (start && env.TELEGRAM_BOT_TOKEN) { try { await new TelegramBotApiClient(env.TELEGRAM_BOT_TOKEN, fetch, env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org").sendMessage(start.chatId, START_WELCOME_MESSAGE, { reply_markup: START_WELCOME_MARKUP }); welcomeSent = true; } catch (error) { console.error("telegram_start_welcome_failed", { updateId: update.update_id, message: error instanceof Error ? error.message : "unknown" }); } } return context.json(success({ received: true, accepted: result.accepted, duplicate: result.duplicate, updateId: update.update_id, media, welcomeSent }, requestId(context))); }
  catch (error) { console.error("telegram_webhook_persistence_error", { updateId: update.update_id, message: error instanceof Error ? error.message : "unknown" }); return context.json(failure("WEBHOOK_PERSISTENCE_FAILED", "Webhook 暂时无法持久化", requestId(context)), 503); }
});

app.notFound((context) => context.json(failure("NOT_FOUND", "请求路径不存在", requestId(context)), 404));
app.onError((error, context) => { console.error("unhandled_api_error", { message: error.message, path: context.req.path }); return context.json(failure("INTERNAL_ERROR", "服务暂时无法处理请求", requestId(context)), 500); });
