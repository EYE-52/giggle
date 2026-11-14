import { expect, test, type Page } from "@playwright/test";

const groupHref = "/home?create=1&mode=video&match=1";
const privateModes = [
  { name: "Video", action: "Start a video call", href: "/home?create=1&mode=video" },
  { name: "Voice", action: "Start a voice call", href: "/home?create=1&mode=voice" },
  { name: "Chat", action: "Start a chat", href: "/home?create=1&mode=chat" },
  { name: "Games", action: "Play in a call", href: "/home?create=1&mode=video&games=1" },
] as const;

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  // A public landing check must not create a dev account or request devices.
  await page.addInitScript(() => {
    window.sessionStorage.setItem("landing-device-requests", "0");
    if (!navigator.mediaDevices) return;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => {
      window.sessionStorage.setItem("landing-device-requests", "1");
      return capture(constraints);
    };
  });
});

test("landing defaults to Group vs group with one primary start action", async ({ page }) => {
  const unexpectedWrites: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST") unexpectedWrites.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  const hero = page.getByTestId("giggle-hero");
  await expect(hero).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /^Good company\.\s*Great nonsense\.$/ })).toBeVisible();
  const purpose = hero.getByRole("group", { name: "Who would you like to meet?" });
  await expect(purpose.getByRole("radio", { name: "Group vs group", exact: true })).toBeChecked();
  await expect(purpose.getByRole("radio", { name: "Private hangout", exact: true })).not.toBeChecked();
  await expect(hero.getByRole("link", { name: "Start your group", exact: true })).toHaveAttribute("href", groupHref);
  await expect(hero.getByRole("link")).toHaveCount(1);
  await expect(hero.getByRole("group", { name: "How would you like to hang out?" })).toHaveCount(0);
  await expectNoOverflow(page);
  expect(await page.evaluate(() => sessionStorage.getItem("landing-device-requests"))).toBe("0");
  expect(unexpectedWrites).toEqual([]);
});

test("private choices keep their call mode and games intent separate from matching", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByTestId("giggle-hero");
  await hero.getByRole("radio", { name: "Private hangout", exact: true }).check();
  const modes = hero.getByRole("group", { name: "How would you like to hang out?" });
  await expect(modes).toBeVisible();
  for (const mode of privateModes) {
    await modes.locator("label").filter({ hasText: new RegExp(`^${mode.name}$`) }).click();
    await expect(modes.getByRole("radio", { name: mode.name, exact: true })).toBeChecked();
    const start = hero.getByRole("link", { name: mode.action, exact: true });
    await expect(start).toHaveAttribute("href", mode.href);
    const destination = new URL((await start.getAttribute("href"))!, page.url());
    expect(destination.origin).toBe(new URL(page.url()).origin);
    expect(destination.searchParams.has("match")).toBe(false);
    if (mode.name === "Games") {
      const standalone = hero.getByRole("link", { name: "Play games only", exact: true });
      await expect(standalone).toBeVisible();
      const gamesHref = await page.getByRole("navigation", { name: "Explore Giggle" }).locator("a").filter({ hasText: /^Games$/ }).getAttribute("href");
      expect(gamesHref).toBeTruthy();
      await expect(standalone).toHaveAttribute("href", gamesHref!);
    } else {
      await expect(hero.getByRole("link", { name: "Play games only", exact: true })).toHaveCount(0);
    }
    await expectNoOverflow(page);
  }
  await hero.getByRole("radio", { name: "Group vs group", exact: true }).check();
  await expect(hero.getByRole("link", { name: "Start your group", exact: true })).toHaveAttribute("href", groupHref);
  await expect(modes).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("landing-device-requests"))).toBe("0");
});

test("purpose and private modes work with native keyboard radio controls", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByTestId("giggle-hero");
  const brand = page.getByRole("link", { name: "Giggle Meet home", exact: true });
  await brand.focus();
  await expect(brand).toBeFocused();
  const navigation = page.getByRole("navigation", { name: "Explore Giggle" });
  for (const link of await navigation.getByRole("link").all()) {
    if (!(await link.isVisible())) continue;
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(hero.getByRole("radio", { name: "Group vs group", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(hero.getByRole("radio", { name: "Private hangout", exact: true })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(hero.getByRole("radio", { name: "Video", exact: true })).toBeFocused();
  for (const mode of privateModes.slice(1)) {
    await page.keyboard.press("ArrowRight");
    await expect(hero.getByRole("radio", { name: mode.name, exact: true })).toBeChecked();
    await expect(hero.getByRole("link", { name: mode.action, exact: true })).toHaveAttribute("href", mode.href);
  }
  await page.keyboard.press("Tab");
  await expect(hero.getByRole("link", { name: "Play in a call", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(hero.getByRole("link", { name: "Play games only", exact: true })).toBeFocused();
  const privacy = page.getByRole("link", { name: "Privacy", exact: true });
  const terms = page.getByRole("link", { name: "Terms", exact: true });
  await expect(privacy).toHaveAttribute("href", "/privacy");
  await expect(terms).toHaveAttribute("href", "/terms");
  await privacy.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/privacy$/);
});

test("brand marker and product label fit without clipping or browser failures", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
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
