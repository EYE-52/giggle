import { expect, test } from "@playwright/test";

test("landing exposes the product and one primary start action", async ({ page }, testInfo) => {
  await page.goto("/");

  const hero = page.getByTestId("giggle-hero");
  await expect(hero).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /your squad.*their squad.*live/i })).toBeVisible();
  await expect(hero.getByRole("link", { name: /get started/i })).toHaveAttribute("href", "/signin");

  await page.screenshot({
    path: `artifacts/visual-audit/2026-07-12/landing/${testInfo.project.name}-baseline.png`,
  });
});

test("landing stays within the viewport without browser failures", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", request => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`);
  });

  await page.goto("/");
  await page.getByTestId("giggle-hero").waitFor();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("landing navigation, start action, and legal links work by keyboard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One desktop check covers the public keyboard contract");
  await page.goto("/");

  const privacy = page.getByRole("link", { name: "Privacy" });
  const terms = page.getByRole("link", { name: "Terms" });
  await expect(privacy).toHaveAttribute("href", "/privacy");
  await expect(terms).toHaveAttribute("href", "/terms");

  for (const name of ["How it works", "Features", "Sign in", "Get started"]) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole(name === "How it works" || name === "Features" ? "button" : "link", { name, exact: true }).first()).toBeFocused();
  }

  const start = page.getByRole("link", { name: "Get started", exact: true }).first();
  expect(await start.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/signin$/);
});

test("cinematic story exposes one readable scene at every scroll checkpoint", async ({ page }, testInfo) => {
  await page.goto("/");

  const story = page.getByTestId("use-case-story");
  await expect(story).toBeVisible();
  const video = story.locator("video");
  await expect(video).toHaveAttribute("poster", "/landing/demo-poster.jpg");

  for (const [name, progress, title] of [
    ["start", 0.16, "Your squad forms"],
    ["middle", 0.5, "Matched by vibe"],
    ["end", 0.84, "You're live. 2v2."],
  ] as const) {
    await story.evaluate((node, value) => {
      const section = node as HTMLElement;
      const scrollableDistance = section.offsetHeight - window.innerHeight;
      window.scrollTo({ top: section.offsetTop + scrollableDistance * value, behavior: "instant" });
    }, progress);

    const caption = story.locator('[data-testid="demo-caption"][aria-hidden="false"]');
    await expect(caption).toHaveCount(1);
    await expect(caption.getByRole("heading", { name: title })).toBeVisible();
    await expect.poll(() => caption.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
    await expect.poll(() => video.evaluate((node, target) => {
      const media = node as HTMLVideoElement;
      return media.readyState >= 2 && media.duration > 0
        && Math.abs((media.currentTime / media.duration) - Number(target)) < 0.08;
    }, progress)).toBe(true);

    const frame = await video.evaluate(node => {
      const media = node as HTMLVideoElement;
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 18;
      const context = canvas.getContext("2d");
      if (!context) return { range: 0, litRatio: 0 };
      context.drawImage(media, 0, 0, canvas.width, canvas.height);
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
    });
    expect(frame.range).toBeGreaterThan(24);
    expect(frame.litRatio).toBeGreaterThan(0.08);

    await page.screenshot({
      path: `artifacts/visual-audit/2026-07-12/landing-story/${testInfo.project.name}-${name}.jpg`,
      type: "jpeg",
      quality: 82,
    });
  }
});

test("cinematic story respects reduced motion", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One desktop check covers the media preference contract");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const story = page.getByTestId("use-case-story");
  await expect(story.getByRole("heading", { name: "Matched by vibe" })).toBeVisible();
  await expect(story.getByRole("button", { name: /explore features/i })).toBeVisible();
  await expect(story.getByTestId("demo-poster")).toBeVisible();
  await expect(story.locator("video")).toHaveCount(0);
  expect(await story.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(1100);

  await story.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-12/landing-story/desktop-reduced-motion.jpg",
    type: "jpeg",
    quality: 82,
  });
});
