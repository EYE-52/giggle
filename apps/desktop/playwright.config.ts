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
    baseURL: "http://localhost:4000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:4000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: Object.entries(viewports).map(([name, viewport]) => ({
    name,
    use: { browserName: "chromium", viewport },
  })),
});
