import { expect, test } from '@playwright/test';

test.skip(process.env.GIGGLE_LOCAL_AUTH_E2E !== 'true', 'Requires local development API');

test('roster presence follows first and last socket without polling', async ({ browser }) => {
  const storageState = process.env.PW_STORAGE_STATE ?? 'e2e/avatar-prompted.json';
  const leaderContext = await browser.newContext({ storageState });
  const friendContext = await browser.newContext({ storageState });
  const leader = await leaderContext.newPage();
  const friend = await friendContext.newPage();
  type MemberPresence = { online: boolean; ready: boolean };
  let members: MemberPresence[] = [];
  let rosterUrl = '';
  let rosterHeaders: Record<string, string> = {};

  leader.on('response', async response => {
    if (response.request().method() !== 'GET' || !/\/squads\/[^/?]+(?:\?|$)/.test(response.url())) return;
    const body = await response.json();
    const squad = body.data?.squad ?? body.squad ?? body.data;
    if (!Array.isArray(squad?.members)) return;
    members = squad.members;
    rosterUrl = response.url();
    rosterHeaders = { authorization: (await response.request().allHeaders()).authorization };
  });

  try {
    await leader.goto('/signin');
    await leader.getByRole('button', { name: 'Use dev account', exact: true }).click();
    await leader.getByRole('button', { name: 'Start a squad', exact: true }).click();
    await leader.getByLabel('Squad name').fill('Presence regression');
    await leader.getByRole('button', { name: 'Create squad', exact: true }).click();
    const code = await leader.locator('strong').filter({ hasText: /^[A-Z]{3}-\d{3}$/ }).innerText();
    await friend.goto(`/join/${code}`);
    await expect(friend).toHaveURL(/\/lobby\?squad=/);
    // Five seconds is below the ten-second fallback poll: this requires the push.
    await expect.poll(() => members.length === 2 && members.every(member => member.online), { timeout: 5_000 }).toBe(true);
    const find = leader.getByRole('button', { name: 'Find a squad', exact: true });
    await expect(find).toBeDisabled();

    const secondTab = await friendContext.newPage();
    await secondTab.goto(friend.url());
    await expect(secondTab.getByTestId('lobby-page')).toBeVisible();
    await friend.close();
    // Read the authoritative roster after closing one tab; do not sleep or rely
    // solely on the leader's unchanged cached projection.
    const roster = await leader.request.get(rosterUrl, { headers: rosterHeaders });
    expect(roster.status()).toBe(200);
    const body = await roster.json();
    const squad = body.data?.squad ?? body.squad ?? body.data;
    expect(squad.members).toHaveLength(2);
    expect(squad.members.every((member: MemberPresence) => member.online)).toBe(true);
    await expect(find).toBeDisabled();

    await secondTab.close();
    await expect.poll(() => members.length === 2 && members.filter(member => !member.online).length === 1, { timeout: 5_000 }).toBe(true);
    await expect(find).toBeEnabled();
  } finally {
    await Promise.all([leaderContext.close(), friendContext.close()]);
  }
});
