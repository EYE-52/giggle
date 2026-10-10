import { expect, test } from "@playwright/test";
import { openProtectedRoute } from './helpers';

test("navigation is curated for each device class", async ({ page }, testInfo) => {
  await openProtectedRoute(page, '/home');
  await expect(page.getByRole("main")).toBeVisible();
  for (const name of ["Friends", "Squads"]) {
    await expect(page.getByRole("main").getByRole("region", { name, exact: true }).getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Your squad", exact: true }).getByRole("button", { name: "Start a squad", exact: true })).toBeEnabled();
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
    // Home owns tab-bar clearance; its sticky squad action must remain above the navigation.
    const mainPadding = await page.locator("#main-content .gg-home-people").evaluate(node => parseFloat(getComputedStyle(node).paddingBottom));
    expect(mainPadding).toBeGreaterThanOrEqual(navBox!.height);
    const start = page.getByRole("region", { name: "Your squad", exact: true }).getByRole("button", { name: "Start a squad", exact: true });
    await expect(start).toBeInViewport();
    const startBox = await start.boundingBox();
    expect(startBox!.y + startBox!.height).toBeLessThanOrEqual(navBox!.y);
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
