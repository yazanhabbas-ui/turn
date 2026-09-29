import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    // PDF/Excel generation and database resets can exceed the 5 s default on a busy machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
