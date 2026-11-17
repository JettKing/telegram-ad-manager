import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  const migrationsDir = join(process.cwd(), "apps/api/migrations");
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const numbers = files.map((file) => Number(file.slice(0, 4)));
  const expected = numbers.map((_, index) => index + 1);

  if (files.length === 0 || numbers.some((number, index) => number !== expected[index])) {
    throw new Error(`Migration files must start at 0001 and be contiguous: ${files.join(", ")}`);
  }

  for (const file of files) {
    const content = await readFile(join(migrationsDir, file), "utf8");
    if (!/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i.test(content)) {
      throw new Error(`${file} has no schema statement`);
    }
  }

  console.log(`Validated ${files.length} ordered migration files: ${files.join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
