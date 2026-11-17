import { app, type ApiBindings } from "./app.js";
import { processDuePublishTasks } from "./publishing.js";
import { processProductionDuePublishTasks } from "./production-publishing.js";

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

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: ApiBindings, context: WorkerExecutionContext) {
    context.waitUntil(processScheduledPublishTasks(env).then((result) => {
      console.info("publish_cron_completed", { schemaContract: env.D1_SCHEMA_CONTRACT ?? "legacy", ...result });
    }));
  },
};
