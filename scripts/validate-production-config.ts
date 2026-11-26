import { readFile } from "node:fs/promises";

function stripJsonComments(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== "\n") index += 1;
    } else if (char === "/" && next === "*") {
      index += 1;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
    } else {
      output += char;
    }
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

async function main(): Promise<void> {
  const path = "wrangler.production.jsonc";
  const raw = await readFile(path, "utf8");
  const config = JSON.parse(stripJsonComments(raw)) as Record<string, any>;
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
