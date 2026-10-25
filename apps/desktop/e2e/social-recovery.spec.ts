import { expect, test } from "@playwright/test";
import { openProtectedRoute } from "./helpers";

test("Home friends outage stays distinct from empty and retries without losing other sections or drafts", async ({ page }) => {
  // Browser-only fixture: no identity or social writes reach an API.
  const user = { id: "social-recovery-fixture", email: "social-recovery@fixture.test", name: "Social Fixture", isAdult: true, ageConfirmed: true, ageVerified: true, avatar: "teal-bot", accountStatus: "active" };
  const token = `e30.${Buffer.from(JSON.stringify({ ...user, userId: user.id })).toString("base64url")}.fixture-only`;
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem("giggle.session", JSON.stringify({ user, token }));
    localStorage.setItem("giggle.avatarPrompted", "1");
  }, { user, token });
  const data: Record<string, unknown> = {
    "/api/me/profile": user,
    "/api/features": { strangerDiscovery: true, games: true },
    "/api/me/wallet": { credits: 0, premium: false, premiumUntil: null, plus: { id: "giggle_plus", cost: 100, days: 7 }, rewards: [] },
    "/api/notifications": { notifications: [], unread: 0 },
    "/api/squads/discover": { squads: [] },
  };
  await page.route("http://localhost:3001/api/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!(pathname in data)) throw new Error(`Unexpected API request in isolated fixture: ${pathname}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: data[pathname] }) });
  });
  await page.routeWebSocket("**/socket.io/**", socket => {
    socket.send('0{"sid":"social","upgrades":[],"pingInterval":60000,"pingTimeout":60000}');
    socket.onMessage(message => { if (String(message).startsWith("40")) socket.send('40{"sid":"social"}'); });
  });
  let phase: "hold" | "fail" | "retry" | "empty" = "hold";
  let release!: () => void;
  let held = new Promise<void>(resolve => { release = resolve; });
  let loads = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/friends", async route => {
    loads++;
    if (phase === "hold" || phase === "retry") await held;
    const failure = phase === "fail";
    await route.fulfill({
      status: failure ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(failure
        ? { ok: false, error: { code: "UNAVAILABLE", message: "Isolated friends outage" } }
        : { ok: true, data: { friends: [] } }),
    });
  });
  const squad = { squadId: "keep-home-fixture", squadCode: "KEE-123", squadName: "Keep my squad", status: "idle", myRole: "leader", memberCount: 1, maxSlots: 8, tags: [] };
  await page.route("**/api/squads/mine", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { squads: [squad] } }) }));
  await page.route("**/api/squads/keep-home-fixture", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { ...squad, members: [] } }) }));
  try {
    await openProtectedRoute(page, "/home");
    const friends = page.getByRole("region", { name: "Friends", exact: true });
    const squads = page.getByRole("region", { name: "Squads", exact: true });
    await expect(friends.getByRole("status")).toHaveText("Loading friends…");
    const code = page.getByRole("textbox", { name: "Squad invite code", exact: true });
    await code.fill("ABC-123");
    phase = "fail";
    release();
    await expect(friends.getByRole("alert")).toContainText("Couldn't load your friends.");
    await expect(friends.getByRole("heading", { name: "Add your first friend", exact: true })).toHaveCount(0);
    await page.waitForLoadState("networkidle");

    const beforeRetry = loads;
    phase = "retry";
    held = new Promise<void>(resolve => { release = resolve; });
    await friends.getByRole("button", { name: "Retry friends", exact: true }).evaluate(node => {
      const button = node as HTMLButtonElement;
      button.click(); button.click();
    });
    await expect(friends.getByRole("status")).toHaveText("Loading friends…");
    await expect.poll(() => loads).toBe(beforeRetry + 1);
    await expect(code).toHaveValue("ABC-123");
    await expect(squads.getByText("Keep my squad", { exact: true })).toHaveCount(1);
    phase = "empty";
    release();
    await expect(friends.getByRole("heading", { name: "Add your first friend", exact: true })).toHaveCount(1);
    await expect(friends.getByRole("alert")).toHaveCount(0);
    await expect(code).toHaveValue("ABC-123");
    await expect(squads.getByText("Keep my squad", { exact: true })).toHaveCount(1);
    expect(loads).toBe(beforeRetry + 1);
    expect(errors).toEqual([]);
  } finally {
    phase = "empty";
    release();
  }
});
