import { expect, test, type Browser, type Page } from "@playwright/test";

test.setTimeout(60_000);

async function enterQueue(page: Page) {
  await page.goto("/home");
  await page.getByRole("button", { name: /create squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);
  const readiness = page.getByTestId("lobby-readiness");
  await readiness.getByRole("button", { name: /mark ready/i }).click();
  await expect(readiness.getByRole("button", { name: /find a match/i })).toBeEnabled();
  await readiness.getByRole("button", { name: /find a match/i }).click();
  await page.waitForURL(/\/matchmaking\?squad=/);
}

async function createEncounter(page: Page, browser: Browser) {
  const opponentContext = await browser.newContext({ viewport: page.viewportSize() ?? { width: 390, height: 844 } });
  const opponent = await opponentContext.newPage();
  await Promise.all([enterQueue(page), enterQueue(opponent)]);
  await Promise.all([
    page.waitForURL(/\/match\?/, { timeout: 20_000 }),
    opponent.waitForURL(/\/match\?/, { timeout: 20_000 }),
  ]);
  await Promise.all([
    page.getByRole("button", { name: /join encounter/i }).click(),
    opponent.getByRole("button", { name: /join encounter/i }).click(),
  ]);
  await Promise.all([
    page.waitForURL(/\/encounter\?/, { timeout: 10_000 }),
    opponent.waitForURL(/\/encounter\?/, { timeout: 10_000 }),
  ]);
  return opponentContext;
}

test("real encounter keeps media and controls usable across resize", async ({ page, browser }, testInfo) => {
  const opponentContext = await createEncounter(page, browser);
  try {
    const stage = page.getByTestId("encounter-stage");
    const controls = page.getByTestId("call-controls");
    await expect(stage).toBeVisible();
    await expect(controls).toBeVisible();
    await expect(controls.getByRole("button", { name: "Mute microphone" })).toHaveAttribute("aria-pressed", "true");
    await expect(controls.getByRole("button", { name: "Turn camera off" })).toHaveAttribute("aria-pressed", "true");
    await expect(controls.getByRole("button", { name: "End encounter" })).toBeVisible();
    await expect.poll(() => controls.evaluate(node => getComputedStyle(node).opacity)).toBe("1");

    const frames = stage.locator("[data-media-frame]");
    expect(await frames.count()).toBeGreaterThanOrEqual(2);
    for (const frame of await frames.all()) {
      await expect.poll(() => frame.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
      const box = await frame.boundingBox();
      expect(box?.width).toBeGreaterThan(80);
      expect(box?.height).toBeGreaterThan(80);

      const screenshot = await frame.screenshot({ type: "jpeg", quality: 70 });
      const signal = await page.evaluate(async source => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${source}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 18;
        const context = canvas.getContext("2d");
        if (!context) return { range: 0, litRatio: 0 };
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let min = 255;
        let max = 0;
        let lit = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const luminance = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
          min = Math.min(min, luminance);
          max = Math.max(max, luminance);
          if (luminance > 12) lit += 1;
        }
        return { range: max - min, litRatio: lit / (pixels.length / 4) };
      }, screenshot.toString("base64"));
      expect(signal.range).toBeGreaterThan(20);
      expect(signal.litRatio).toBeGreaterThan(0.04);
    }

    for (const mode of ["Grid", "Spotlight", "Focus Opp.", "Versus"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await expect(stage.locator("[data-media-frame]").first()).toBeVisible();
    }

    if (testInfo.project.name === "phone") {
      await controls.getByRole("button", { name: "Chat" }).click();
      await expect(page.getByRole("textbox", { name: "Chat message" })).toBeVisible();
      await page.getByRole("button", { name: "Close chat" }).click();
      await controls.getByRole("button", { name: "Reactions" }).click();
      await expect(page.getByRole("button", { name: "React 👋" })).toBeVisible();
      await page.getByRole("button", { name: "React 👋" }).click();
      await controls.getByRole("button", { name: "Report opponent squad" }).click();
      await expect(controls.getByRole("button", { name: /reported/i })).toBeVisible();
    }

    await page.screenshot({
      path: `artifacts/visual-audit/2026-07-12/encounter/${testInfo.project.name}.jpg`,
      type: "jpeg",
      quality: 82,
    });

    if (testInfo.project.name === "phone") {
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(controls).toBeVisible();
      await expect.poll(() => controls.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
      const box = await controls.boundingBox();
      expect(box && box.y + box.height).toBeLessThanOrEqual(390);
      await page.screenshot({
        path: "artifacts/visual-audit/2026-07-12/encounter/phone-landscape.jpg",
        type: "jpeg",
        quality: 82,
      });
    }

    if (testInfo.project.name === "desktop") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      await page.screenshot({
        path: "artifacts/visual-audit/2026-07-12/encounter/desktop-reduced-motion.jpg",
        type: "jpeg",
        quality: 82,
      });
    }

    await controls.getByRole("button", { name: "End encounter" }).click();
    await expect(page).toHaveURL(/\/home$/);
  } finally {
    await opponentContext.close();
  }
});
