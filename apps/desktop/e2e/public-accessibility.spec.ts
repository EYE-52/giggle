import { expect, test, type Locator } from "@playwright/test";
import { openProtectedRoute } from "./helpers";

async function contrastRatio(target: Locator) {
  return target.evaluate(node => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const parse = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).map(value => value / 255);
    };
    const over = (front: number[], back: number[]) => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3]));
    let background = [1, 1, 1];
    const ancestors: Element[] = [];
    for (let current: Element | null = node; current; current = current.parentElement) ancestors.unshift(current);
    for (const ancestor of ancestors) background = over(parse(getComputedStyle(ancestor).backgroundColor), background);
    const foreground = over(parse(getComputedStyle(node).color), background);
    const luminance = (rgb: number[]) => rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  });
}

for (const mode of ["light", "dark"]) {
test(`public help and recovery controls stay readable and touch-sized on compact screens (${mode})`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(mode => localStorage.setItem("giggle.look", JSON.stringify({ skin: "soft", palette: "honey", mode })), mode);
    for (const [path, eyebrow] of [["/privacy", "Privacy"], ["/terms", "Terms"], ["/safety", "Safety"], ["/support", "Support"]]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await contrastRatio(page.getByText(eyebrow, { exact: true }).filter({ hasNot: page.locator("a") }).first())).toBeGreaterThanOrEqual(4.5);
      const back = page.getByRole("link", { name: "Back home", exact: true });
      expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await back.boundingBox())!.width).toBeGreaterThanOrEqual(44);
      if (path === "/support") {
        const support = page.getByRole("link", { name: "Email account support", exact: true });
        await support.scrollIntoViewIfNeeded();
        expect((await support.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    for (const [path, name] of [["/auth/callback", "← Back to sign in"], ["/join/invalid", "Back to Home"]]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
      const recover = page.getByRole("link", { name, exact: true });
      await expect(recover).toBeVisible();
      expect(await contrastRatio(recover)).toBeGreaterThanOrEqual(4.5);
      expect((await recover.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.goto("/signin");
    expect((await page.getByRole("link", { name: "Terms", exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});
}

test("all appearance skin choices retain a minimum touch target", async ({ page }) => {
  await openProtectedRoute(page, "/profile");
  for (const name of ["Soft Depth", "Bold Play", "Doodle", "Clay", "Scrapbook"]) {
    const choice = page.getByRole("radio", { name: new RegExp(`^${name}`) });
    await choice.scrollIntoViewIfNeeded();
    const box = await choice.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/avatar-playground");
    const animate = page.getByRole("checkbox", { name: "Animate", exact: true });
    const label = animate.locator("..");
    await label.scrollIntoViewIfNeeded();
    await expect(label).toHaveCSS("min-height", "44px");
    const box = (await label.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const stage = page.getByRole("region", { name: "Your character preview", exact: true }).locator(":scope > div").first();
    const stageBefore = await stage.boundingBox();
    const initial = await animate.isChecked();
    await label.click({ position: { x: box.width - 8, y: box.height / 2 } });
    await expect(animate).toBeChecked({ checked: !initial });
    await animate.focus();
    await animate.press("Space");
    await expect(animate).toBeChecked({ checked: initial });
    expect(await stage.boundingBox()).toEqual(stageBefore);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
});
