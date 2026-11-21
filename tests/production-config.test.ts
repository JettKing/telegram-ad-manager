import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseProductionConfig, PRODUCTION_MIGRATIONS_DIR, validateProductionConfig } from "../scripts/production-config";

async function actualConfig() {
  return parseProductionConfig(await readFile("wrangler.production.jsonc", "utf8"));
}

describe("production Cloudflare configuration", () => {
  it("parses JSONC comments and trailing commas without corrupting URLs or comment-like string values", () => {
    const config = parseProductionConfig(`{
      // Configuration comment
      "url": "https://example.com/a//b",
      "text": "/* not a comment */",
      "items": [1, 2,], /* block comment */
    }`);
    expect(config).toEqual({ url: "https://example.com/a//b", text: "/* not a comment */", items: [1, 2] });
  });

  it("fails closed on malformed JSONC or a non-object config", () => {
    expect(() => parseProductionConfig('{"broken": }')).toThrow("Invalid production JSONC");
    expect(() => parseProductionConfig("[]")).toThrow("Production config must be an object");
  });

  it("accepts the checked-in configuration and isolated empty migration directory", async () => {
    const files = await readdir(PRODUCTION_MIGRATIONS_DIR);
    expect(validateProductionConfig(await actualConfig(), files)).toEqual([]);
  });

  it("rejects development migrations and automatically runnable production SQL", async () => {
    const config = await actualConfig();
    const db = (config.d1_databases as Record<string, unknown>[])[0];
    db.migrations_dir = "apps/api/migrations";
    expect(validateProductionConfig(config, [])).toContainEqual(expect.stringContaining("never use the development migration chain"));
    db.migrations_dir = PRODUCTION_MIGRATIONS_DIR;
    expect(validateProductionConfig(config, ["0009_media_ingestion.sql"])).toContainEqual(expect.stringContaining("production migrations are blocked"));
    db.migrations_pattern = `${PRODUCTION_MIGRATIONS_DIR}/**/*.sql`;
    expect(validateProductionConfig(config, [])).toContainEqual(expect.stringContaining("custom production migrations_pattern is not allowed"));
  });

  it("rejects duplicate production DB aliases and environment-specific overrides", async () => {
    const config = await actualConfig();
    const databases = config.d1_databases as Record<string, unknown>[];
    databases.push({ ...databases[0], binding: "OTHER", migrations_dir: "apps/api/migrations" });
    config.env = { production: { d1_databases: [{ binding: "DB", migrations_dir: "apps/api/migrations" }] } };
    const errors = validateProductionConfig(config, []);
    expect(errors).toContainEqual(expect.stringContaining("no duplicate database aliases"));
    expect(errors).toContainEqual(expect.stringContaining("environment-specific overrides are not allowed"));
  });
});
