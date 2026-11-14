import { expect, test, type Page } from "@playwright/test";

const groupHref = "/home?create=1&mode=video&match=1";
const privateTriggerName = "Private hangout";
const dialogTitle = "Your people. Your plans.";
const privateWays = [
  { name: "Video call", href: "/home?create=1&mode=video" },
  { name: "Voice call", href: "/home?create=1&mode=voice" },
  { name: "Text chat", href: "/home?create=1&mode=chat" },
  { name: "Play in a call", href: "/home?create=1&mode=video&games=1" },
] as const;
const unexpectedWrites = new WeakMap<Page, string[]>();

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    const fit = await dialog.evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, viewport: innerWidth }));
    expect(fit.content).toBeLessThanOrEqual(fit.width + 1);
    expect(fit.left).toBeGreaterThanOrEqual(0);
    expect(fit.right).toBeLessThanOrEqual(fit.viewport);
  }
}

test.beforeEach(async ({ page }) => {
  // Opening the public page or its chooser must never create an account or
  // request capture. Record and stop accidental calls instead of granting them.
  const writes: string[] = [];
  unexpectedWrites.set(page, writes);
  await page.route("**/*", async route => {
    if (route.request().method() === "POST") {
      writes.push(new URL(route.request().url()).pathname);
      await route.abort();
    } else await route.continue();
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("landing-device-requests", "0");
    const denyCapture = () => {
      sessionStorage.setItem("landing-device-requests", "1");
      return Promise.reject(new Error("Landing must not request media"));
    };
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.getUserMedia = denyCapture;
    navigator.mediaDevices.getDisplayMedia = denyCapture;
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => sessionStorage.getItem("landing-device-requests"))).toBe("0");
  expect(unexpectedWrites.get(page)).toEqual([]);
});

test("landing keeps group matching primary and private choices behind one button", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByTestId("giggle-hero");
  await expect(hero).toBeVisible();
  await expect(hero.getByRole("heading", { level: 1, name: /^Good company\.\s*Great chaos\.$/ })).toBeVisible();
  await expect(hero.getByRole("link", { name: "Start your group", exact: true })).toHaveAttribute("href", groupHref);
  await expect(hero.getByRole("link")).toHaveCount(1);
  await expect(hero.getByRole("radio")).toHaveCount(0);
  await expect(hero.getByRole("radiogroup")).toHaveCount(0);
  await expect(hero.getByRole("button", { name: privateTriggerName, exact: true })).toHaveAttribute("aria-haspopup", "dialog");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoOverflow(page);
});

test("private chooser links preserve each call mode and games intent without matching", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByTestId("giggle-hero");
  await hero.getByRole("button", { name: privateTriggerName, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: dialogTitle, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  for (const way of privateWays) {
    const link = dialog.getByRole("link", { name: way.name, exact: way.name === "Play in a call" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", way.href);
    const destination = new URL((await link.getAttribute("href"))!, page.url());
    expect(destination.origin).toBe(new URL(page.url()).origin);
    expect(destination.searchParams.get("create")).toBe("1");
    expect(destination.searchParams.has("match")).toBe(false);
    expect(destination.searchParams.get("games")).toBe(way.name === "Play in a call" ? "1" : null);
  }
  const gamesHref = await page.getByRole("navigation", { name: "Explore Giggle" }).getByRole("link", { name: "Games", exact: true }).getAttribute("href");
  expect(gamesHref).toBeTruthy();
  await expect(dialog.getByRole("link", { name: "Games only", exact: true })).toHaveAttribute("href", gamesHref!);
  await expect(dialog.getByRole("link")).toHaveCount(5);
  await expect(hero.getByRole("link", { name: "Start your group", exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("keyboard reaches the chooser, stays inside it and returns to its trigger on Escape", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByTestId("giggle-hero");
  const brand = page.getByRole("link", { name: "Giggle Meet home", exact: true });
  await brand.focus();
  for (const link of await page.getByRole("navigation", { name: "Explore Giggle" }).getByRole("link").all()) {
    if (!(await link.isVisible())) continue;
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(hero.getByRole("link", { name: "Start your group", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const trigger = hero.getByRole("button", { name: privateTriggerName, exact: true });
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: dialogTitle, exact: true });
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: "Games only", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  for (const link of await dialog.getByRole("link").all()) {
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(close).toBeFocused();
  await close.click();
  await expect(trigger).toBeFocused();
});

test("brand marker and product label fit without clipping or browser failures", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", request => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  await page.goto("/");
  await page.getByTestId("giggle-hero").waitFor();
  await page.evaluate(() => document.fonts.ready);
  const brand = page.getByRole("link", { name: "Giggle Meet home", exact: true });
  await expect(brand).toBeVisible();
  const fit = await brand.evaluate(link => {
    const word = link.querySelector<HTMLElement>(".wordmark")!;
    const marker = word.querySelector("svg")!;
    const name = marker.nextElementSibling!;
    const product = name.querySelector("span")!;
    const bounds = (node: Element) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return { word: bounds(word), marker: bounds(marker), name: bounds(name), product: bounds(product), productVisible: getComputedStyle(product).display !== "none", width: innerWidth };
  });
  expect(fit.word.left).toBeGreaterThanOrEqual(0);
  expect(fit.word.right).toBeLessThanOrEqual(fit.width);
  expect(fit.marker.width).toBeGreaterThan(0);
  expect(fit.marker.right).toBeLessThanOrEqual(fit.name.left + 1);
  expect(Math.abs((fit.marker.top + fit.marker.bottom) / 2 - (fit.name.top + fit.name.bottom) / 2)).toBeLessThanOrEqual(1);
  if (fit.width > 800) {
    expect(fit.productVisible).toBe(true);
    expect(fit.product.right).toBeLessThanOrEqual(fit.word.right + 1);
    expect(fit.product.top).toBeGreaterThanOrEqual(fit.word.top - 1);
    expect(fit.product.bottom).toBeLessThanOrEqual(fit.word.bottom + 1);
  }
  await expectNoOverflow(page);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("reduced motion stops landing entrances, button movement and dialog reveal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const hero = page.getByTestId("giggle-hero");
  const start = hero.getByRole("link", { name: "Start your group", exact: true });
  await start.hover();
  await expect(start).toHaveCSS("transform", "none");
  await expect(start.locator("svg")).toHaveCSS("transform", "none");
  await page.mouse.down();
  await expect(start).toHaveCSS("transform", "none");
  // Release away from the link so this press check cannot start a group.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  const art = hero.locator("img").locator("..");
  await expect(art).toHaveCSS("animation-name", "none");
  const durations = await start.evaluate(node => getComputedStyle(node).transitionDuration.split(",").map(value => parseFloat(value)));
  expect(durations.every(value => value <= 0.000001)).toBe(true);
  const privateTrigger = hero.getByRole("button", { name: privateTriggerName, exact: true });
  await privateTrigger.hover();
  await expect(privateTrigger.locator("svg")).toHaveCSS("transform", "none");
  await privateTrigger.click();
  const dialog = page.getByRole("dialog", { name: dialogTitle, exact: true });
  await expect(dialog).toHaveCSS("animation-name", "none");
  await expect(dialog).toHaveCSS("transform", "none");
  await expectNoOverflow(page);
});
