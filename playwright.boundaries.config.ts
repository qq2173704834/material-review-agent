import { defineConfig, devices } from "@playwright/test";
import { resolve, sep } from "node:path";

// A new, ignored directory per invocation keeps quotas and data independent of other suites.
process.env.REVIEW_BOUNDARY_DATA_DIR ??= `.local-data/platform-boundary-e2e/${Date.now()}-${process.pid}`;
if (
  !resolve(process.env.REVIEW_BOUNDARY_DATA_DIR).startsWith(
    resolve(".local-data/platform-boundary-e2e") + sep,
  )
)
  throw new Error("边界测试只能使用独立的platform-boundary-e2e子目录。");

export default defineConfig({
  testDir: "./tests/platform-boundaries",
  outputDir: "test-results/platform-boundaries",
  workers: 1,
  timeout: 60000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/boundaries", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3132",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm start --port 3132",
    url: "http://127.0.0.1:3132/api/health",
    reuseExistingServer: false,
    env: {
      AI_MODE: "mock",
      AI_API_KEY: "",
      REVIEW_AUTH_MODE: "accounts",
      REVIEW_DATA_DIR: process.env.REVIEW_BOUNDARY_DATA_DIR,
      EXAM_SCHEDULER: "off",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
