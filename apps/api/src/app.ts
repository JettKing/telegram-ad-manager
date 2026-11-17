import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { ApiErrorPayload, ApiSuccessPayload, HealthPayload, ServiceState } from "@tg-ad-manager/contracts";
import { D1ReplayStore, D1WebhookUpdateStore, MemoryWebhookUpdateStore, parseTelegramUpdate, validateTelegramInitData, validateWebhookSecret, type D1Like } from "@tg-ad-manager/telegram";
import { telegramServiceState } from "@tg-ad-manager/telegram";
import { hasPermission, issuePlatformSession, provisionTelegramIdentity, readPlatformSession, revokePlatformSession, type IdentityContext, type Permission } from "./identity.js";

export interface ApiBindings {
  DB?: D1Like;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_IDENTITY_ID?: string;
  DATABASE_URL?: string;
  R2_BUCKET?: string;
  SESSION_SECRET?: string;
  SESSION_TTL_SECONDS?: string;
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
  return typeof process !== "undefined" ? process.env : {};
}

function runtimeEnv(bindings: ApiBindings | undefined): ApiBindings {
  const current = bindings ?? {};
  const fallback = defaultRuntimeEnv();
  return { ...fallback, ...current, DATABASE_URL: current.DATABASE_URL ?? (current.DB ? "d1-binding" : fallback.DATABASE_URL) };
}

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
      r2: dependencyState(current.R2_BUCKET),
    },
  };
}

function success<T>(data: T, requestId?: string): ApiSuccessPayload<T> {
  return { ok: true, data, ...(requestId ? { requestId } : {}) };
}

function failure(code: string, message: string, requestId?: string, details?: Record<string, unknown>): ApiErrorPayload {
  return { ok: false, error: { code, message, ...(details ? { details } : {}), ...(requestId ? { requestId } : {}) } };
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
    if (!env.DB || !env.SESSION_SECRET) {
      return context.json(failure("SESSION_NOT_CONFIGURED", "平台会话依赖尚未配置", requestId(context)), 503);
    }
    const auth = await readPlatformSession(env.DB, bearerToken(context.req.header("Authorization")), env.SESSION_SECRET);
    if (!auth) return context.json(failure("SESSION_UNAUTHORIZED", "平台会话无效或已过期", requestId(context)), 401);
    if (permission && !hasPermission(auth.role, permission)) {
      return context.json(failure("RBAC_FORBIDDEN", "当前角色无权执行此操作", requestId(context), { permission, role: auth.role }), 403);
    }
    context.set("auth", auth);
    await next();
  }) satisfies MiddlewareHandler<AppEnv>;
}

app.use("*", async (context, next) => {
  const id = context.req.header("x-request-id") ?? crypto.randomUUID();
  context.header("x-request-id", id);
  await next();
});

app.get("/health", (context) => context.json(healthPayload(runtimeEnv(context.env))));
app.get("/health/ready", (context) => {
  const health = healthPayload(runtimeEnv(context.env));
  const requiredConfigured = health.dependencies.database === "configured";
  return context.json({ ...health, ok: requiredConfigured, ready: requiredConfigured, blocking: requiredConfigured ? [] : ["database"] }, requiredConfigured ? 200 : 503);
});

app.get("/api/v1/health", (context) => context.json(success(healthPayload(runtimeEnv(context.env)), requestId(context))));
app.get("/api/v1/metadata", (context) => context.json(success({ name: "TG Ad Manager", version, stage: "identity-session-rbac", externalIntegrations: { telegram: telegramServiceState(runtimeEnv(context.env).TELEGRAM_BOT_TOKEN), cloudflareD1: runtimeEnv(context.env).DB ? "binding_present" : "not_configured" } }, requestId(context))));

app.post("/api/v1/auth/telegram", async (context) => {
  const env = runtimeEnv(context.env);
  if (!env.DB || !env.SESSION_SECRET) return context.json(failure("SESSION_NOT_CONFIGURED", "平台会话依赖尚未配置", requestId(context)), 503);
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json(failure("INVALID_JSON", "请求体必须是有效 JSON", requestId(context)), 400);
  }
  const rawInitData = typeof body === "object" && body !== null && "initData" in body && typeof body.initData === "string" ? body.initData : context.req.header("x-telegram-init-data");
  if (!rawInitData) return context.json(failure("INIT_DATA_REQUIRED", "缺少 Telegram initData", requestId(context)), 400);

  const validation = await validateTelegramInitData(rawInitData, env.TELEGRAM_BOT_TOKEN, { replayStore: new D1ReplayStore(env.DB) });
  if (!validation.valid || !validation.user) {
    const status = validation.reason === "not_configured" || validation.reason === "replay_store_unavailable" ? 503 : 401;
    return context.json(failure(`TELEGRAM_${validation.reason?.toUpperCase() ?? "INVALID"}`, "Telegram 身份验证失败", requestId(context), { reason: validation.reason }), status);
  }

  try {
    const identity = await provisionTelegramIdentity(env.DB, validation.user);
    const session = await issuePlatformSession(env.DB, identity, env.SESSION_SECRET, sessionTtlSeconds(env.SESSION_TTL_SECONDS));
    return context.json(success({ authenticated: true, user: { id: identity.userId, telegramUserId: identity.telegramUserId, displayName: identity.displayName }, tenant: { id: identity.tenantId, name: identity.tenantName }, workspace: { id: identity.workspaceId, name: identity.workspaceName }, role: identity.role, session: { token: session.token, expiresAt: session.expiresAt }, authDate: validation.authDate }, requestId(context)));
  } catch (error) {
    console.error("telegram_identity_provision_error", { message: error instanceof Error ? error.message : "unknown" });
    return context.json(failure("IDENTITY_PROVISION_FAILED", "用户和平台上下文创建失败", requestId(context)), 503);
  }
});

app.get("/api/v1/auth/me", requireAuth(), (context) => {
  const auth = context.get("auth");
  return context.json(success({ authenticated: true, sessionId: auth?.sessionId, userId: auth?.userId, telegramUserId: auth?.telegramUserId, tenantId: auth?.tenantId, workspaceId: auth?.workspaceId, role: auth?.role, expiresAt: auth?.expiresAt }, requestId(context)));
});

app.post("/api/v1/auth/logout", requireAuth(), async (context) => {
  const env = runtimeEnv(context.env);
  const auth = context.get("auth");
  if (auth && env.DB) await revokePlatformSession(env.DB, auth.sessionId);
  return context.json(success({ loggedOut: true }, requestId(context)));
});

app.get("/api/v1/workspace/context", requireAuth("workspace:read"), (context) => {
  const auth = context.get("auth");
  return context.json(success({ tenantId: auth?.tenantId, workspaceId: auth?.workspaceId, role: auth?.role, permissions: auth?.role ? ["workspace:read", "channel:read", "customer:read", "order:read", "publish:read"].filter((permission) => hasPermission(auth.role, permission as Permission)) : [] }, requestId(context)));
});

app.get("/api/v1/finance/access", requireAuth("finance:read"), (context) => {
  const auth = context.get("auth");
  return context.json(success({ authorized: true, tenantId: auth?.tenantId, role: auth?.role }, requestId(context)));
});

app.post("/webhooks/telegram", async (context) => {
  const env = runtimeEnv(context.env);
  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return context.json(failure("WEBHOOK_NOT_CONFIGURED", "Telegram Webhook Secret 尚未配置", requestId(context)), 503);
  if (!validateWebhookSecret(context.req.header("X-Telegram-Bot-Api-Secret-Token"), expectedSecret)) return context.json(failure("WEBHOOK_UNAUTHORIZED", "Webhook Secret 校验失败", requestId(context)), 401);

  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json(failure("INVALID_JSON", "Webhook 请求体必须是有效 JSON", requestId(context)), 400);
  }
  const update = parseTelegramUpdate(body);
  if (!update) return context.json(failure("INVALID_UPDATE", "Webhook 请求缺少有效 update_id", requestId(context)), 400);

  try {
    const store = env.DB && env.TELEGRAM_BOT_IDENTITY_ID ? new D1WebhookUpdateStore(env.DB, env.TELEGRAM_BOT_IDENTITY_ID) : developmentWebhookStore;
    const result = await store.claim(update, JSON.stringify(body), new Date().toISOString());
    return context.json(success({ received: true, accepted: result.accepted, duplicate: result.duplicate, updateId: update.update_id }, requestId(context)));
  } catch (error) {
    console.error("telegram_webhook_persistence_error", { updateId: update.update_id, message: error instanceof Error ? error.message : "unknown" });
    return context.json(failure("WEBHOOK_PERSISTENCE_FAILED", "Webhook 暂时无法持久化", requestId(context)), 503);
  }
});

app.notFound((context) => context.json(failure("NOT_FOUND", "请求路径不存在", requestId(context)), 404));
app.onError((error, context) => {
  console.error("unhandled_api_error", { message: error.message, path: context.req.path });
  return context.json(failure("INTERNAL_ERROR", "服务暂时无法处理请求", requestId(context)), 500);
});
