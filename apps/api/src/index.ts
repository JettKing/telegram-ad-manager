import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`TG Ad Manager API listening on http://127.0.0.1:${info.port}`);
});

export { app };
