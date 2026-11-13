import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/access-e2e",
  outputDir: "test-results/access",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3120", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm start --port 3120",
    url: "http://127.0.0.1:3120/api/health",
    reuseExistingServer: false,
    env: {
      AI_MODE: "mock",
      AI_API_KEY: "",
      REVIEW_AUTH_MODE: "legacy-test",
      REVIEW_DATA_DIR: ".local-data/access-e2e",
      REVIEW_ACCESS_USERS: JSON.stringify([
        { id: "alice", token: "synthetic-alice-token-for-local-test-123456" },
        { id: "bob", token: "synthetic-bob-token-for-local-test-654321" },
      ]),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
