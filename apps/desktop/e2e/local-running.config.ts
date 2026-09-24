import { defineConfig } from "@playwright/test";
import base from "../playwright.config";

/**
 * Runs specs against the ALREADY RUNNING dev servers (web :4010, API :3001).
 * Never starts or restarts anything. Paths are re-anchored to this config's
 * directory (e2e/) because Playwright resolves them relative to the config file.
 */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: "http://localhost:4010", storageState: "e2e/avatar-prompted.json" },
  webServer: undefined,
  testDir: ".",
  outputDir: "../artifacts/playwright-results-local",
  snapshotPathTemplate: "../artifacts/playwright-snapshots/{testFilePath}/{arg}-{projectName}{ext}",
  projects: (base.projects ?? []).filter(project => project.name === "phone" || project.name === "laptop"),
});
