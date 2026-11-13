import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/model-e2e",
  outputDir: "test-results/model",
  fullyParallel: true,
  workers: 2,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/model", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3110",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node tests/mocks/model-server.mjs",
      url: "http://127.0.0.1:3310/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm start --port 3110",
      url: "http://127.0.0.1:3110/api/health",
      reuseExistingServer: false,
      env: {
        AI_MODE: "live",
        AI_PROVIDER: "controlled-test",
        AI_BASE_URL: "http://127.0.0.1:3310",
        AI_MODEL: "controlled-model",
        AI_API_KEY: "synthetic-test-key",
        AI_TIMEOUT_MS: "10000",
        AI_MAX_CALLS_PER_REVIEW: "12",
        REVIEW_AUTH_MODE: "legacy-test",
        REVIEW_DATA_DIR: ".local-data/model-e2e",
        NEXT_TELEMETRY_DISABLED: "1",
        REVIEW_ACCESS_USERS: "",
      },
    },
  ],
});
