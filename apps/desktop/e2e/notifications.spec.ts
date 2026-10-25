import { expect, test } from "@playwright/test";
import { openProtectedRoute } from "./helpers";

test("notification panel keeps keyboard focus visible and offers a touch-sized exit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/notifications**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { notifications: [], unread: 0 } }),
  }));
  await openProtectedRoute(page, "/home");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const main = page.getByRole("main");
  const before = await main.boundingBox();
  const bell = page.getByRole("button", { name: "Notifications", exact: true });
  await expect(bell).toHaveAttribute("aria-haspopup", "dialog");
  await bell.focus();
  await bell.press("Enter");
  const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
  const close = panel.getByRole("button", { name: "Close notifications", exact: true });
  await expect(close).toBeFocused();
  await expect(close).toBeInViewport();
  await expect(close).toHaveCSS("width", "44px");
  await expect(close).toHaveCSS("height", "44px");
  const box = await close.boundingBox();
  expect(Number(box!.width.toFixed(3))).toBeGreaterThanOrEqual(44);
  expect(Number(box!.height.toFixed(3))).toBeGreaterThanOrEqual(44);
  expect(await main.boundingBox()).toEqual(before);

  await close.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(panel).toBeVisible();
  await close.press("Escape");
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();
  await bell.press("Enter");
  await expect(close).toBeFocused();
  await close.press("Tab");
  await expect(page.getByRole("link", { name: "Your profile", exact: true })).toBeFocused();
  await expect(panel).toBeHidden();
  await bell.click();
  await close.click();
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();
  expect(errors).toEqual([]);
});

test("notification outage retry preserves a reachable keyboard focus target", async ({ page }) => {
  let available = false;
  let loads = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/notifications**", route => {
    const get = route.request().method() === "GET";
    if (get) loads++;
    const success = !get || available;
    return route.fulfill({
      status: success ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(success
        ? { ok: true, data: { notifications: [], unread: 0 } }
        : { ok: false, error: { code: "UNAVAILABLE", message: "Isolated notification outage" } }),
    });
  });
  await openProtectedRoute(page, "/home");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  // Let opening's read-all acknowledgement settle before measuring this
  // explicit retry; a concurrent socket/read mutation may legitimately reload.
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
  const close = panel.getByRole("button", { name: "Close notifications", exact: true });
  await expect(panel.getByRole("alert")).toContainText("Couldn't load notifications.");
  await close.press("Tab");
  const retry = panel.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeFocused();
  const failedLoads = loads;
  available = true;
  await retry.press("Enter");
  await expect(panel.getByText("You're all caught up", { exact: true })).toBeVisible();
  await expect(close).toBeFocused();
  expect(loads).toBe(failedLoads + 1);
  await close.press("Escape");
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});
