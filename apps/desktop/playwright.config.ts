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
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec next dev -p 4011",
    url: "http://localhost:4011",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: Object.entries(viewports).map(([name, viewport]) => ({
    name,
    use: { browserName: "chromium", viewport },
  })),
});
