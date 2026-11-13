import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/source-e2e",
  outputDir: "test-results/sources",
  timeout: 180000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3131", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm start --port 3131",
    url: "http://127.0.0.1:3131/api/health",
    reuseExistingServer: false,
    env: {
      AI_MODE: "mock",
      AI_API_KEY: "",
      REVIEW_AUTH_MODE: "accounts",
      REVIEW_DATA_DIR: ".local-data/source-e2e",
      EXAM_SCHEDULER: "off",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
