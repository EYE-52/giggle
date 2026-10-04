import { expect, test } from '@playwright/test';
import { openProtectedRoute } from './helpers';

test.skip(process.env.GIGGLE_LOCAL_AUTH_E2E !== 'true', 'Uses a disposable squad on the local development API');

test('invitation retry keeps focus trapped and closing restores the lobby opener', async ({ page }) => {
  await openProtectedRoute(page, '/home');
  await page.getByRole('button', { name: /^(Start a squad|Start another squad)$/ }).click();
  await page.getByLabel('Squad name').fill(`Invite QA ${Date.now()}`);
  await page.getByRole('button', { name: 'Create squad', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invite friends', exact: true })).toBeVisible();

  let friendLoads = 0;
  let friendsAvailable = false;
  // Keep the outage active through development StrictMode's repeated mount.
  await page.route('**/api/friends', route => {
    friendLoads++;
    return route.fulfill({
      status: friendsAvailable ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(friendsAvailable
        ? { ok: true, data: { friends: [] } }
        : { ok: false, error: { code: 'UNAVAILABLE', message: 'Temporary test outage' } }),
    });
  });
  try {
    const opener = page.getByRole('button', { name: 'Invite friends', exact: true });
    await opener.click();
    await page.getByRole('button', { name: 'Choose friends on Giggle', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Invite people to Invite QA/ });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    const retry = dialog.getByRole('button', { name: 'Retry friends', exact: true });
    await expect(retry).toBeVisible();
    await retry.press('Tab');
    await expect(close).toBeFocused();
    await close.press('Shift+Tab');
    await expect(retry).toBeFocused();
    const failedLoads = friendLoads;
    friendsAvailable = true;
    await retry.click();
    await expect(dialog.getByText('No friends yet — use Search to invite anyone.')).toBeVisible();
    expect(friendLoads).toBe(failedLoads + 1);
    await expect(close).toBeFocused();
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    const input = dialog.getByPlaceholder('Search anyone by name…');
    await expect(input).toBeFocused();
    await input.press('Tab');
    await expect(close).toBeFocused();
    await close.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  } finally {
    await page.unroute('**/api/friends');
    // Only the disposable squad created above is removed.
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Squad settings', exact: true }).click();
    await page.getByRole('button', { name: 'Leave squad', exact: true }).click();
    await page.getByRole('dialog', { name: 'Leave this squad?' }).getByRole('button', { name: 'Leave squad', exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
  }
});
