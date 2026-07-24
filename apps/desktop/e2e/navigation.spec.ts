import { expect, test } from "@playwright/test";

test("navigation is curated for each device class", async ({ page }, testInfo) => {
  await page.goto("/home");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: /hey,/i })).toBeVisible();
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
    expect(await page.getByRole("main").evaluate(node => parseFloat(getComputedStyle(node).paddingBottom))).toBeGreaterThanOrEqual(88);
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
