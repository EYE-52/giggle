import { expect, test } from "@playwright/test";

test("app shell preserves theme and exposes keyboard navigation", async ({ page }, testInfo) => {
  test.skip(!["phone", "desktop"].includes(testInfo.project.name), "One compact and one full shell cover this contract");

  await page.goto("/home");
  await expect(page.getByRole("heading", { name: /hey,/i })).toBeVisible();

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  expect(await skipLink.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  const themeToggle = page.getByRole("button", { name: "Switch to light mode" });
  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();

  const contrastRatios = await page.evaluate(() => {
    const parse = (value: string) => {
      const match = value.match(/#([0-9a-f]{6})/i);
      if (!match) throw new Error(`Expected a six-digit color token, received ${value}`);
      return [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
    };
    const luminance = (rgb: number[]) => rgb
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (foreground: string, background: string) => {
      const [lighter, darker] = [luminance(parse(foreground)), luminance(parse(background))].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const root = document.documentElement;
    const originalTheme = root.getAttribute("data-theme");
    const results = ["dark", "light"].flatMap(theme => {
      root.setAttribute("data-theme", theme);
      const styles = getComputedStyle(root);
      const background = styles.getPropertyValue("--bg").trim();
      return ["--text", "--text-body", "--text-muted"].map(token => ratio(styles.getPropertyValue(token).trim(), background));
    });
    if (originalTheme) root.setAttribute("data-theme", originalTheme);
    return results;
  });
  for (const ratio of contrastRatios) expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test("phone shell keeps primary touch targets at least 44 CSS pixels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Phone-only touch contract");

  await page.goto("/home");
  const targets = page.getByTestId("mobile-navigation").getByRole("link");
  await expect(targets).toHaveCount(4);

  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  for (const name of ["Giggle home", "Switch to light mode", "Notifications"]) {
    const box = await page.getByRole(name === "Notifications" ? "button" : name === "Giggle home" ? "link" : "button", { name }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});
