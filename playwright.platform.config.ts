import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/platform-e2e",
  outputDir: "test-results/platform",
  workers: 1,
  timeout: 90000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3130", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm start --port 3130",
    url: "http://127.0.0.1:3130/api/health",
    reuseExistingServer: false,
    env: {
      AI_MODE: "mock",
      AI_API_KEY: "",
      REVIEW_AUTH_MODE: "accounts",
      REVIEW_DATA_DIR: ".local-data/platform-e2e",
      EXAM_SCHEDULER: "on",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
