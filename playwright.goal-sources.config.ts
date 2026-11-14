import { defineConfig } from "@playwright/test";
process.env.REVIEW_GOAL_SOURCE_DATA_DIR ??= `.local-data/goal-source-e2e/${Date.now()}-${process.pid}`;
export default defineConfig({
  testDir: "./tests/goal-source-e2e",
  outputDir: "test-results/goal-sources",
  workers: 1,
  timeout: 120000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3146" },
  webServer: {
    command: "pnpm start --port 3146",
    url: "http://127.0.0.1:3146/api/health",
    reuseExistingServer: false,
    env: {
      AI_MODE: "mock",
      AI_API_KEY: "",
      REVIEW_AUTH_MODE: "accounts",
      REVIEW_DATA_DIR: process.env.REVIEW_GOAL_SOURCE_DATA_DIR,
      EXAM_SCHEDULER: "off",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
