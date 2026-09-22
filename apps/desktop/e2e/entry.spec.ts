import { expect, test } from '@playwright/test';

test('welcome and sign-in keep their main action reachable on small screens', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const start = page.getByRole('link', { name: 'Create your account' });
    await expect(start).toBeVisible();
    const box = await start.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await start.click();
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
});
