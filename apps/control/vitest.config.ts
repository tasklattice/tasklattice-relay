import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Work integration suites share a real durable queue. A worker in one
    // file must not claim another file's synthetic runs with its test adapter.
    ...(process.env.WORK_TEST_DATABASE_URL ? { fileParallelism: false } : {}),
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
