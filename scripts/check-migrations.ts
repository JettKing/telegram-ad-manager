import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * These are continuity declarations, not claims that production history can
 * bootstrap an empty database. Production's archived chain starts at 0009
 * because the earlier live-schema baseline is external to this repository.
 */
const DEVELOPMENT_START = 1;
const PRODUCTION_DECLARED_START = 9;
const PRODUCTION_ARCHIVE_END = 17;
const PRODUCTION_ACTIVE_START = PRODUCTION_ARCHIVE_END + 1;
const DEVELOPMENT_END = 12;
const PRODUCTION_ACTIVE_END = 19;

async function readMigrations(directory: string, label: string) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const numbered = files.map((file) => {
    const match = /^(\d{4})_[a-z0-9][a-z0-9_-]*\.sql$/i.exec(file);
    if (!match) throw new Error(`${label} migration has an invalid filename: ${file}`);
    return { file, number: Number(match[1]) };
  });
  if (numbered.length === 0) throw new Error(`${label} migration directory is empty`);
  for (let index = 1; index < numbered.length; index += 1) {
    if (numbered[index].number !== numbered[index - 1].number + 1) {
      throw new Error(
        `${label} migration history has an undeclared gap or duplicate between ` +
          `${numbered[index - 1].file} and ${numbered[index].file}`,
      );
    }
  }
  return numbered;
}

async function validateRange(directory: string, expectedStart: number, expectedEnd: number, label: string) {
  const migrations = await readMigrations(directory, label);
  if (migrations[0].number !== expectedStart || migrations.at(-1)!.number !== expectedEnd) {
    throw new Error(
      `${label} declared range is ${String(expectedStart).padStart(4, "0")}-` +
        `${String(expectedEnd).padStart(4, "0")}, found ${migrations[0].file} … ${migrations.at(-1)!.file}`,
    );
  }
  for (const { file } of migrations) {
    const content = await readFile(join(directory, file), "utf8");
    if (!/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i.test(content)) {
      throw new Error(`${file} has no schema statement`);
    }
  }
  console.log(
    `Validated ${label}: ${migrations.length} contiguous migration files ` +
      `(${migrations[0].file} … ${migrations.at(-1)!.file})`,
  );
  return migrations;
}

async function main() {
  const root = process.cwd();
  await validateRange(join(root, "apps/api/migrations"), DEVELOPMENT_START, DEVELOPMENT_END, "development");

  const archiveDir = join(root, "apps/api/production-migrations/archive");
  const activeDir = join(root, "apps/api/production-migrations/active");
  const archive = await validateRange(
    archiveDir,
    PRODUCTION_DECLARED_START,
    PRODUCTION_ARCHIVE_END,
    "archived production history",
  );
  const active = await validateRange(
    activeDir,
    PRODUCTION_ACTIVE_START,
    PRODUCTION_ACTIVE_END,
    "active production",
  );

  if (archive.at(-1)!.number + 1 !== active[0].number) {
    throw new Error(`production migration handoff is discontinuous: ${archive.at(-1)!.file} -> ${active[0].file}`);
  }
  console.log(
    `Production continuity declared from ${String(PRODUCTION_DECLARED_START).padStart(4, "0")}; ` +
      `pre-${String(PRODUCTION_DECLARED_START).padStart(4, "0")} schema baseline is external and not validated.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
