import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function validateDirectory(migrationsDir: string, expectedStart: number, label: string) {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const numbers = files.map((file) => Number(file.slice(0, 4)));
  const expected = numbers.map((_, index) => index + expectedStart);

  if (files.length === 0 || numbers.some((number, index) => number !== expected[index])) {
    throw new Error(`${label} migration files must be contiguous from ${String(expectedStart).padStart(4, "0")}: ${files.join(", ")}`);
  }

  for (const file of files) {
    const content = await readFile(join(migrationsDir, file), "utf8");
    if (!/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i.test(content)) {
      throw new Error(`${file} has no schema statement`);
    }
  }

  console.log(`Validated ${label}: ${files.length} ordered migration files (${files[0]} … ${files.at(-1)})`);
}

async function main() {
  const root = process.cwd();
  await validateDirectory(join(root, "apps/api/migrations"), 1, "development");
  await validateDirectory(join(root, "apps/api/production-migrations/archive"), 9, "archived production history");
  await validateDirectory(join(root, "apps/api/production-migrations/active"), 18, "active production");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
