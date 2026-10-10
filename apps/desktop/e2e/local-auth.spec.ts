import { expect, test } from '@playwright/test';

// Exact shipped Bob preset: persistence must not silently retain the default.
const PICKED_AVATAR = 'giggle:v1:' + JSON.stringify({
  "hair": "bob",
  "face": "round",
  "glasses": "none",
  "facialHair": "none",
  "expression": "surprised",
  "clothing": "sweater",
  "headwear": "none",
  "earrings": "hoops",
  "necklace": "none",
  "headphones": false,
  "skin": "#f6d4b8",
  "hairColor": "#39302e",
  "accent": "#93b8d4",
  "shirtColor": "#2f6f5e",
  "accessoryColor": "#d2a951",
  "faceWidth": 35,
  "eyeSize": 50,
  "eyeSpacing": 40,
  "browTilt": 50,
  "noseSize": 50,
  "mouthWidth": 50,
  "freckles": false,
  "animated": true
});

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

test('a new account picks a shared avatar once and friends-facing surfaces use it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Use dev account', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Pick your avatar' });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Bob', exact: true }).click();
    const saved = page.waitForResponse(response => response.url().endsWith('/api/me/profile') && response.request().method() === 'PATCH');
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    expect(savedResponse.request().postDataJSON().avatar).toBe(PICKED_AVATAR);
    expect((await savedResponse.json()).data.avatar).toBe(PICKED_AVATAR);
    const profile = await page.request.get(savedResponse.url(), { headers: { authorization: (await savedResponse.request().allHeaders()).authorization } });
    expect(profile.status()).toBe(200);
    expect((await profile.json()).data.avatar).toBe(PICKED_AVATAR);
    await expect(picker).toBeHidden();

    await page.reload();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Pick your avatar' })).toHaveCount(0);
    await page.goto('/profile');
    const profileAvatar = page.getByRole('button', { name: 'Edit avatar', exact: true }).getByRole('img', { name: 'Giggle character', exact: true });
    await expect(profileAvatar).toBeVisible();
    // Bob's sky background and green sweater distinguish the picked look
    // from the default Curls amber background and terracotta shirt.
    await expect(profileAvatar.locator('circle[fill="#93b8d4"]').first()).toBeVisible();
    await expect(profileAvatar.locator('path[fill="#2f6f5e"]').first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test('squad-mates see the avatar a member picked', async ({ browser }) => {
  const leaderContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: { cookies: [], origins: [] } });
  const friendContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: 'e2e/avatar-prompted.json' });
  try {
    const leader = await leaderContext.newPage();
    await leader.goto('/signin');
    await leader.getByRole('button', { name: 'Use dev account', exact: true }).click();
    const picker = leader.getByRole('dialog', { name: 'Pick your avatar' });
    await picker.getByRole('button', { name: 'Bob', exact: true }).click();
    const saved = leader.waitForResponse(response => response.url().endsWith('/api/me/profile') && response.request().method() === 'PATCH');
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    expect((await savedResponse.json()).data.avatar).toBe(PICKED_AVATAR);
    const profile = await leader.request.get(savedResponse.url(), { headers: { authorization: (await savedResponse.request().allHeaders()).authorization } });
    expect((await profile.json()).data.avatar).toBe(PICKED_AVATAR);
    await expect(picker).toBeHidden();

    await leader.getByRole('button', { name: 'Start a squad', exact: true }).click();
    await leader.getByLabel('Squad name').fill(`Avatar test ${Date.now()}`);
    await leader.getByRole('button', { name: 'Create squad', exact: true }).click();
    const code = await leader.locator('strong').filter({ hasText: /^[A-Z]{3}-\d{3}$/ }).innerText();

    const friend = await friendContext.newPage();
    await friend.goto(`/join/${code}`);
    await expect(friend).toHaveURL(/\/lobby\?squad=/);
    const leaderName = await leader.evaluate(() => localStorage.getItem('giggle.devname') ?? '');
    expect(leaderName).not.toBe('');
    const leaderTile = friend.getByTestId('lobby-person').filter({ hasText: leaderName });
    const leaderAvatar = leaderTile.getByRole('img', { name: 'Giggle character', exact: true });
    await expect(leaderAvatar).toBeVisible();
    await expect(leaderAvatar.locator('circle[fill="#93b8d4"]').first()).toBeVisible();
    await expect(leaderAvatar.locator('path[fill="#2f6f5e"]').first()).toBeVisible();
  } finally {
    await Promise.all([leaderContext.close(), friendContext.close()]);
  }
});
