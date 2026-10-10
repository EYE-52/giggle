import { expect, test, type Page } from "@playwright/test";

const fixtureUserId = "507f1f77bcf86cd799439011";
const encounterPath = "/api/matchmaking/encounters/fixture-handoff";

type FixtureOptions = {
  role?: "leader" | "member";
  holdEncounter?: boolean;
  expired?: boolean;
  ackFailures?: number;
  waitForOpponent?: boolean;
  alreadyAcknowledged?: boolean;
  refreshFailures?: number;
};

function fixtureMembers(role: "leader" | "member") {
  return {
    mine: [
      { memberId: "mine-1", userId: fixtureUserId, displayName: "Maya", role, ready: true, inLobbyVideo: true, inEncounterVideo: false },
      { memberId: "mine-2", userId: "507f1f77bcf86cd799439012", displayName: "Arjun", role: role === "leader" ? "member" : "leader", ready: true, inLobbyVideo: true, inEncounterVideo: false },
    ],
    theirs: [
      { memberId: "theirs-1", userId: "507f1f77bcf86cd799439013", displayName: "Leo", role: "leader", ready: true, inLobbyVideo: true, inEncounterVideo: false },
      { memberId: "theirs-2", userId: "507f1f77bcf86cd799439014", displayName: "Nia", role: "member", ready: true, inLobbyVideo: true, inEncounterVideo: false },
    ],
  } as const;
}

async function installMatchFixture(page: Page, options: FixtureOptions = {}) {
  const role = options.role ?? "leader";
  const members = fixtureMembers(role);
  const user = {
    id: fixtureUserId,
    email: "fixture@giggle.local",
    name: "Maya",
    isPremium: false,
    isApproved: true,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    accountStatus: "active" as const,
  };
  const encounter = {
    encounterId: "fixture-handoff",
    status: "awaiting_ack",
    ack: { "fixture-squad": options.alreadyAcknowledged ?? false },
    squadAId: "fixture-squad",
    squadAName: "Night Owls",
    squadAMembers: members.mine,
    squadBId: "fixture-opponents",
    squadBName: "Chaos Club",
    squadBMembers: members.theirs,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const squad = {
    squadId: "fixture-squad",
    squadCode: "OWL-123",
    squadName: "Night Owls",
    status: "matched",
    leaderMemberId: role === "leader" ? "mine-1" : "mine-2",
    members: members.mine,
    tags: ["Gaming", "Comedy"],
  };
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    email: user.email,
    name: user.name,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    accountStatus: "active",
  })).toString("base64url");

  await page.addInitScript(({ sessionValue }) => {
    localStorage.setItem("giggle.session", sessionValue);
    localStorage.setItem("giggle.look", JSON.stringify({ skin: "soft", palette: "honey", mode: "light" }));
  }, { sessionValue: JSON.stringify({ token: `e30.${payload}.fixture`, user }) });

  let ackAttempts = 0;
  let remainingRefreshFailures = options.refreshFailures ?? 0;
  let releaseEncounter = () => {};
  const encounterGate = options.holdEncounter
    ? new Promise<void>(resolve => { releaseEncounter = resolve; })
    : Promise.resolve();
  const calls: Array<{ path: string; body?: unknown }> = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") calls.push({ path, body: request.postDataJSON() });

    if (path === "/api/me/profile") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: user }) });
      return;
    }
    if (path === "/api/me/age/verification-status") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { status: "verified", ageVerified: true } }) });
      return;
    }
    if (path === encounterPath && request.method() === "GET") {
      await encounterGate;
      if (encounter.ack["fixture-squad"] && remainingRefreshFailures > 0) {
        remainingRefreshFailures--;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'RETRY', message: 'Temporarily unavailable.' } }) });
        return;
      }
      if (options.expired) {
        await route.fulfill({
          status: 410,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "ENCOUNTER_EXPIRED", message: "This match handoff has expired." } }),
        });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: encounter }) });
      return;
    }
    if (path === "/api/squads/fixture-squad") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: squad }) });
      return;
    }
    if (path === `${encounterPath}/ack`) {
      ackAttempts += 1;
      if (ackAttempts <= (options.ackFailures ?? 0)) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "ACK_RETRY", message: "Room is still syncing." } }),
        });
        return;
      }
      encounter.ack["fixture-squad"] = true;
      if (!options.waitForOpponent) encounter.status = "active";
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { encounterId: "fixture-handoff", allAcked: !options.waitForOpponent } }) });
      return;
    }
    if (path === "/api/matchmaking/skip") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { squadId: "fixture-squad", queueStatus: "searching" } }) });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "fixture_missing", message: `No fixture for ${path}` } }),
    });
  });

  return { calls, ackAttempts: () => ackAttempts, releaseEncounter, activate: () => { encounter.status = "active"; } };
}

async function openMatch(page: Page) {
  await page.goto("/match?squad=fixture-squad&enc=fixture-handoff");
  await expect(page.getByRole("button", { name: "Join now" })).toBeVisible();
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One deterministic project covers the route-mocked handoff");
});

test("route-mocked handoff exposes loading, both rosters, and the active theme", async ({ page }) => {
  const fixture = await installMatchFixture(page, { holdEncounter: true });
  await page.goto("/match?squad=fixture-squad&enc=fixture-handoff");

  await expect(page.getByLabel("Opening room")).toBeVisible();
  fixture.releaseEncounter();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("VS", { exact: true })).toHaveCount(0);
  // each squad is a labelled group of its people, theirs and yours
  await expect(page.getByRole("region", { name: "Night Owls" })).toContainText(/Maya|You/);
  await expect(page.getByRole("region", { name: "Chaos Club" })).toContainText(/Leo.*Nia/);
  await expect(page.getByRole("timer")).toContainText(/Joining in \d…/);
});

test("join acknowledgement stays retryable and navigates only after success", async ({ page }) => {
  const fixture = await installMatchFixture(page, { ackFailures: 1 });
  await openMatch(page);

  // the squad joins by itself after the short reveal; a failed join stays on the handoff
  await expect(page.getByRole("alert").filter({ hasText: "Room is still syncing." })).toBeVisible({ timeout: 6_000 });
  await expect(page).toHaveURL(/\/match\?squad=fixture-squad/);
  expect(fixture.ackAttempts()).toBe(1);

  await page.getByRole("button", { name: "Try joining again" }).click();
  await expect(page).toHaveURL(/\/encounter\?squad=fixture-squad&enc=fixture-handoff/, { timeout: 3_000 });
  expect(fixture.ackAttempts()).toBe(2);
  expect(fixture.calls.filter(call => call.path === `${encounterPath}/ack`).map(call => call.body)).toEqual([
    { squadId: "fixture-squad" },
    { squadId: "fixture-squad" },
  ]);
});

test("expired handoff offers recovery without entering the room", async ({ page }) => {
  await installMatchFixture(page, { expired: true });
  await page.goto("/match?squad=fixture-squad&enc=fixture-handoff");

  await expect(page.getByText("That match expired before both squads joined.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join now" })).toHaveCount(0);
  await page.getByRole("button", { name: "Find another" }).click();
  await expect(page).toHaveURL(/\/matchmaking\?squad=fixture-squad/);
});

test("leader can skip while a member sees leader authority", async ({ page }) => {
  const leaderFixture = await installMatchFixture(page, { role: "leader" });
  await openMatch(page);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page).toHaveURL(/\/matchmaking\?squad=fixture-squad/);
  expect(leaderFixture.calls.some(call => call.path === "/api/matchmaking/skip")).toBe(true);

  const memberPage = await page.context().newPage();
  await installMatchFixture(memberPage, { role: "member" });
  await openMatch(memberPage);
  await expect(memberPage.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
  await expect(memberPage.getByRole("button", { name: "Skip this squad" })).toBeDisabled();
});

for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }, { width: 667, height: 375 }, { width: 390, height: 320 }]) {
 for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`short landscape ${viewport.width}x${viewport.height} ${reducedMotion} keeps handoff actions visible`, async ({ page }) => {
   await page.setViewportSize(viewport);
   await page.emulateMedia({ reducedMotion });
   await installMatchFixture(page, { waitForOpponent: true });
   await openMatch(page);
   const join = page.getByRole("button", { name: "Join now" });
   const skip = page.getByRole("button", { name: "Skip", exact: true });
   for (const button of [join, skip]) {
    const box = await button.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(box && box.y + box.height).toBeLessThanOrEqual(viewport.height);
    if (reducedMotion === "reduce") {
     const durationMs = await button.evaluate(node => {
      const duration = getComputedStyle(node).transitionDuration;
      return Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
     });
     expect(durationMs).toBeLessThanOrEqual(0.001);
    }
   }
   const roster = page.locator('[data-state="matched"]');
   expect(await roster.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
   await roster.evaluate(node => { node.scrollTop = node.scrollHeight; });
   await expect(page.getByRole("region", { name: "Chaos Club" })).toBeInViewport();
   await roster.evaluate(node => { node.scrollTop = 0; });
   await expect(page.getByRole("region", { name: "Night Owls" })).toBeInViewport();
   await page.getByRole("button", { name: "Start squad call" }).scrollIntoViewIfNeeded();
   const afterScroll = await join.boundingBox();
   expect(afterScroll && afterScroll.y + afterScroll.height).toBeLessThanOrEqual(viewport.height);
   expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
 }
}

test("a first acknowledgement waits for the opponent without starting media", async ({ page }) => {
  const fixture = await installMatchFixture(page, { waitForOpponent: true, refreshFailures: 1 });
  await openMatch(page);
  await page.getByRole('button', { name: 'Join now', exact: true }).click();
  await expect(page.getByRole('timer')).toContainText('Waiting for Chaos Club');
  await expect(page.getByRole('status', { name: 'Your squad is ready', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't check the other squad" })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't check the other squad" })).toHaveCount(0);
  expect(fixture.ackAttempts()).toBe(1);
  expect(fixture.calls.some(call => call.path.includes('encounter-video') || call.path === '/api/encounters/token')).toBe(false);
  fixture.activate();
  await expect(page).toHaveURL(/\/encounter\?squad=fixture-squad&enc=fixture-handoff/);
});

test("a pending call link resumes its acknowledged handoff instead of opening devices", async ({ page }) => {
  const fixture = await installMatchFixture(page, { waitForOpponent: true, alreadyAcknowledged: true });
  await page.goto('/encounter?squad=fixture-squad&enc=fixture-handoff');
  await expect(page).toHaveURL(/\/match\?squad=fixture-squad&enc=fixture-handoff/);
  await expect(page.getByRole('timer')).toContainText('Waiting for Chaos Club');
  expect(fixture.ackAttempts()).toBe(0);
  expect(fixture.calls.some(call => call.path.includes('encounter-video') || call.path === '/api/encounters/token')).toBe(false);
});

for (const errorKind of ["handoff", "action", "waiting"] as const) {
 test(`short landscape retains actions and full ${errorKind} error`, async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await installMatchFixture(page, { waitForOpponent: true });
  const message = "Long synthetic notice with details. ".repeat(100);
  let acknowledged = false;
  await page.route("**/api/matchmaking/encounters/fixture-handoff", async route => {
   if (errorKind === "handoff" || (errorKind === "waiting" && acknowledged)) {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "FIXTURE_LONG", message } }) });
   } else await route.fallback();
  });
  await page.route("**/api/matchmaking/encounters/fixture-handoff/ack", async route => { acknowledged = true; await route.fallback(); });
  if (errorKind === "action") {
   await page.route("**/api/matchmaking/encounters/fixture-handoff/ack", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "FIXTURE_LONG", message } }) }));
  }
  await page.goto("/match?squad=fixture-squad&enc=fixture-handoff");
  if (errorKind !== "handoff") await page.getByRole("button", { name: "Join now" }).click();
  const notice = errorKind === "handoff" ? page.getByRole("status").filter({ hasText: message }) : page.locator("p[role=alert]");
  await expect(notice).toBeVisible();
  await test.info().attach(`${errorKind}-notice`, { body: await page.screenshot(), contentType: "image/png" });
  if (errorKind !== "waiting") {
   await expect(notice).toHaveText(message.trim());
   expect(await notice.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
   await notice.focus();
   await page.keyboard.press("End");
   await expect.poll(() => notice.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  }
  const actions = errorKind === "handoff" ? ["Retry", "Back to lobby"] : errorKind === "action" ? ["Try joining again", "Skip"] : ["Skip"];
  for (const name of actions) {
   const box = await page.getByRole("button", { name, exact: true }).last().boundingBox();
   expect(box?.y).toBeGreaterThanOrEqual(0);
   expect(box && box.y + box.height).toBeLessThanOrEqual(320);
  }
 });
}
