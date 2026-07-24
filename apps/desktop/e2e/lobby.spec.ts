import { expect, test } from "@playwright/test";

test("lobby makes readiness and device state explicit in the first viewport", async ({ page }, testInfo) => {
  await page.goto("/home");
  await page.getByRole("button", { name: /create squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);

  const readiness = page.getByTestId("lobby-readiness");
  await expect(readiness).toBeVisible();
  await expect(readiness.getByText(/used in this lobby and live encounters/i)).toBeVisible();
  await readiness.getByRole("button", { name: /enable camera and microphone/i }).click();
  await expect(readiness.getByRole("button", { name: "Mute microphone" })).toHaveAttribute("aria-pressed", "true");
  await expect(readiness.getByRole("button", { name: "Turn off camera" })).toHaveAttribute("aria-pressed", "true");

  const findMatch = readiness.getByRole("button", { name: /find a match/i });
  await expect(findMatch).toBeDisabled();
  await readiness.getByRole("button", { name: /mark ready/i }).click();
  await expect(findMatch).toBeEnabled();
  await expect(readiness.getByRole("button", { name: "Ready", exact: true })).toBeVisible();

  const box = await readiness.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y + box.height).toBeLessThanOrEqual(viewport!.height);

  await page.screenshot({
    path: `artifacts/visual-audit/2026-07-12/lobby/${testInfo.project.name}.jpg`,
    type: "jpeg",
    quality: 82,
  });
});

test("short phones keep the readiness controls above the fold", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "The short-phone contract is a phone-only override");
  await page.setViewportSize({ width: 390, height: 650 });
  await page.goto("/home");
  await page.getByRole("button", { name: /create squad/i }).click();
  await page.waitForURL(/\/lobby\?squad=/);

  const readiness = page.getByTestId("lobby-readiness");
  await expect(readiness).toBeVisible();
  await expect(readiness.getByRole("button", { name: /enable camera and microphone/i })).toBeVisible();
  await expect.poll(() => readiness.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  const box = await readiness.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(650);

  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-12/lobby/short-phone.jpg",
    type: "jpeg",
    quality: 82,
  });
});
