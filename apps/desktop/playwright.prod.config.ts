import { defineConfig } from "@playwright/test";

// Production smoke test: runs against the live site with a synthetic test
// account. Kept out of ./e2e so the normal suite never touches production.
export default defineConfig({
  testDir: "./e2e-prod",
  workers: 1,
  outputDir: "artifacts/prod-smoke-results",
  use: {
    launchOptions: { args: ["--mute-audio"] },
    baseURL: process.env.GIGGLE_PROD_WEB_URL
      || (process.env.GIGGLE_SMOKE_LOCAL === "true" ? "http://localhost:4000" : "https://www.gigglemeet.com"),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
