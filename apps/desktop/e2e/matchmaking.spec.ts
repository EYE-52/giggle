import { expect, test, type Page } from "@playwright/test";

const fixtureUserId = "507f1f77bcf86cd799439011";
const fixtureSquadId = "fixture-squad";

async function installMatchmakingFixture(page: Page, cancelFailures = 0) {
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
  const squad = {
    squadId: fixtureSquadId,
    squadCode: "OWL-123",
    squadName: "Night Owls",
    status: "searching" as const,
    leaderMemberId: "mine-1",
    members: [
      { memberId: "mine-1", userId: fixtureUserId, displayName: "Maya", role: "leader", ready: true, inLobbyVideo: true, inEncounterVideo: false },
      { memberId: "mine-2", userId: "507f1f77bcf86cd799439012", displayName: "Arjun", role: "member", ready: true, inLobbyVideo: true, inEncounterVideo: false },
    ],
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
  }, { sessionValue: JSON.stringify({ token: `e30.${payload}.fixture`, user }) });

  let cancelAttempts = 0;
  let statusPolls = 0;
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/me/profile") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: user }) });
      return;
    }
    if (path === "/api/me/age/verification-status") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { status: "verified", ageVerified: true } }) });
      return;
    }
    if (path === `/api/squads/${fixtureSquadId}` && request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: squad }) });
      return;
    }
    if (path === `/api/squads/${fixtureSquadId}/requests`) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { requests: [] } }) });
      return;
    }
    if (path === `/api/matchmaking/status/${fixtureSquadId}`) {
      statusPolls += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { squadId: fixtureSquadId, state: "searching" } }),
      });
      return;
    }
    if (path === `/api/squads/${fixtureSquadId}/search/cancel`) {
      cancelAttempts += 1;
      if (cancelAttempts <= cancelFailures) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "CANCEL_RETRY", message: "Search is still syncing." } }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { squadId: fixtureSquadId, status: "idle" } }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "fixture_missing", message: `No fixture for ${path}` } }),
    });
  });

  return {
    cancelAttempts: () => cancelAttempts,
    statusPolls: () => statusPolls,
  };
}

async function openMatchmaking(page: Page, cancelFailures = 0) {
  const fixture = await installMatchmakingFixture(page, cancelFailures);
  await page.goto(`/matchmaking?squad=${fixtureSquadId}`);
  await expect(page.getByRole("heading", { name: /finding your match/i })).toBeVisible();
  return fixture;
}

test.beforeEach(({}, testInfo) => {
  test.skip(!["phone", "desktop"].includes(testInfo.project.name), "Phone and desktop cover the shared matchmaking behavior");
});

test("matchmaking explains progress and cancels back to the lobby", async ({ page }, testInfo) => {
  const fixture = await openMatchmaking(page);

  await expect(page.getByRole("status").filter({ hasText: /checking active squads/i })).toBeVisible();
  const squad = page.getByRole("region", { name: "Your squad" });
  await expect(squad).toContainText("Night Owls");
  await expect(squad).toContainText("Maya · Arjun");
  await expect(squad).toContainText("2 together");
  await expect.poll(fixture.statusPolls).toBeGreaterThan(0);

  await page.screenshot({
    path: `artifacts/visual-audit/2026-07-12/matchmaking/${testInfo.project.name}.jpg`,
    type: "jpeg",
    quality: 82,
  });

  await page.getByRole("button", { name: /cancel search/i }).click();
  await expect(page).toHaveURL(`/lobby?squad=${fixtureSquadId}`);
  expect(fixture.cancelAttempts()).toBe(1);
});

test("failed cancellation stays in queue and succeeds on retry", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.text().includes("cancelSearch failed")) consoleErrors.push(message.text());
  });
  const fixture = await openMatchmaking(page, 1);

  await page.getByRole("button", { name: /cancel search/i }).click();

  await expect(page).toHaveURL(`/matchmaking?squad=${fixtureSquadId}`);
  await expect(page.getByRole("alert").filter({ hasText: /still in the queue/i })).toBeVisible();
  expect(fixture.cancelAttempts()).toBe(1);

  await page.getByRole("button", { name: /try cancel again/i }).click();
  await expect(page).toHaveURL(`/lobby?squad=${fixtureSquadId}`);
  expect(fixture.cancelAttempts()).toBe(2);
  expect(consoleErrors).toEqual([]);
});
