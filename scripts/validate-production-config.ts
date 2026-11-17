import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const path = "wrangler.production.jsonc";
  const raw = await readFile(path, "utf8");
  const json = raw.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
  const config = JSON.parse(json) as Record<string, any>;
  const errors: string[] = [];
  if (config.name !== "tg-ad-manager-api") errors.push("production Worker name must be tg-ad-manager-api");
  if (config.account_id !== "bf9869d76a7fcbd9f75aefc5f98f3fbb") errors.push("production account_id does not match the audited Cloudflare account");
  const d1 = config.d1_databases?.find((item: any) => item.binding === "DB");
  if (!d1 || d1.database_name !== "tg-ad-manager" || d1.database_id !== "d9a4ad54-d504-40d6-abd5-a3e978a8ff5a") errors.push("DB binding does not match the audited tg-ad-manager D1");
  const producer = config.queues?.producers?.find((item: any) => item.binding === "PUBLISH_QUEUE");
  if (!producer || producer.queue !== "tg-ad-manager-publish") errors.push("PUBLISH_QUEUE producer does not match the audited queue");
  if (!config.triggers?.crons?.includes("*/5 * * * *")) errors.push("5-minute Cron trigger is missing");
  if (JSON.stringify(config).includes("REPLACE_WITH")) errors.push("production config still contains a placeholder");
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("Validated production Cloudflare config for audited account, D1, queue, Worker name and Cron.");
}

void main();
