import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

// Signs in a clearly marked synthetic account through the existing
// server-to-server auth exchange (x-giggle-auth-exchange-secret), so production
// needs no extra login route. The secret is Railway's AUTH_EXCHANGE_SECRET,
// read from the environment or the gitignored apps/desktop/.env.prod-smoke.
// Local mode (GIGGLE_SMOKE_LOCAL=true) targets a local production build and a
// development API, whose exchange needs no secret.
const LOCAL = process.env.GIGGLE_SMOKE_LOCAL === "true";
const API = process.env.GIGGLE_PROD_API_URL || (LOCAL ? "http://localhost:3001" : "https://giggle-server-production.up.railway.app");
const TEST_EMAIL = "prod-smoke@e2e.gigglemeet.test";
const TEST_AVATAR = "teal-bot";

function exchangeSecret(): string | undefined {
  if (LOCAL) return "local-development";
  if (process.env.GIGGLE_AUTH_EXCHANGE_SECRET) return process.env.GIGGLE_AUTH_EXCHANGE_SECRET;
  const file = path.join(__dirname, "..", ".env.prod-smoke");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find(entry => entry.startsWith("GIGGLE_AUTH_EXCHANGE_SECRET="));
  return line?.slice(line.indexOf("=") + 1).trim() || undefined;
}

const secret = exchangeSecret();
test.skip(!secret, "Set GIGGLE_AUTH_EXCHANGE_SECRET (env or apps/desktop/.env.prod-smoke) to Railway's AUTH_EXCHANGE_SECRET");

async function signInTestAccount(request: APIRequestContext) {
  const exchange = await request.post(`${API}/api/auth/exchange`, {
    headers: { "x-giggle-auth-exchange-secret": secret! },
    data: { email: TEST_EMAIL, name: "Prod Smoke Test" },
  });
  expect(exchange.status(), await exchange.text()).toBe(200);
  const body = await exchange.json();
  const { token, user } = body.data ?? body;
  const auth = { Authorization: `Bearer ${token}` };
  if (!user.ageConfirmed) {
    const age = await request.post(`${API}/api/me/age`, { headers: auth, data: { birthDate: "1990-01-01" } });
    expect(age.ok(), await age.text()).toBe(true);
  }
  const avatar = await request.patch(`${API}/api/me/profile`, { headers: auth, data: { avatar: TEST_AVATAR } });
  expect(avatar.ok(), await avatar.text()).toBe(true);
  return { token, user, auth };
}

test("signed-in production app works end to end", async ({ page, request }) => {
  test.setTimeout(90_000);
  const { token, user, auth } = await signInTestAccount(request);
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", request => {
    const error = request.failure()?.errorText ?? "failed";
    if (error !== "net::ERR_ABORTED") failedRequests.push(`${request.method()} ${request.url()} ${error}`);
  });
  await page.addInitScript(([sessionToken, sessionUser]) => {
    localStorage.setItem("giggle.session", JSON.stringify({ token: sessionToken, user: sessionUser }));
    localStorage.setItem("giggle.avatarPrompted", "1");
  }, [token, user] as const);

  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1, name: /your squad|start a squad/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Your profile" }).getByRole("img", { name: "Teal Bot" })).toBeVisible();

  await page.goto("/friends");
  await expect(page.getByRole("heading", { level: 1, name: /^friends$/i })).toBeVisible();
  await page.goto("/premium");
  await expect(page.getByRole("heading", { level: 1, name: /^wallet$/i })).toBeVisible();
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Interests" })).toBeVisible();

  // Create a squad through the UI, check the lobby, then remove it again.
  await page.goto("/home");
  await page.getByRole("main").getByRole("button", { name: "Start a squad", exact: true }).first().click();
  await page.getByLabel("Squad name").fill(`Smoke ${Date.now()}`);
  await page.getByRole("button", { name: "Create squad", exact: true }).click();
  await page.waitForURL(/\/lobby\?squad=/, { timeout: 20_000 });
  const squadId = new URL(page.url()).searchParams.get("squad");
  try {
    await expect(page.getByTestId("lobby-person")).toHaveCount(1);
    await expect(page.locator("strong").filter({ hasText: /^[A-Z]{3}-\d{3}$/ })).toBeVisible();
    await expect(page.getByTestId("lobby-person").getByRole("img", { name: "Teal Bot" })).toBeVisible();
  } finally {
    if (squadId) await request.post(`${API}/api/squads/${squadId}/leave`, { headers: auth });
  }

  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
