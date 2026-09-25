import { expect, test } from "@playwright/test";
import { openProtectedRoute } from './helpers';

test("app shell exposes keyboard navigation and readable text tokens", async ({ page }, testInfo) => {
  test.skip(!["phone", "desktop"].includes(testInfo.project.name), "One compact and one full shell cover this contract");

  await openProtectedRoute(page, '/home');
  await expect(page.getByRole("heading", { level: 1, name: /your squad|start a squad/i })).toBeVisible();

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  expect(await skipLink.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  const contrastRatios = await page.evaluate(() => {
    const parse = (value: string) => {
      let match = value.match(/^rgba?\(([^)]+)\)$/i);
      if (match) {
        const [r, g, b] = match[1].split(",").map(part => Number(part.trim()));
        return [r, g, b].map(channel => channel / 255);
      }
      match = value.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?:\/[\d.]+)?\)$/i);
      if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
      match = value.match(/^#([0-9a-f]{6})$/i);
      if (match) return [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
      throw new Error(`Expected a computed color, received ${value}`);
    };
    const luminance = (rgb: number[]) => rgb
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (foreground: string, background: string) => {
      const [lighter, darker] = [luminance(parse(foreground)), luminance(parse(background))].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const root = document.documentElement;
    // The look system (lib/look.ts) drives tokens via data-palette + data-mode;
    // text tiers like --text-body are color-mix() derivations, so resolve them
    // on a probe element instead of reading the raw custom property.
    const PALETTES = ["raspberry", "grape", "lagoon", "moss", "honey", "petrol"];
    const originalPalette = root.getAttribute("data-palette");
    const originalMode = root.getAttribute("data-mode");
    const originalTheme = root.getAttribute("data-theme");
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const results = PALETTES.flatMap(palette => ["light", "dark"].flatMap(mode => {
      root.setAttribute("data-palette", palette);
      root.setAttribute("data-mode", mode);
      root.setAttribute("data-theme", mode);
      const styles = getComputedStyle(root);
      const background = styles.getPropertyValue("--bg").trim();
      return ["--text", "--text-body", "--text-muted"].map(token => {
        probe.style.color = `var(${token}, transparent)`;
        return ratio(getComputedStyle(probe).color, background);
      });
    }));
    probe.remove();
    if (originalPalette) root.setAttribute("data-palette", originalPalette);
    if (originalMode) root.setAttribute("data-mode", originalMode);
    if (originalTheme) root.setAttribute("data-theme", originalTheme);
    return results;
  });
  for (const ratio of contrastRatios) expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test("phone shell keeps primary touch targets at least 44 CSS pixels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Phone-only touch contract");

  await openProtectedRoute(page, '/home');
  const targets = page.getByTestId("mobile-navigation").getByRole("link");
  await expect(targets).toHaveCount(4);

  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  for (const target of [
    page.getByRole("link", { name: "Giggle home" }),
    page.getByRole("button", { name: "Notifications" }),
  ]) {
    const box = await target.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});
