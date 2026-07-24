import { expect, test } from "@playwright/test";

test("sign-in explains the handoff and keeps Google primary", async ({ page }, testInfo) => {
  await page.goto("/signin?next=%2Fdiscover&ref=CREW42");

  await expect(page.getByRole("heading", { name: /join giggle/i })).toBeVisible();
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
  await expect(page.getByRole("main")).toBeVisible();
});

test("dev sign-in rejects an external continuation", async ({ page }) => {
  await page.goto("/signin?next=%2F%2Fevil.example");
  await page.getByRole("button", { name: /use dev account/i }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test("OAuth callback returns to the stored safe continuation", async ({ page }) => {
  await page.goto("/signin?next=%2Fdiscover");
  await expect(page.getByRole("heading", { name: /join giggle/i })).toBeVisible();

  const payload = Buffer.from(JSON.stringify({ sub: "oauth-test", email: "oauth@example.com", name: "OAuth Test" })).toString("base64url");
  await page.goto(`/auth/callback#token=header.${payload}.signature`);

  await expect(page).toHaveURL(/\/discover$/);
});
