import { expect, test } from "@playwright/test";

async function enterMatchmaking(page: import("@playwright/test").Page) {
  await page.goto("/home");
  await page.getByRole("button", { name: /create squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);
  const readiness = page.getByTestId("lobby-readiness");
  await readiness.getByRole("button", { name: /mark ready/i }).click();
  await expect(readiness.getByRole("button", { name: /find a match/i })).toBeEnabled();
  await readiness.getByRole("button", { name: /find a match/i }).click();
  await page.waitForURL(/\/matchmaking\?squad=/);
}

test("matchmaking explains progress and keeps cancellation available", async ({ page }, testInfo) => {
  await enterMatchmaking(page);

  await expect(page.getByRole("status")).toContainText(/checking active squads/i);
  await expect(page.getByRole("button", { name: /cancel search/i })).toBeVisible();
  await expect(page.getByText("1 / 4", { exact: true })).toBeVisible();

  await page.screenshot({
    path: `artifacts/visual-audit/2026-07-12/matchmaking/${testInfo.project.name}.jpg`,
    type: "jpeg",
    quality: 82,
  });
});

test("failed cancellation stays in queue and becomes retryable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "One phone check covers the cancel recovery contract");
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.text().includes("cancelSearch failed")) consoleErrors.push(message.text());
  });
  await enterMatchmaking(page);
  await page.route("**/api/squads/*/search/cancel", route => route.abort("failed"));

  await page.getByRole("button", { name: /cancel search/i }).click();

  await expect(page).toHaveURL(/\/matchmaking\?squad=/);
  await expect(page.getByRole("alert").filter({ hasText: /cancel/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /try cancel again/i })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
