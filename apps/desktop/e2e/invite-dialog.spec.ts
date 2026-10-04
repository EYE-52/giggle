import { expect, test } from '@playwright/test';
import { openProtectedRoute } from './helpers';

test.skip(process.env.GIGGLE_LOCAL_AUTH_E2E !== 'true', 'Uses a disposable squad on the local development API');

test('squad invitation and chat panels support keyboard navigation and recovery', async ({ page }) => {
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

    const chatOpener = page.getByRole('button', { name: 'Chat', exact: true });
    await chatOpener.click();
    const chat = page.getByRole('complementary', { name: 'Squad chat', exact: true });
    const composer = chat.getByRole('textbox', { name: 'Chat message', exact: true });
    await expect(composer).toBeFocused();
    await composer.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    await expect(chat).toBeVisible();
    await composer.fill('hello world');
    await composer.press('Home');
    for (let i = 0; i < 5; i++) await composer.press('ArrowRight');
    const addEmoji = chat.getByRole('button', { name: 'Add emoji', exact: true });
    await addEmoji.press('Enter');
    await expect(chat.getByRole('button', { name: 'Smile', exact: true })).toBeFocused();
    await chat.getByRole('button', { name: 'Smile', exact: true }).press('ArrowDown');
    await expect(chat.getByRole('button', { name: 'Fire', exact: true })).toBeFocused();
    await chat.getByRole('button', { name: 'Fire', exact: true }).press('End');
    await expect(chat.getByRole('button', { name: 'Eyes', exact: true })).toBeFocused();
    await chat.getByRole('button', { name: 'Eyes', exact: true }).press('ArrowRight');
    await expect(chat.getByRole('button', { name: 'Smile', exact: true })).toBeFocused();
    await chat.getByRole('button', { name: 'Smile', exact: true }).press('Enter');
    await expect(composer).toHaveValue('hello🙂 world');
    await expect(composer).toBeFocused();
    expect(await composer.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(7);
    await composer.fill('x'.repeat(499));
    await addEmoji.click();
    await chat.getByRole('button', { name: 'Smile', exact: true }).press('Enter');
    await expect(chat.getByRole('alert')).toContainText('Your message is full.');
    await expect(composer).toHaveValue('x'.repeat(499));
    await chat.getByRole('button', { name: 'Smile', exact: true }).press('Escape');
    await expect(chat.getByRole('group', { name: 'Emoji choices' })).toBeHidden();
    await expect(addEmoji).toBeFocused();
    await addEmoji.press('Escape');
    await expect(chat).toBeHidden();
    await expect(chatOpener).toBeFocused();
    await chatOpener.click();
    await expect(composer).toHaveValue('x'.repeat(499));
    await composer.fill('');
    await chat.getByRole('button', { name: 'Close chat', exact: true }).click();
    await expect(chatOpener).toBeFocused();
  } finally {
    await page.unroute('**/api/friends');
    // Only the disposable squad created above is removed.
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const closeChat = page.getByRole('button', { name: 'Close chat', exact: true });
    if (await closeChat.isVisible()) await closeChat.click();
    await page.getByRole('button', { name: 'Squad settings', exact: true }).click();
    await page.getByRole('button', { name: 'Leave squad', exact: true }).click();
    await page.getByRole('dialog', { name: 'Leave this squad?' }).getByRole('button', { name: 'Leave squad', exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
  }
});
