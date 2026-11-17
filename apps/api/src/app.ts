import { Hono } from "hono";
import type { ApiErrorPayload, ApiSuccessPayload, HealthPayload, ServiceState } from "@tg-ad-manager/contracts";
import { telegramServiceState } from "@tg-ad-manager/telegram";

export const startedAt = Date.now();
export const version = "1.1.0";
export const app = new Hono();

function dependencyState(value: string | undefined, fallback: ServiceState = "not_configured"): ServiceState {
  return value?.trim() ? "configured" : fallback;
}

function defaultRuntimeEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" ? process.env : {};
}

export function healthPayload(env: Record<string, string | undefined> = defaultRuntimeEnv()): HealthPayload {
  return {
    ok: true,
    service: "tg-ad-manager-api",
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    dependencies: {
      database: dependencyState(env.DATABASE_URL),
      telegram: telegramServiceState(env.TELEGRAM_BOT_TOKEN),
      r2: dependencyState(env.R2_BUCKET),
    },
  };
}

function success<T>(data: T, requestId?: string): ApiSuccessPayload<T> {
  return { ok: true, data, ...(requestId ? { requestId } : {}) };
}

function failure(code: string, message: string, requestId?: string, details?: Record<string, unknown>): ApiErrorPayload {
  return { ok: false, error: { code, message, ...(details ? { details } : {}), ...(requestId ? { requestId } : {}) } };
}

app.use("*", async (context, next) => {
  const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
  context.header("x-request-id", requestId);
  await next();
});

app.get("/health", (context) => context.json(healthPayload()));
app.get("/health/ready", (context) => {
  const health = healthPayload();
  const requiredConfigured = health.dependencies.database === "configured";
  return context.json({ ...health, ok: requiredConfigured, ready: requiredConfigured, blocking: requiredConfigured ? [] : ["database"] }, requiredConfigured ? 200 : 503);
});

app.get("/api/v1/health", (context) => context.json(success(healthPayload(), context.res.headers.get("x-request-id") ?? undefined)));
app.get("/api/v1/metadata", (context) => context.json(success({ name: "TG Ad Manager", version, stage: "foundation", externalIntegrations: { telegram: "not_configured", cloudflareD1: "not_configured" } })));

app.notFound((context) => context.json(failure("NOT_FOUND", "请求路径不存在", context.res.headers.get("x-request-id") ?? undefined), 404));
app.onError((error, context) => {
  console.error("unhandled_api_error", { message: error.message, path: context.req.path });
  return context.json(failure("INTERNAL_ERROR", "服务暂时无法处理请求", context.res.headers.get("x-request-id") ?? undefined), 500);
});
