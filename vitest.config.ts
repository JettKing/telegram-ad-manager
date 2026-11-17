import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tg-ad-manager/contracts": path.join(rootDir, "packages/contracts/src/index.ts"),
      "@tg-ad-manager/telegram": path.join(rootDir, "packages/telegram/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
