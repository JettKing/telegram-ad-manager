import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export const PRODUCTION_MIGRATIONS_DIR = "apps/api/production-migrations";

/** Parse JSONC without stripping comment-like text inside strings (e.g. https://). */
export function parseProductionConfig(raw: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const result: unknown = parse(raw, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const first = errors[0];
    throw new Error(`Invalid production JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Production config must be an object");
  }
  return result as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function validateProductionConfig(config: Record<string, unknown>, migrationFiles: string[]): string[] {
  const errors: string[] = [];
  if (config.name !== "tg-ad-manager-api") errors.push("production Worker name must be tg-ad-manager-api");
  if (config.account_id !== "bf9869d76a7fcbd9f75aefc5f98f3fbb") errors.push("production account_id does not match the audited Cloudflare account");
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const d1 = databases.map(record).find((item) => item?.binding === "DB");
  const referencesToProductionDb = databases.map(record).filter((item) => item && (item.binding === "DB" || item.database_name === "tg-ad-manager" || item.database_id === "d9a4ad54-d504-40d6-abd5-a3e978a8ff5a"));
  if (referencesToProductionDb.length !== 1) errors.push("production DB must have exactly one binding and no duplicate database aliases");
  if (config.env !== undefined) errors.push("environment-specific overrides are not allowed in production config until separately reviewed");
  if (!d1 || d1.database_name !== "tg-ad-manager" || d1.database_id !== "d9a4ad54-d504-40d6-abd5-a3e978a8ff5a") errors.push("DB binding does not match the audited tg-ad-manager D1");
  if (d1?.migrations_dir !== PRODUCTION_MIGRATIONS_DIR) errors.push(`production DB migrations_dir must be ${PRODUCTION_MIGRATIONS_DIR}; never use the development migration chain`);
  if (d1?.migrations_pattern !== undefined) errors.push("custom production migrations_pattern is not allowed until migration history is reconciled");
  if (migrationFiles.some((file) => file.toLowerCase().endsWith(".sql"))) errors.push("production migrations are blocked until the live schema and migration history are reconciled; archive historical SQL outside the active directory");
  const queueConfig = record(config.queues);
  const producers = Array.isArray(queueConfig?.producers) ? queueConfig.producers : [];
  const producer = producers.map(record).find((item) => item?.binding === "PUBLISH_QUEUE");
  if (!producer || producer.queue !== "tg-ad-manager-publish") errors.push("PUBLISH_QUEUE producer does not match the audited queue");
  const crons = record(config.triggers)?.crons;
  if (!Array.isArray(crons) || !crons.includes("*/5 * * * *")) errors.push("5-minute Cron trigger is missing");
  if (JSON.stringify(config).includes("REPLACE_WITH")) errors.push("production config still contains a placeholder");
  return errors;
}
