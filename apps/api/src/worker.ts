import { app, type ApiBindings } from "./app.js";
import { processDuePublishTasks } from "./publishing.js";

interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: ApiBindings, context: WorkerExecutionContext) {
    context.waitUntil(processDuePublishTasks(env).then((result) => {
      console.info("publish_cron_completed", result);
    }));
  },
};
