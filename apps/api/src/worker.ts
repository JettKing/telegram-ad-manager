import { app, type ApiBindings } from "./app.js";
import { processDuePublishTasks } from "./publishing.js";
import { processProductionDuePublishTasks } from "./production-publishing.js";
import { SubscriptionRepository } from "./subscription.js";

interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function processScheduledPublishTasks(env: ApiBindings) {
  return env.D1_SCHEMA_CONTRACT === "production-0008"
    ? processProductionDuePublishTasks(env)
    : processDuePublishTasks(env);
}

function processScheduledSubscriptions(env: ApiBindings) {
  if (!env.DB || env.D1_SCHEMA_CONTRACT === "production-0008") return Promise.resolve({ renewed: 0, expired: 0 });
  return new SubscriptionRepository(env.DB).processDueSubscriptions();
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: ApiBindings, context: WorkerExecutionContext) {
    context.waitUntil(Promise.all([processScheduledPublishTasks(env), processScheduledSubscriptions(env)]).then(([publish, subscriptions]) => {
      console.info("scheduled_cron_completed", { schemaContract: env.D1_SCHEMA_CONTRACT ?? "legacy", publish, subscriptions });
    }));
  },
};
