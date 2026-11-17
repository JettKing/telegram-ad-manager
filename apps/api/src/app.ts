import { Hono } from "hono";
import type { ApiErrorPayload, ApiSuccessPayload, HealthPayload, ServiceState } from "@tg-ad-manager/contracts";
import { D1ReplayStore, D1WebhookUpdateStore, MemoryWebhookUpdateStore, parseTelegramUpdate, validateTelegramInitData, validateWebhookSecret, type D1Like } from "@tg-ad-manager/telegram";
import { telegramServiceState } from "@tg-ad-manager/telegram";

export interface ApiBindings {
  DB?: D1Like;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_IDENTITY_ID?: string;
  DATABASE_URL?: string;
  R2_BUCKET?: string;
  ENVIRONMENT?: string;
}

type AppEnv = { Bindings: ApiBindings };

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
  return {
    ...fallback,
    ...current,
    DATABASE_URL: current.DATABASE_URL ?? (current.DB ? "d1-binding" : fallback.DATABASE_URL),
  };
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
app.get("/api/v1/metadata", (context) => context.json(success({ name: "TG Ad Manager", version, stage: "telegram-auth-webhook", externalIntegrations: { telegram: telegramServiceState(runtimeEnv(context.env).TELEGRAM_BOT_TOKEN), cloudflareD1: runtimeEnv(context.env).DB ? "binding_present" : "not_configured" } }, requestId(context))));

app.post("/api/v1/auth/telegram", async (context) => {
  const env = runtimeEnv(context.env);
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json(failure("INVALID_JSON", "请求体必须是有效 JSON", requestId(context)), 400);
  }
  const rawInitData = typeof body === "object" && body !== null && "initData" in body && typeof body.initData === "string" ? body.initData : context.req.header("x-telegram-init-data");
  if (!rawInitData) return context.json(failure("INIT_DATA_REQUIRED", "缺少 Telegram initData", requestId(context)), 400);

  const validation = await validateTelegramInitData(rawInitData, env.TELEGRAM_BOT_TOKEN, {
    replayStore: env.DB ? new D1ReplayStore(env.DB) : undefined,
  });
  if (!validation.valid) {
    const status = validation.reason === "not_configured" || validation.reason === "replay_store_unavailable" ? 503 : 401;
    return context.json(failure(`TELEGRAM_${validation.reason?.toUpperCase() ?? "INVALID"}`, "Telegram 身份验证失败", requestId(context), { reason: validation.reason }), status);
  }

  return context.json(success({ authenticated: true, user: validation.user, authDate: validation.authDate, replayKey: validation.replayKey }, requestId(context)));
});

app.post("/webhooks/telegram", async (context) => {
  const env = runtimeEnv(context.env);
  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return context.json(failure("WEBHOOK_NOT_CONFIGURED", "Telegram Webhook Secret 尚未配置", requestId(context)), 503);
  if (!validateWebhookSecret(context.req.header("X-Telegram-Bot-Api-Secret-Token"), expectedSecret)) {
    return context.json(failure("WEBHOOK_UNAUTHORIZED", "Webhook Secret 校验失败", requestId(context)), 401);
  }

  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json(failure("INVALID_JSON", "Webhook 请求体必须是有效 JSON", requestId(context)), 400);
  }
  const update = parseTelegramUpdate(body);
  if (!update) return context.json(failure("INVALID_UPDATE", "Webhook 请求缺少有效 update_id", requestId(context)), 400);

  const receivedAt = new Date().toISOString();
  const payloadJson = JSON.stringify(body);
  try {
    const store = env.DB && env.TELEGRAM_BOT_IDENTITY_ID ? new D1WebhookUpdateStore(env.DB, env.TELEGRAM_BOT_IDENTITY_ID) : developmentWebhookStore;
    const result = await store.claim(update, payloadJson, receivedAt);
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
