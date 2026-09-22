import { defineConfig } from "@playwright/test";

const viewports = {
  phone: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1280, height: 800 },
  desktop: { width: 1440, height: 1100 },
  wide: { width: 1728, height: 1117 },
};

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  outputDir: "artifacts/playwright-results",
  snapshotPathTemplate: "artifacts/playwright-snapshots/{testFilePath}/{arg}-{projectName}{ext}",
  use: {
    baseURL: "http://localhost:4011",
    // Skip the one-time avatar picker; local-auth.spec.ts covers it explicitly.
    storageState: "e2e/avatar-prompted.json",
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --dir ../../server start",
      url: "http://localhost:3001/health",
      env: {
        ...process.env,
        PORT: "3001",
        NODE_ENV: "development",
        AGE_VERIFICATION_BYPASS: "true",
        JWT_SECRET: "giggle-e2e-only-secret",
        MONGODB_URI: "mongodb://127.0.0.1:27017/giggle",
        MONGODB_DB_NAME: "giggle-e2e",
        REDIS_URL: "redis://127.0.0.1:6379/15",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec next dev -p 4011",
      url: "http://localhost:4011",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: Object.entries(viewports).map(([name, viewport]) => ({
    name,
    use: { browserName: "chromium", viewport },
  })),
});
