import { expect, test } from '@playwright/test';

// Opt-in: creates synthetic users against the running local API, without mocks.
test.skip(process.env.GIGGLE_LOCAL_AUTH_E2E !== 'true', 'Requires local API with DEV_AUTH_ENABLED=true');

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`local dev sign-in opens the app at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Google sign-in is not configured locally');
    const devButton = page.getByRole('button', { name: 'Use dev account', exact: true });
    await expect(devButton).toBeEnabled();
    const bounds = await devButton.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await devButton.click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Confirm your age' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Confirm your age' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
