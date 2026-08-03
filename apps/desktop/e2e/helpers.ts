import { expect, type Page } from '@playwright/test';

export async function completeAgeGate(page: Page) {
  const gate = page.getByRole('dialog', { name: 'Confirm your age' });
  const main = page.getByRole('main');
  await expect(gate.or(main)).toBeVisible({ timeout: 15_000 });
  if (!(await gate.isVisible())) {
    if (new URL(page.url()).pathname === '/signin') {
      throw new Error('Protected-route test reached /signin; Playwright must run against the development server.');
    }
    return;
  }

  await gate.getByRole('combobox', { name: 'Birth month' }).selectOption('0');
  await gate.getByRole('combobox', { name: 'Birth day' }).selectOption('1');
  await gate.getByRole('combobox', { name: 'Birth year' }).selectOption('2000');
  await gate.getByRole('button', { name: 'Continue' }).click();
  await expect(gate).toBeHidden({ timeout: 15_000 });
  await expect(main).toBeVisible();
}

export async function openProtectedRoute(page: Page, path: string) {
  await page.goto(path);
  await completeAgeGate(page);
}
