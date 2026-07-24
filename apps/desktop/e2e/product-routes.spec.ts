import { expect, test } from "@playwright/test";

const routes = [
  { path: "/home", slug: "home", heading: /hey,|welcome back/i, action: /create squad/i },
  { path: "/discover", slug: "discover", heading: /discover squads/i, action: /surprise me|create a squad|preview/i },
  { path: "/friends", slug: "friends", heading: /^friends$/i, action: /search by name/i },
  { path: "/profile", slug: "profile", heading: /.+/, action: /edit avatar/i },
  { path: "/premium", slug: "premium", heading: /^wallet$/i, action: /^back$/i },
] as const;

for (const route of routes) {
  test(`${route.path} exposes one clear first task without runtime failures`, async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", request => {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    });

    await page.goto(route.path);
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
