import { defineConfig } from "@playwright/test";
process.env.REVIEW_QUALITY_DATA_DIR ??= `.local-data/quality-e2e/${Date.now()}-${process.pid}`;
export default defineConfig({
  testDir: "./tests/quality-e2e",
  outputDir: "test-results/quality",
  workers: 1,
  timeout: 240000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3147" },
  webServer: {
    command: "pnpm start --port 3147",
    url: "http://127.0.0.1:3147/api/health",
    reuseExistingServer: false,
    env: {
      AI_MODE: "live",
      AI_MAX_ATTEMPTS: "1",
      AI_TIMEOUT_MS: "45000",
      REVIEW_AUTH_MODE: "accounts",
      REVIEW_DATA_DIR: process.env.REVIEW_QUALITY_DATA_DIR,
      EXAM_SCHEDULER: "off",
      ASSISTANT_ENABLED: "on",
      ASSISTANT_HOURLY_LIMIT: "5",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
