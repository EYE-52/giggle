import { expect, test } from "@playwright/test";
import { openProtectedRoute } from './helpers';

test("navigation is curated for each device class", async ({ page }, testInfo) => {
  await openProtectedRoute(page, '/home');
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /your squad|start a squad/i })).toBeVisible();
  await expect.poll(() => page.locator("#main-content > div").evaluate(node => getComputedStyle(node).opacity)).toBe("1");

  const mobile = page.getByTestId("mobile-navigation");
  const top = page.getByTestId("desktop-navigation");

  if (testInfo.project.name === "phone") {
    await expect(mobile).toBeVisible();
    await expect(top).toBeHidden();
    await expect(mobile.getByRole("link")).toHaveCount(4);
    await expect(mobile.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    const navBox = await mobile.boundingBox();
    expect(navBox?.y).toBeGreaterThanOrEqual(760);
    // The scroller is full-width; the centered .gg-app-container carries the nav clearance.
    const mainPadding = await page.locator("#main-content > .gg-app-container").evaluate(node => parseFloat(getComputedStyle(node).paddingBottom));
    expect(mainPadding).toBeGreaterThanOrEqual(navBox!.height);
  } else {
    await expect(top).toBeVisible();
    await expect(mobile).toBeHidden();
  }

  await page.screenshot({
    path: `artifacts/visual-audit/2026-07-12/navigation/${testInfo.project.name}.jpg`,
    type: "jpeg",
    quality: 82,
  });
});
