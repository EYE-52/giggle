import { expect, test, type Locator } from "@playwright/test";
import { openProtectedRoute } from "./helpers";

const profileName = "AlexandriaRoseMontgomery";
const squadName = "Weekend movie club with everyone";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "One compact phone covers these header regressions");
  await page.setViewportSize({ width: 320, height: 568 });
  // Same browser-only session/socket fixture pattern as social-recovery.spec.ts.
  // All API requests stay in this page; no account or media service is used.
  const user = { id: "header-fixture", email: "headers@fixture.test", name: profileName, isAdult: true, ageConfirmed: true, ageVerified: true, accountStatus: "active", avatar: "teal-bot" };
  const token = `e30.${Buffer.from(JSON.stringify({ ...user, userId: user.id })).toString("base64url")}.fixture-only`;
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem("giggle.session", JSON.stringify({ user, token }));
    localStorage.setItem("giggle.avatarPrompted", "1");
    localStorage.setItem("giggle.look", JSON.stringify({ skin: "clay", palette: "grape", mode: "light" }));
  }, { user, token });
  const squad = {
    squadId: "header-squad", squadCode: "BAR-123", squadName, status: "idle", leaderMemberId: "leader", maxSlots: 4, tags: ["Movies"],
    members: [{ memberId: "leader", userId: user.id, displayName: profileName, role: "leader", online: true, ready: false, inLobbyVideo: false, inEncounterVideo: false }],
  };
  const data: Record<string, unknown> = {
    "/api/me/profile": user,
    "/api/features": { strangerDiscovery: true, games: true },
    "/api/me/wallet": { credits: 0, premium: false, premiumUntil: null, plus: { id: "giggle_plus", cost: 100, days: 7 }, rewards: [] },
    "/api/me/blocks": { accounts: [] },
    "/api/notifications": { notifications: [], unread: 0 },
    "/api/notifications/read-all": { unread: 0 },
    "/api/squads/mine": { squads: [] },
    "/api/squads/header-squad": squad,
    "/api/squads/header-squad/requests": { requests: [] },
  };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (!(path in data)) throw new Error(`Unexpected header fixture request: ${path}`);
    return route.fulfill({ json: { ok: true, data: data[path] } });
  });
  await page.routeWebSocket("**/socket.io/**", socket => {
    socket.send('0{"sid":"headers","upgrades":[],"pingInterval":60000,"pingTimeout":60000}');
    socket.onMessage(message => { if (String(message).startsWith("40")) socket.send('40{"sid":"headers"}'); });
  });
});

async function expectWrappedName(heading: Locator) {
  await heading.evaluate(() => document.fonts.ready);
  await expect.poll(() => heading.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight
      && range.getClientRects().length > 1;
  })).toBe(true);
}

async function expectPhoneTarget(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  const box = await control.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test("320px lobby gives the full squad name room when Play is available", async ({ page }) => {
  await openProtectedRoute(page, "/lobby?squad=header-squad");
  const bar = page.getByTestId("lobby-page").locator("header");
  const heading = bar.getByRole("heading", { name: squadName, exact: true });
  const play = bar.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeVisible();
  await expectWrappedName(heading);
  const nameBox = await heading.boundingBox();
  const playBox = await play.boundingBox();
  expect(nameBox!.width).toBeGreaterThanOrEqual(200);
  expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(playBox!.y);
  for (const control of await bar.getByRole("button").or(bar.getByRole("link")).all()) {
    // Code and topics remain available in their sheets on phones.
    if (await control.isVisible()) await expectPhoneTarget(control);
  }
});

test("320px profile wraps a long name instead of cutting off letters", async ({ page }) => {
  await openProtectedRoute(page, "/profile");
  await expectWrappedName(page.getByRole("heading", { name: profileName, exact: true }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("secondary header controls stay quiet and touch-sized across skins", async ({ page }) => {
  await openProtectedRoute(page, "/profile");
  const bell = page.getByRole("button", { name: "Notifications", exact: true });
  for (const skin of ["Clay", "Doodle", "Scrapbook", "Soft Depth", "Bold Play"]) {
    await page.getByRole("radio", { name: skin, exact: true }).click();
    await page.mouse.move(0, 567);
    await expectPhoneTarget(bell);
    await expect(bell).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(bell).toHaveCSS("box-shadow", "none");
    await expect(bell).toHaveCSS("border-top-width", "0px");
    expect(await bell.evaluate(el => getComputedStyle(el).getPropertyValue("--sketch").trim())).toBe("none");
  }
  await bell.press("Enter");
  await expect(bell).toHaveAttribute("aria-expanded", "true");
  await expect(bell).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.getByRole("dialog", { name: "Notifications", exact: true }).press("Escape");
  await expect(bell).toBeFocused();
  await expect(bell).toHaveCSS("outline-style", "solid");
});
