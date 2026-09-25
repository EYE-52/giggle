import { expect, test, type Page } from "@playwright/test";

const fixtureUserId = "507f1f77bcf86cd799439011";
const encounterPath = "/api/matchmaking/encounters/fixture-handoff";

type FixtureOptions = {
  role?: "leader" | "member";
  holdEncounter?: boolean;
  expired?: boolean;
  ackFailures?: number;
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
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { encounterId: "fixture-handoff", allAcked: true } }) });
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

  return { calls, ackAttempts: () => ackAttempts, releaseEncounter };
}

async function openMatch(page: Page) {
  await page.goto("/match?squad=fixture-squad&enc=fixture-handoff");
  await expect(page.getByText("Room ready", { exact: true })).toBeVisible();
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One deterministic project covers the route-mocked handoff");
});

test("route-mocked handoff exposes loading, both rosters, and the active theme", async ({ page }) => {
  const fixture = await installMatchFixture(page, { holdEncounter: true });
  await page.goto("/match?squad=fixture-squad&enc=fixture-handoff");

  await expect(page.getByRole("heading", { name: "Preparing your room" })).toBeVisible();
  fixture.releaseEncounter();
  await expect(page.getByRole("heading", { name: "Your squads can join now" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("VS", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Night Owls.*Maya.*Arjun.*Chaos Club.*Leo.*Nia/i })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText(/Starts in \d+s/);
});

test("join acknowledgement stays retryable and navigates only after success", async ({ page }) => {
  const fixture = await installMatchFixture(page, { ackFailures: 1 });
  await openMatch(page);

  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Room is still syncing." })).toBeVisible();
  await expect(page).toHaveURL(/\/match\?squad=fixture-squad/);
  expect(fixture.ackAttempts()).toBe(1);

  await page.getByRole("button", { name: "Join room" }).click();
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

  await expect(page.getByRole("heading", { name: "Match expired" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join room" })).toHaveCount(0);
  await page.getByRole("button", { name: "Find another" }).click();
  await expect(page).toHaveURL(/\/matchmaking\?squad=fixture-squad/);
});

test("leader can skip while a member sees leader authority", async ({ page }) => {
  const leaderFixture = await installMatchFixture(page, { role: "leader" });
  await openMatch(page);
  await page.getByRole("button", { name: /^Skip \(/ }).click();
  await expect(page).toHaveURL(/\/matchmaking\?squad=fixture-squad/);
  expect(leaderFixture.calls.some(call => call.path === "/api/matchmaking/skip")).toBe(true);

  const memberPage = await page.context().newPage();
  await installMatchFixture(memberPage, { role: "member" });
  await openMatch(memberPage);
  await expect(memberPage.getByRole("button", { name: /^Skip \(/ })).toHaveCount(0);
  await expect(memberPage.getByText(/Waiting for your leader to start/i)).toBeVisible();
});

test("reduced-motion phone landscape can scroll both actions into view", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMatchFixture(page);
  await openMatch(page);

  const section = page.getByRole("heading", { name: "Your squads can join now" }).locator("xpath=ancestor::section");
  const scroller = section.locator("..");
  await expect.poll(() => scroller.evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
  await page.mouse.move(422, 280);
  await page.mouse.wheel(0, 1_000);
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(0);

  for (const button of [page.getByRole("button", { name: "Join room" }), page.getByRole("button", { name: /^Skip \(/ })]) {
    const box = await button.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(box && box.y + box.height).toBeLessThanOrEqual(390);
    const durationMs = await button.evaluate(node => {
      const duration = getComputedStyle(node).transitionDuration;
      return Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1_000);
    });
    expect(durationMs).toBeLessThanOrEqual(0.001);
  }
});
