import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, "apps/web"),
  plugins: [react()],
  resolve: {
    alias: {
      "@tg-ad-manager/contracts": path.join(rootDir, "packages/contracts/src/index.ts"),
      "@tg-ad-manager/telegram": path.join(rootDir, "packages/telegram/src/index.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: path.join(rootDir, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
