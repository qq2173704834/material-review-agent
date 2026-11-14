import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/assistant-e2e",
  workers: 1,
  timeout: 45000,
  outputDir: "test-results/assistant",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3145" },
  webServer: [
    {
      command: "node tests/mocks/assistant-model-server.mjs",
      url: "http://127.0.0.1:3311/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm start --port 3145",
      url: "http://127.0.0.1:3145/api/health",
      reuseExistingServer: false,
      env: {
        AI_MODE: "live",
        AI_MAX_ATTEMPTS: "1",
        AI_PROVIDER: "controlled-assistant",
        AI_BASE_URL: "http://127.0.0.1:3311",
        AI_MODEL: "synthetic-assistant",
        AI_API_KEY: "synthetic-test-key",
        AI_TIMEOUT_MS: "5000",
        REVIEW_AUTH_MODE: "accounts",
        REVIEW_DATA_DIR: ".local-data/assistant-e2e",
        EXAM_SCHEDULER: "off",
        ASSISTANT_ENABLED: "on",
        ASSISTANT_HOURLY_LIMIT: "20",
      },
    },
  ],
});
