import { expect, test } from '@playwright/test';

test.skip(process.env.GIGGLE_LOCAL_AUTH_E2E !== 'true', 'Requires local development API');
for (const width of [390, 1440]) {
  test(`real squad lifecycle at ${width}px`, async ({ browser }) => {
    const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, permissions: ['clipboard-read', 'clipboard-write'] })));
    const [leader, friend] = await Promise.all(contexts.map(context => context.newPage()));
    try {
      await leader.goto('/signin');
      await leader.getByRole('button', { name: 'Use dev account', exact: true }).click();
      await leader.getByRole('button', { name: 'Start a squad', exact: true }).click();
      const name = `Flow test ${Date.now()}`;
      await expect(leader.getByLabel('Squad name')).toHaveValue('');
      await leader.getByRole('button', { name: 'Create squad', exact: true }).click();
      await expect(leader.getByText('Give your squad a name.')).toBeVisible();
      await leader.getByLabel('Squad name').fill(name);
      await leader.getByRole('button', { name: 'Create squad', exact: true }).click();
      await expect(leader.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(leader.getByText('None added', { exact: true })).toBeVisible();
      await expect(leader.getByTestId('lobby-person')).toHaveCount(1);
      const card = await leader.getByTestId('lobby-person').boundingBox();
      expect(card!.height).toBeLessThanOrEqual(420);
      await leader.screenshot({ path: `/tmp/giggle-lobby-${width}.png`, fullPage: true });
      for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 720, height: 450 }]) {
        await leader.setViewportSize(viewport);
        await expect(leader.getByTestId('lobby-page')).toBeVisible();
        expect(await leader.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
        const tile = await leader.getByTestId('lobby-person').boundingBox();
        expect(tile!.x).toBeGreaterThanOrEqual(0);
        expect(tile!.x + tile!.width).toBeLessThanOrEqual(viewport.width);
      }
      await leader.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const code = await leader.locator('strong').filter({ hasText: /^[A-Z]{3}-\d{3}$/ }).innerText();
      await friend.goto(`/join/${code}`);
      await expect(friend).toHaveURL(/\/lobby\?squad=/);
      await expect(leader.getByTestId('lobby-person')).toHaveCount(2);
      for (const page of [leader, friend]) await page.getByRole('button', { name: /^Chat/ }).click();
      const message = `Hello squad ${Date.now()}`;
      await leader.getByRole('textbox', { name: 'Chat message' }).fill(message);
      await leader.getByRole('button', { name: 'Send message' }).click();
      await expect(friend.getByText(message, { exact: true })).toBeVisible();
      for (const page of [leader, friend]) await page.getByRole('button', { name: 'Close chat' }).click();
      await expect(leader.getByRole('button', { name: 'Find a squad', exact: true })).toBeDisabled();
      for (const page of [leader, friend]) await page.getByRole('button', { name: "I'm ready", exact: true }).click();
      await expect(leader.getByRole('button', { name: 'Find a squad', exact: true })).toBeEnabled();
      await expect(friend.getByRole('button', { name: 'Find a squad', exact: true })).toHaveCount(0);
      await leader.getByRole('button', { name: 'Find a squad', exact: true }).click();
      const devices = leader.getByRole('dialog', { name: 'Connect your devices' });
      await devices.getByRole('button', { name: 'Enable camera & mic', exact: true }).click();
      await expect(devices.getByRole('alert')).toContainText("Video isn't available right now.");
      await devices.getByRole('button', { name: /close/i }).click();
      await leader.getByRole('button', { name: 'Squad settings', exact: true }).click();
      await leader.getByRole('button', { name: 'Rename squad', exact: true }).click();
      await leader.getByLabel('Squad name').fill(`${name} renamed`);
      await leader.getByRole('button', { name: 'Save name', exact: true }).click();
      await expect(friend.getByRole('heading', { name: `${name} renamed`, exact: true })).toBeVisible();
      await leader.getByRole('button', { name: 'Edit interests', exact: true }).click();
      await leader.getByRole('button', { name: 'Music', exact: true }).click();
      await leader.waitForTimeout(3300); // polling must not overwrite an open editor
      await leader.getByRole('button', { name: 'Save interests', exact: true }).click();
      await expect(friend.getByText('Music', { exact: true })).toBeVisible();
      await leader.getByRole('button', { name: 'Squad settings', exact: true }).click();
      await leader.getByRole('button', { name: 'Leave squad', exact: true }).click();
      await leader.getByRole('button', { name: 'Leave squad', exact: true }).click();
      await expect(leader).toHaveURL(/\/home$/);
      await expect(friend.getByRole('button', { name: 'Find a squad', exact: true })).toBeVisible();
      await friend.getByRole('button', { name: 'Squad settings', exact: true }).click();
      await friend.getByRole('button', { name: 'Leave squad', exact: true }).click();
      await friend.getByRole('button', { name: 'Leave squad', exact: true }).click();
      await expect(friend).toHaveURL(/\/home$/);
    } finally { await Promise.all(contexts.map(context => context.close())); }
  });
}

for (const entry of ['invite link', 'home code']) test(`request approval from ${entry} opens the lobby and removal returns home`, async ({ browser }) => {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 390, height: 844 } })));
  const [leader, friend] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    await leader.goto('/signin');
    await leader.getByRole('button', { name: 'Use dev account', exact: true }).click();
    await leader.getByRole('button', { name: 'Start a squad', exact: true }).click();
    await leader.getByLabel('Squad name').fill(`Approval test ${Date.now()}`);
    await leader.getByRole('button', { name: 'Create squad', exact: true }).click();
    const code = await leader.locator('strong').filter({ hasText: /^[A-Z]{3}-\d{3}$/ }).innerText();
    await leader.getByRole('button', { name: 'Squad settings', exact: true }).click();
    await leader.getByLabel('Who can join').selectOption('request');
    await expect(leader.getByLabel('Who can join')).toBeEnabled();
    if (entry === 'invite link') {
      await friend.goto(`/join/${code}`);
      await expect(friend.getByRole('heading', { name: 'Request sent!' })).toBeVisible();
    } else {
      await friend.goto('/signin');
      await friend.getByRole('button', { name: 'Use dev account', exact: true }).click();
      await friend.getByLabel('Squad invite code').fill(code);
      await friend.getByRole('button', { name: 'Join squad', exact: true }).click();
      await expect(friend.getByText('Request sent. You will enter if the leader approves.')).toBeVisible();
    }
    await leader.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(friend).toHaveURL(/\/lobby\?squad=/);
    await expect(friend.getByTestId('lobby-person')).toHaveCount(2);
    await leader.getByRole('button', { name: 'Remove', exact: true }).click();
    await leader.getByRole('button', { name: 'Remove member', exact: true }).click();
    await expect(friend).toHaveURL(/\/home$/);
    await leader.getByRole('button', { name: 'Squad settings', exact: true }).click();
    await leader.getByRole('button', { name: 'Leave squad', exact: true }).click();
    await leader.getByRole('button', { name: 'Leave squad', exact: true }).click();
    await expect(leader).toHaveURL(/\/home$/);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
