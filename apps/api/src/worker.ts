import { app, type ApiBindings } from "./app.js";
import { processDuePublishTasks } from "./publishing.js";
import { processProductionDuePublishTasks } from "./production-publishing.js";
import { processNotificationOutbox, recordProductionCronSnapshot } from "./production-operations.js";
import { SubscriptionRepository } from "./subscription.js";

interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function processScheduledPublishTasks(env: ApiBindings) {
  return env.D1_SCHEMA_CONTRACT === "production-0009"
    ? processProductionDuePublishTasks(env)
    : processDuePublishTasks(env);
}

function processScheduledSubscriptions(env: ApiBindings) {
  if (!env.DB || env.D1_SCHEMA_CONTRACT === "production-0009") return Promise.resolve({ renewed: 0, expired: 0 });
  return new SubscriptionRepository(env.DB).processDueSubscriptions();
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: ApiBindings, context: WorkerExecutionContext) {
    const startedAt = Date.now();
    context.waitUntil(Promise.all([processScheduledPublishTasks(env), processScheduledSubscriptions(env)]).then(async ([publish, subscriptions]) => {
      const notifications = env.D1_SCHEMA_CONTRACT === "production-0009" ? await processNotificationOutbox(env.DB, env.TELEGRAM_BOT_TOKEN) : { sent: 0, failed: 0 };
      const details = { schemaContract: env.D1_SCHEMA_CONTRACT ?? "legacy", publish, subscriptions, notifications, durationMs: Date.now() - startedAt };
      console.info("scheduled_cron_completed", details);
      if (env.D1_SCHEMA_CONTRACT === "production-0009") {
        const publishResult = publish as { failed?: number; retried?: number; expirationFailed?: number };
        await recordProductionCronSnapshot(env.DB, publishResult.failed || publishResult.retried || publishResult.expirationFailed || notifications.failed ? "degraded" : "ok", details);
      }
    }).catch(async (error) => {
      const details = { schemaContract: env.D1_SCHEMA_CONTRACT ?? "legacy", error: error instanceof Error ? error.message : "unknown", durationMs: Date.now() - startedAt };
      console.error("scheduled_cron_failed", details);
      if (env.D1_SCHEMA_CONTRACT === "production-0009") await recordProductionCronSnapshot(env.DB, "down", details);
    }));
  },
};
