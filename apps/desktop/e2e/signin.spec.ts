import { expect, test } from "@playwright/test";
import { completeAgeGate } from './helpers';

async function submitDob(page: import("@playwright/test").Page, yearsAgo: number) {
  const gate = page.getByRole("dialog", { name: "Confirm your age" });
  await expect(gate).toBeVisible();
  await gate.getByRole("combobox", { name: "Birth month" }).selectOption("0");
  await gate.getByRole("combobox", { name: "Birth day" }).selectOption("1");
  await gate.getByRole("combobox", { name: "Birth year" }).selectOption(String(new Date().getFullYear() - yearsAgo));
  await gate.getByRole("button", { name: "Continue" }).click();
  return gate;
}

test("an under-18 declaration stays blocked with help and sign-out", async ({ page }) => {
  const realtimeRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/socket.io/")) realtimeRequests.push(request.url());
  });
  await page.goto("/home");
  const initialGate = page.getByRole("dialog", { name: "Confirm your age" });
  await expect(initialGate.getByRole("link", { name: /age verification help/i })).toBeVisible();
  await expect(initialGate.getByRole("button", { name: /sign out/i })).toBeVisible();
  const gate = await submitDob(page, 16);

  await expect(gate.getByRole("heading", { name: /adults 18\+/i })).toBeVisible();
  const help = gate.getByRole("link", { name: /age verification help/i });
  await expect(help).toHaveAttribute("href", /^mailto:support@gigglemeet.com/);
  expect((await help.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(gate.getByRole("button", { name: /sign out/i })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(0);
  expect(realtimeRequests).toEqual([]);
});

test("an adult explicitly launches the hosted verification provider", async ({ page }) => {
  await page.route("**/api/me/age/verification-status", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { status: "not_started", ageVerified: false } }),
  }));
  await page.route("**/api/me/age/verification-session", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { status: "pending", ageVerified: false, url: "https://age.yoti.com/?sessionId=e2e" } }),
  }));
  await page.route("https://age.yoti.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Yoti test</title>" }));

  await page.goto("/home");
  const gate = await submitDob(page, 25);
  await gate.getByRole("button", { name: /verify with yoti/i }).click();
  await expect(page).toHaveURL(/age\.yoti\.com\/\?sessionId=e2e/);
});

test("untrusted and malformed provider links fail closed", async ({ page }) => {
  let providerUrl = "https://age.yoti.com.evil.example/?sessionId=e2e";
  await page.route("**/api/me/age/verification-status", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { status: "not_started", ageVerified: false } }),
  }));
  await page.route("**/api/me/age/verification-session", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { status: "pending", ageVerified: false, url: providerUrl } }),
  }));
  await page.route("https://age.yoti.com.evil.example/**", route => route.fulfill({ status: 200, body: "unexpected navigation" }));

  await page.goto("/home");
  const gate = await submitDob(page, 25);
  await gate.getByRole("button", { name: /verify with yoti/i }).click();
  await expect(gate.getByRole("heading", { name: /verification unavailable/i })).toBeVisible();
  await expect(gate.getByRole("alert")).toContainText(/invalid provider link/i);
  await expect(page).toHaveURL(/\/home$/);

  await gate.getByRole("button", { name: /try again/i }).click();
  await expect(gate.getByRole("button", { name: /verify with yoti/i })).toBeVisible();
  providerUrl = "not a URL";
  await gate.getByRole("button", { name: /verify with yoti/i }).click();
  await expect(gate.getByRole("heading", { name: /verification unavailable/i })).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
});

test("a newer operation prevents a stale provider response from navigating", async ({ page }) => {
  let releaseProvider!: () => void;
  let providerRequested!: () => void;
  const providerRelease = new Promise<void>(resolve => { releaseProvider = resolve; });
  const providerStarted = new Promise<void>(resolve => { providerRequested = resolve; });
  await page.route("**/api/me/age/verification-status", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { status: "not_started", ageVerified: false } }),
  }));
  await page.route("**/api/me/age/verification-session", async route => {
    providerRequested();
    await providerRelease;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { status: "pending", ageVerified: false, url: "https://age.yoti.com/?sessionId=stale" } }),
    });
  });
  await page.route("https://age.yoti.com/**", route => route.fulfill({ status: 200, body: "unexpected navigation" }));

  await page.goto("/home");
  const gate = await submitDob(page, 25);
  await gate.getByRole("button", { name: /verify with yoti/i }).click();
  await providerStarted;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(gate.getByRole("button", { name: /verify with yoti/i })).toBeVisible();
  releaseProvider();
  await page.waitForTimeout(150);
  await expect(page).toHaveURL(/\/home$/);
});

test("focus and visibility events share one status reconciliation", async ({ page }) => {
  let statusCalls = 0;
  let holdStatus = false;
  let releaseStatus!: () => void;
  const heldStatus = new Promise<void>(resolve => { releaseStatus = resolve; });
  await page.route("**/api/me/age/verification-status", async route => {
    statusCalls += 1;
    if (holdStatus) await heldStatus;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { status: "not_started", ageVerified: false } }),
    });
  });

  await page.goto("/home");
  const gate = await submitDob(page, 25);
  await expect(gate.getByRole("button", { name: /verify with yoti/i })).toBeVisible();
  holdStatus = true;
  const beforeReturn = statusCalls;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => statusCalls).toBe(beforeReturn + 1);
  await page.waitForTimeout(100);
  expect(statusCalls).toBe(beforeReturn + 1);
  releaseStatus();
  await expect(gate.getByRole("button", { name: /verify with yoti/i })).toBeVisible();
});

test("pending verification can be rechecked and rejected without opening the app", async ({ page }) => {
  let status: "pending" | "rejected" = "pending";
  await page.route("**/api/me/age/verification-status", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { status, ageVerified: false } }),
  }));

  await page.goto("/home");
  const gate = await submitDob(page, 25);
  await expect(gate.getByRole("heading", { name: /verification pending/i })).toBeVisible();
  await expect(gate.getByRole("button", { name: /continue with yoti/i })).toBeVisible();
  status = "rejected";
  await gate.getByRole("button", { name: /check again/i }).click();
  await expect(gate.getByRole("heading", { name: /couldn't verify/i })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(0);
});

test("an unavailable verifier stays blocked and offers a retry", async ({ page }) => {
  await page.route("**/api/me/age/verification-status", route => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: { code: "AGE_VERIFICATION_UNAVAILABLE", message: "Age verification is temporarily unavailable" } }),
  }));

  await page.goto("/home");
  const gate = await submitDob(page, 25);
  await expect(gate.getByRole("heading", { name: /verification unavailable/i })).toBeVisible();
  await expect(gate.getByRole("button", { name: /try again/i })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(0);
});

test("sign-in explains the handoff and keeps Google primary", async ({ page }, testInfo) => {
  await page.goto("/signin?next=%2Fdiscover&ref=CREW42");

  await expect(page.getByRole("heading", { name: /sign in to giggle/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  await expect(page.getByText(/name and email/i)).toBeVisible();
  await expect(page.getByText(/invite accepted/i)).toBeVisible();

  await page.screenshot({
    path: `artifacts/visual-audit/2026-07-12/signin/${testInfo.project.name}.jpg`,
    type: "jpeg",
    quality: 82,
  });
});

test("sign-in exposes a failed provider handoff as retryable", async ({ page }) => {
  await page.route("**/api/auth/google**", route => route.abort("failed"));
  await page.goto("/signin");
  await page.getByRole("button", { name: /continue with google/i }).click();

  await expect(page.getByRole("alert").filter({ hasText: /couldn't reach google/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
});

test("dev sign-in preserves a safe continuation", async ({ page }) => {
  await page.goto("/signin?next=%2Fdiscover");
  await page.getByRole("button", { name: /use dev account/i }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await completeAgeGate(page);
  await expect(page.getByRole("main")).toBeVisible();
});

test("dev sign-in rejects an external continuation", async ({ page }) => {
  await page.goto("/signin?next=%2F%2Fevil.example");
  await page.getByRole("button", { name: /use dev account/i }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test("OAuth callback returns to the stored safe continuation", async ({ page }) => {
  await page.goto("/signin?next=%2Fdiscover");
  await expect(page.getByRole("heading", { name: /sign in to giggle/i })).toBeVisible();

  const payload = Buffer.from(JSON.stringify({ sub: "oauth-test", email: "oauth@example.com", name: "OAuth Test" })).toString("base64url");
  await page.goto(`/auth/callback#token=header.${payload}.signature`);

  await expect(page).toHaveURL(/\/discover$/);
});
