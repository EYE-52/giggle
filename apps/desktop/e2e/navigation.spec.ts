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

test("a saved look follows the header through the navigation breakpoint", async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "One browser resizes through both layouts");
  await openProtectedRoute(page, "/profile");
  await page.getByRole("radio", {name:"Clay", exact:true}).click();
  await page.getByRole("radio", {name:"Grape", exact:true}).click();
  await page.getByRole("radio", {name:"Dark", exact:true}).click();
  await page.reload();
  await expect(page.getByRole("radio", {name:"Clay", exact:true})).toBeChecked();
  const header = page.locator(".gg-header");
  const desktop = page.getByTestId("desktop-navigation");
  const mobile = page.getByTestId("mobile-navigation");
  for (const width of [601, 720, 721, 1280]) {
    await page.setViewportSize({width, height:800});
    await expect(width <= 720 ? mobile : desktop).toBeVisible();
    await expect(width <= 720 ? desktop : mobile).toBeHidden();
    const avatar = await header.getByRole("link", {name:"Your profile"}).boundingBox();
    expect(avatar!.x + avatar!.width).toBeLessThanOrEqual(width);
  }
  await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.goto("/");
  await expect(page.getByRole("banner")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const paletteBackground = await page.locator("html").evaluate(el => getComputedStyle(el).getPropertyValue("--bg").trim());
  expect(paletteBackground).not.toBe("");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", paletteBackground);
});
