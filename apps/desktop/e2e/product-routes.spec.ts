import { expect, test } from "@playwright/test";
import { openProtectedRoute } from './helpers';

const routes = [
  { path: "/home", slug: "home", heading: /your squad|start a squad/i, action: /start a squad/i },
  { path: "/discover", slug: "discover", heading: /discover squads/i, action: /surprise me|create a squad|preview/i },
  { path: "/friends", slug: "friends", heading: /^friends$/i, action: /search (?:people )?by name/i },
  { path: "/profile", slug: "profile", heading: /.+/, action: /edit avatar/i },
  { path: "/premium", slug: "premium", heading: /^wallet$/i, action: /^back$/i },
] as const;

for (const route of routes) {
  test(`${route.path} exposes one clear first task without runtime failures`, async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    let openingRoute = true;
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", request => {
      const error = request.failure()?.errorText ?? "failed";
      if (!(openingRoute && error === "net::ERR_ABORTED")) {
        failedRequests.push(`${request.method()} ${request.url()} ${error}`);
      }
    });

    await openProtectedRoute(page, route.path);
    openingRoute = false;
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: route.heading }).first()).toBeVisible();

    const command = main.getByRole("button", { name: route.action })
      .or(main.getByRole("link", { name: route.action }))
      .or(main.getByRole("textbox", { name: route.action }))
      .first();
    await expect(command).toBeVisible();
    if (route.slug === "premium") {
      await expect(main.getByText(/launching soon/i)).toBeVisible();
      await expect(main.getByRole("button", { name: /buy|subscribe|checkout/i })).toHaveCount(0);
    }
    await expect.poll(() => page.locator("#main-content > div").evaluate(node => getComputedStyle(node).opacity)).toBe("1");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);

    await page.screenshot({
      path: `artifacts/visual-audit/2026-07-12/product-routes/${route.slug}-${testInfo.project.name}.jpg`,
      type: "jpeg",
      quality: 82,
    });
  });
}

test("compact phone routes keep their primary action usable without clipping", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One isolated project covers the extra compact viewports");

  for (const [viewport, width, height] of [
    ["compact-phone", 320, 568],
    ["phone-landscape", 844, 390],
  ] as const) {
    await page.setViewportSize({ width, height });

    for (const route of routes) {
      await openProtectedRoute(page, route.path);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: route.heading }).first()).toBeVisible();

      const command = main.getByRole("button", { name: route.action })
        .or(main.getByRole("link", { name: route.action }))
        .or(main.getByRole("textbox", { name: route.action }))
        .first();
      await expect(command).toBeInViewport({ ratio: 0.6 });
      await expect.poll(() => page.locator("#main-content > div").evaluate(node => getComputedStyle(node).opacity)).toBe("1");

      const box = await command.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect(box && box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

      await page.screenshot({
        path: `artifacts/visual-audit/2026-08-02/product-routes/${viewport}-${route.slug}.jpg`,
        type: "jpeg",
        quality: 82,
      });
    }
  }
});

test("join code field uses one shared focus ring", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Phone covers the reported compact field state");

  await openProtectedRoute(page, "/home");
  const input = page.getByRole("textbox", { name: "Squad invite code" });
  await input.focus();

  const hasBoxShadow = (node: HTMLElement) => {
    const shadow = getComputedStyle(node).boxShadow;
    return Boolean(shadow && shadow !== "none");
  };
  // Exactly one ring: on the field itself, not doubled on the surrounding card.
  await expect.poll(() => input.evaluate(hasBoxShadow)).toBe(true);
  expect(await input.locator("..").evaluate(hasBoxShadow)).toBe(false);
});
