import { expect, test } from "@playwright/test";
import { openProtectedRoute } from './helpers';

test("lobby makes readiness and device state explicit in the first viewport", async ({ page }, testInfo) => {
  await openProtectedRoute(page, '/home');
  await page.getByRole("button", { name: /create(?: your first)? squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);

  const readiness = page.getByTestId("lobby-readiness");
  await expect(readiness).toBeVisible();
  await expect(readiness.getByText(/used in this lobby and live encounters/i)).toBeVisible();
  const deviceAction = readiness.getByRole("button", { name: /enable camera and microphone/i });
  await expect(deviceAction).toBeVisible();

  const findMatch = page.getByRole("button", { name: /find a match/i });
  await expect(findMatch).toBeDisabled();
  const ready = readiness.getByRole("button", { name: /mark ready/i });
  await ready.click();
  await expect(findMatch).toBeEnabled();
  await expect(readiness.getByRole("button", { name: /ready/i })).toHaveAttribute("aria-pressed", "true");

  const box = await readiness.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y + box.height).toBeLessThanOrEqual(viewport!.height);
  if (testInfo.project.name === "phone") {
    const [deviceBox, readyBox, findMatchBox] = await Promise.all([
      deviceAction.boundingBox(),
      ready.boundingBox(),
      findMatch.boundingBox(),
    ]);
    expect(deviceBox && readyBox && findMatchBox).toBeTruthy();
    expect(findMatchBox!.y).toBeGreaterThanOrEqual(Math.max(deviceBox!.y + deviceBox!.height, readyBox!.y + readyBox!.height) - 1);
    expect(findMatchBox!.width).toBeGreaterThanOrEqual(box!.width - 28);
    expect(findMatchBox!.y + findMatchBox!.height).toBeLessThanOrEqual(viewport!.height);
  }

  await page.screenshot({
    path: `artifacts/visual-audit/2026-07-12/lobby/${testInfo.project.name}.jpg`,
    type: "jpeg",
    quality: 82,
  });
});

test("ready responds before the network round trip finishes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "One desktop project covers the shared ready action");
  await openProtectedRoute(page, "/home");
  await page.getByRole("button", { name: /create(?: your first)? squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);
  await page.route("**/api/squads/*/ready", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  const ready = page.getByTitle("Toggle ready");
  await ready.click();
  await expect(ready).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
  await expect(ready).toContainText("Ready", { timeout: 500 });
  await expect(ready).toBeEnabled({ timeout: 5000 });
});

test("leaving shows local exit feedback before a delayed failure and stays recoverable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "One desktop project covers the shared leave action");
  await openProtectedRoute(page, "/home");
  await page.getByRole("button", { name: /create(?: your first)? squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);

  const readiness = page.getByTestId("lobby-readiness");
  await page.route("**/api/squads/*/leave", async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { message: "Leave is temporarily unavailable." } }) });
  });

  await page.getByRole("button", { name: "Leave", exact: true }).click();
  const leaveDialog = page.getByRole("dialog", { name: "Leave this squad?" });
  await leaveDialog.getByRole("button", { name: /leave.*hand off/i }).click();

  await expect(page.getByRole("button", { name: "Leaving…", exact: true }).first()).toBeVisible({ timeout: 500 });
  await expect(readiness.getByRole("button", { name: /enable camera and microphone/i })).toBeVisible({ timeout: 500 });
  await expect(page).toHaveURL(/\/lobby\?squad=/);
  await expect(page.locator("#main-content").getByText(/leave is temporarily unavailable/i)).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("button", { name: "Leave", exact: true })).toBeEnabled();
});

test("short phones keep the readiness controls above the fold", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "The short-phone contract is a phone-only override");
  await page.setViewportSize({ width: 390, height: 650 });
  await openProtectedRoute(page, '/home');
  await page.getByRole("button", { name: /create(?: your first)? squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);

  const readiness = page.getByTestId("lobby-readiness");
  await expect(readiness).toBeVisible();
  await expect(readiness.getByRole("button", { name: /enable camera and microphone/i })).toBeVisible();
  await expect.poll(() => readiness.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  const box = await readiness.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(650);

  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-12/lobby/short-phone.jpg",
    type: "jpeg",
    quality: 82,
  });
});

test("squad leader can remove another member", async ({ page, browser }, testInfo) => {
  test.skip(!["phone", "laptop"].includes(testInfo.project.name), "Phone and laptop cover the shared member list");

  await openProtectedRoute(page, "/home");
  await page.getByRole("button", { name: /create(?: your first)? squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);
  const squadCode = await page.getByText(/^[A-Z]{3}-\d{3}$/).first().textContent();
  expect(squadCode).toBeTruthy();

  const memberContext = await browser.newContext({ viewport: page.viewportSize() ?? { width: 1280, height: 800 } });
  try {
    const memberPage = await memberContext.newPage();
    await openProtectedRoute(memberPage, "/home");
    await memberPage.getByRole("textbox", { name: "Squad invite code" }).fill(squadCode!);
    await memberPage.getByRole("button", { name: "Join squad" }).click();
    await memberPage.waitForURL(/\/lobby\?squad=/);

    const remove = page.getByRole("button", { name: /remove .+ from squad/i });
    await expect(remove).toBeVisible();
    await remove.click();

    const dialog = page.getByRole("dialog", { name: /remove .+\?/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove member" }).click();

    await expect(remove).toHaveCount(0);
    await expect(memberPage).toHaveURL(/\/home$/);
  } finally {
    await memberContext.close();
  }
});
