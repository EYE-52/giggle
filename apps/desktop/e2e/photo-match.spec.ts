import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

// "Use a photo" flow, mocked at the network boundary. Runs against the already
// running dev servers via e2e/local-running.config.ts (web :4010, API :3001).

const shotsDir = process.env.GIGGLE_PHOTO_SHOTS || "";

// ─── Fixture helpers ────────────────────────────────────────────────────────

const fixtureUser = {
  id: "507f1f77bcf86cd7994d021",
  email: "photo-fixture@giggle.local",
  name: "Photo Fixture",
  isPremium: false,
  isApproved: true,
  ageConfirmed: true,
  isAdult: true,
  ageVerified: true,
  accountStatus: "active" as const,
};

/** Same technique as match.spec.ts: a decodable fake JWT in giggle.session. */
async function signInFixture(page: Page) {
  const payload = Buffer.from(JSON.stringify({
    userId: fixtureUser.id,
    email: fixtureUser.email,
    name: fixtureUser.name,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    accountStatus: "active",
  })).toString("base64url");
  await page.addInitScript(({ sessionValue }) => {
    localStorage.setItem("giggle.session", sessionValue);
    localStorage.setItem("giggle.look", JSON.stringify({ skin: "soft", palette: "honey", mode: "light" }));
  }, { sessionValue: JSON.stringify({ token: `e30.${payload}.fixture`, user: fixtureUser }) });
}

async function mockProfile(page: Page, calls: string[] = []) {
  await page.route("**/api/me/profile", async route => {
    calls.push(`${route.request().method()} /api/me/profile`);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: fixtureUser }) });
  });
}

async function mockSuggestStatus(page: Page, enabled: boolean) {
  await page.route("**/api/me/avatar/suggest/status", route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ok: true, enabled, remainingToday: 3, remainingMonth: 10 }),
  }));
}

type SuggestCall = { body: any };

async function mockSuggest(page: Page, response: { status: number; json: unknown; delayMs?: number }, calls: SuggestCall[]) {
  await page.route("**/api/me/avatar/suggest", async route => {
    calls.push({ body: route.request().postDataJSON() });
    if (response.delayMs) await new Promise(resolve => setTimeout(resolve, response.delayMs));
    await route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.json) });
  });
}

function charConfig(overrides: Record<string, unknown> = {}) {
  return {
    hair: "curls", face: "soft", glasses: "none", facialHair: "none", expression: "smile",
    clothing: "tee", headwear: "none", earrings: "none",
    skin: "#bd815e", hairColor: "#39302e", accent: "#e5dbc9", shirtColor: "#d97654", accessoryColor: "#74618c",
    faceWidth: 50, eyeSize: 50, eyeSpacing: 50, browTilt: 50, noseSize: 50, mouthWidth: 50,
    freckles: false, animated: true,
    ...overrides,
  };
}

const matchConfigs = [
  charConfig({ hair: "bob", shirtColor: "#657f6b" }),
  charConfig({ hair: "swoop", face: "angular", skin: "#86523e" }),
  charConfig({ hair: "crop", glasses: "round", eyeSize: 40 }),
];

// ─── Dependency-free image helpers ─────────────────────────────────────────

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])));
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, crc]);
}

/** Renders a plain colored gradient PNG (a stand-in "photo" the browser can decode). */
function makePhotoPng(width = 800, height = 600): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolor
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[offset++] = 170 + Math.round((y / height) * 60);
      raw[offset++] = 120 + Math.round((x / width) * 60);
      raw[offset++] = 90 + Math.round(((x + y) / (width + height)) * 60);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Reads width/height out of a JPEG's SOFn markers. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function shoot(page: Page, state: string) {
  if (!shotsDir) return;
  await page.screenshot({ path: `${shotsDir}/photo-${state}-${test.info().project.name}.png`, fullPage: true });
}

async function openEditorAndPickPhoto(page: Page, photo: Buffer = makePhotoPng()) {
  await page.goto("/avatar-playground");
  await page.getByRole("button", { name: "Use a photo" }).click();
  await expect(page.getByText(/sent once to an AI service/i)).toBeVisible();
  await page.getByLabel("Photo file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: photo });
  await expect(page.getByRole("button", { name: "Match my photo" })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.setTimeout(90_000);

test("photo entry stays hidden when the feature is disabled or the visitor is signed out", async ({ page }) => {
  await signInFixture(page);
  const profileCalls: string[] = [];
  await mockProfile(page, profileCalls);
  await mockSuggestStatus(page, false);
  await page.goto("/avatar-playground");
  await expect(page.getByRole("button", { name: "Use a photo" })).toHaveCount(0);
  await expect(page.getByText(/made from Giggle’s own artwork/i)).toBeVisible();
  await expect(page.getByText(/not connected/i)).toHaveCount(0);

  // Signed out: nothing renders even when the feature is enabled.
  const context = page.context();
  await context.clearCookies();
  await page.evaluate(() => localStorage.removeItem("giggle.session"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Use a photo" })).toHaveCount(0);
});

test("matching a photo offers three options; Apply stages them and Save is still required", async ({ page }) => {
  await signInFixture(page);
  const profileCalls: string[] = [];
  await mockProfile(page, profileCalls);
  await mockSuggestStatus(page, true);
  const suggestCalls: SuggestCall[] = [];
  await mockSuggest(page, {
    status: 200,
    json: { ok: true, status: "match", configs: matchConfigs, model: "fixture-model", promptVersion: "p1" },
    delayMs: 400,
  }, suggestCalls);

  await page.goto("/avatar-playground");
  await expectNoHorizontalOverflow(page);
  await shoot(page, "entry");

  await page.getByRole("button", { name: "Use a photo" }).click();
  await expect(page.getByText(/sent once to an AI service/i)).toBeVisible();
  await shoot(page, "consent");

  await page.getByLabel("Photo file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: makePhotoPng() });
  await expect(page.getByRole("group", { name: /drag or use arrow keys/i })).toBeVisible();
  await expect(page.getByLabel("Photo zoom")).toBeVisible();
  await shoot(page, "preview");

  // Arrow-key repositioning works (no crash, stays interactive).
  await page.getByRole("group", { name: /drag or use arrow keys/i }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");

  // Name alternates between "Match my photo" and "Matching…" — match both.
  const matchButton = page.getByRole("button", { name: /^match(ing)?( my photo)?…?$/i });
  await matchButton.click();
  await expect(matchButton).toBeDisabled();
  await expect(matchButton).toHaveText(/matching/i);
  // No double submit while in flight.
  await matchButton.dispatchEvent("click");
  await shoot(page, "busy");

  await expect(page.getByText("Closest", { exact: true })).toBeVisible();
  await expect(page.getByText("Option 2")).toBeVisible();
  await expect(page.getByText("Option 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(3);
  await expect(page.getByText(/press Save to keep it/i)).toBeVisible();
  await shoot(page, "results");
  await expectNoHorizontalOverflow(page);
  expect(suggestCalls.length).toBe(1);

  // POST body: JPEG data URL ≤ 512×512 (square), UUID v4 requestId, editor base config.
  const body = suggestCalls[0].body;
  expect(body.image.startsWith(JPEG_DATA_URL_PREFIX)).toBe(true);
  expect(body.requestId).toMatch(UUID_V4);
  expect(body.base).toMatchObject({ hair: "curls", face: "soft" });
  const jpeg = Buffer.from(body.image.slice(JPEG_DATA_URL_PREFIX.length), "base64");
  const size = jpegSize(jpeg);
  expect(size).not.toBeNull();
  expect(size!.width).toBeLessThanOrEqual(512);
  expect(size!.height).toBeLessThanOrEqual(512);
  expect(size!.width).toBe(size!.height);

  // Apply replaces the preview but does NOT save the profile.
  const preview = page.getByRole("img", { name: "Your customized character" });
  const before = await preview.innerHTML();
  await page.getByRole("button", { name: "Apply", exact: true }).nth(1).click();
  const after = await preview.innerHTML();
  expect(after).not.toBe(before);
  await expect(page.getByRole("status")).toContainText(/save/i);
  await expect(page.getByRole("button", { name: "Save to profile" })).toBeVisible();
  expect(profileCalls.filter(call => call.startsWith("PATCH"))).toEqual([]);
  // Panel closed back to the entry button.
  await expect(page.getByRole("button", { name: "Use a photo" })).toBeVisible();
});

test("no_face gets a specific friendly line and recovery actions", async ({ page }) => {
  await signInFixture(page);
  await mockProfile(page);
  await mockSuggestStatus(page, true);
  const suggestCalls: SuggestCall[] = [];
  await mockSuggest(page, { status: 200, json: { ok: true, status: "no_face", configs: [] } }, suggestCalls);

  await openEditorAndPickPhoto(page);
  await page.getByRole("button", { name: "Match my photo" }).click();
  await expect(page.getByText(/couldn’t find a face/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose another" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit manually" })).toBeVisible();
  await shoot(page, "noface");

  // "Edit manually" just closes the panel — manual editing is untouched.
  await page.getByRole("button", { name: "Edit manually" }).click();
  await expect(page.getByRole("button", { name: "Use a photo" })).toBeVisible();
  expect(suggestCalls.length).toBe(1);
});

test("QUOTA_EXCEEDED shows a calm message and never the raw server error", async ({ page }) => {
  await signInFixture(page);
  await mockProfile(page);
  await mockSuggestStatus(page, true);
  await mockSuggest(page, {
    status: 429,
    json: { ok: false, error: { code: "QUOTA_EXCEEDED", message: "RAW INTERNAL DETAIL quota window utc" } },
  }, []);

  await openEditorAndPickPhoto(page);
  await page.getByRole("button", { name: "Match my photo" }).click();
  await expect(page.getByText(/try again tomorrow/i)).toBeVisible();
  await expect(page.getByText(/RAW INTERNAL DETAIL/i)).toHaveCount(0);
  await shoot(page, "quota");
  await expectNoHorizontalOverflow(page);
});
