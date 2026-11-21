import { readFile, readdir } from "node:fs/promises";
import { parseProductionConfig, PRODUCTION_MIGRATIONS_DIR, validateProductionConfig } from "./production-config.js";

async function main(): Promise<void> {
  const config = parseProductionConfig(await readFile("wrangler.production.jsonc", "utf8"));
  const files = await readdir(PRODUCTION_MIGRATIONS_DIR);
  const errors = validateProductionConfig(config, files);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Validated production Cloudflare bindings and isolated migration directory; no production migrations are approved for automatic application.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
