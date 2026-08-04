import { expect, type Page } from '@playwright/test';

const verifiedFixtures = new WeakSet<Page>();

async function installVerifiedAdultFixture(page: Page) {
  if (verifiedFixtures.has(page)) return;
  verifiedFixtures.add(page);
  await page.route('**/api/me/profile', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      contentType: 'application/json',
      body: JSON.stringify({
        ...body,
        data: { ...body.data, ageConfirmed: true, isAdult: true, ageVerified: true },
      }),
    });
  });
  await page.route('**/api/me/age/verification-status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { status: 'verified', ageVerified: true } }),
  }));
}

export async function completeAgeGate(page: Page) {
  const gate = page.getByRole('dialog', { name: 'Confirm your age' });
  const main = page.getByRole('main');
  await expect(gate.or(main)).toBeVisible({ timeout: 15_000 });
  if (!(await gate.isVisible())) {
    const returnToVerification = page.getByRole('button', { name: 'Return to age verification' });
    if (await returnToVerification.isVisible()) {
      await returnToVerification.click();
      await expect(gate).toBeVisible({ timeout: 15_000 });
    } else {
      if (new URL(page.url()).pathname === '/signin') {
        throw new Error('Protected-route test reached /signin; Playwright must run against the development server.');
      }
      return;
    }
  }

  await installVerifiedAdultFixture(page);
  const month = gate.getByRole('combobox', { name: 'Birth month' });
  if (await month.isVisible()) {
    await month.selectOption('0');
    await gate.getByRole('combobox', { name: 'Birth day' }).selectOption('1');
    await gate.getByRole('combobox', { name: 'Birth year' }).selectOption('2000');
    await gate.getByRole('button', { name: 'Continue' }).click();
  } else {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }
  await expect(gate).toBeHidden({ timeout: 15_000 });
  await expect(main).toBeVisible();
}

export async function openProtectedRoute(page: Page, path: string) {
  await page.goto(path);
  await completeAgeGate(page);
  if (new URL(page.url()).pathname !== new URL(path, 'http://localhost').pathname) {
    await page.waitForLoadState('networkidle');
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
  }
}
