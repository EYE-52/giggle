const assert = require("node:assert/strict");
const { test } = require("node:test");

const appConfig = require("../src/config/appConfig");
const {
  createAvatarMatchService,
  decodeBase64Image,
  parseJpegSize,
  stripJpegMetadata,
  readConfig,
  quotaKeys,
} = require("../src/services/avatarMatchService");
const { CHARACTER_DEFAULTS, validateCharacter } = require("../src/utils/characterConfig");

const USER = "507f1f77bcf86cd799439011";
const REQUEST_ID = "9f1c3ab2-7d34-4c15-9e8f-a1b2c3d4e5f6";
const API_KEY = "sk-or-avatar-test-secret-0051";

// ---- Minimal in-memory Redis fake (only the commands the service uses) ------
// eval() dispatches on the marker comment at the top of each Lua script and
// mirrors its logic; both sides must stay in sync.
function createFakeRedis({ failOps = false } = {}) {
  const data = new Map(); // key -> { value: string, expireAt: number | null }
  const liveEntry = (key) => {
    const entry = data.get(key);
    if (!entry) return null;
    if (entry.expireAt !== null && entry.expireAt <= Date.now()) {
      data.delete(key);
      return null;
    }
    return entry;
  };
  const ensure = (key) => {
    const existing = liveEntry(key);
    if (existing) return existing;
    const entry = { value: "0", expireAt: null };
    data.set(key, entry);
    return entry;
  };
  const num = (key) => {
    const entry = liveEntry(key);
    const parsed = entry ? Number(entry.value) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const pttl = (key) => {
    const entry = liveEntry(key);
    if (!entry) return -2;
    if (entry.expireAt === null) return -1;
    return Math.max(0, entry.expireAt - Date.now());
  };
  const maybeThrow = () => {
    if (failOps) throw new Error("fake redis unavailable");
  };
  const client = {
    status: "ready",
    rawSet(key, value, expireAt = null) {
      data.set(key, { value: String(value), expireAt });
    },
    rawGet(key) {
      return liveEntry(key)?.value ?? null;
    },
    async get(key) {
      maybeThrow();
      return liveEntry(key)?.value ?? null;
    },
    async set(key, value, ...rest) {
      maybeThrow();
      let nx = false;
      let expireAt = null;
      for (let i = 0; i < rest.length; i += 1) {
        const option = String(rest[i]).toUpperCase();
        if (option === "NX") nx = true;
        else if (option === "PX") {
          expireAt = Date.now() + Number(rest[i + 1]);
          i += 1;
        } else if (option === "EX") {
          expireAt = Date.now() + Number(rest[i + 1]) * 1000;
          i += 1;
        }
      }
      if (nx && liveEntry(key)) return null;
      data.set(key, { value: String(value), expireAt });
      return "OK";
    },
    async del(...keys) {
      maybeThrow();
      let deleted = 0;
      for (const key of keys) {
        if (liveEntry(key) && data.delete(key)) deleted += 1;
      }
      return deleted;
    },
    async eval(script, numKeys, ...args) {
      maybeThrow();
      const keys = args.slice(0, numKeys);
      const rawArgv = args.slice(numKeys); // release-lock compares the raw token
      const argv = rawArgv.map(Number);
      if (String(script).includes("avatar-match:reserve")) {
        const [rate, day, month, daySpend, monthSpend] = keys;
        const [
          reserveMicro, dailyCap, monthlyCap, rateLimit, dailyLimit, monthlyLimit,
          rateWindowSec, dayTtl, monthTtl,
        ] = argv;
        if (num(rate) >= rateLimit) return ["RATE_LIMITED", String(Math.max(0, pttl(rate)))];
        if (num(day) >= dailyLimit) return ["QUOTA_EXCEEDED", "0"];
        if (num(month) >= monthlyLimit) return ["QUOTA_EXCEEDED", "0"];
        if (num(daySpend) + reserveMicro > dailyCap) return ["BUDGET_EXHAUSTED", "0"];
        if (num(monthSpend) + reserveMicro > monthlyCap) return ["BUDGET_EXHAUSTED", "0"];
        data.set(rate, { value: "1", expireAt: Date.now() + rateWindowSec * 1000 });
        ensure(day).value = String(num(day) + 1);
        ensure(day).expireAt = Date.now() + dayTtl * 1000;
        ensure(month).value = String(num(month) + 1);
        ensure(month).expireAt = Date.now() + monthTtl * 1000;
        ensure(daySpend).value = String(num(daySpend) + reserveMicro);
        ensure(daySpend).expireAt = Date.now() + dayTtl * 1000;
        ensure(monthSpend).value = String(num(monthSpend) + reserveMicro);
        ensure(monthSpend).expireAt = Date.now() + monthTtl * 1000;
        return ["OK", "0"];
      }
      if (String(script).includes("avatar-match:reconcile")) {
        const [daySpend, monthSpend] = keys;
        const [delta, dayTtl, monthTtl] = argv;
        if (Number.isFinite(delta) && delta !== 0 && (delta > 0 || num(daySpend) + delta >= 0)) {
          ensure(daySpend).value = String(num(daySpend) + delta);
          ensure(daySpend).expireAt = Date.now() + dayTtl * 1000;
          ensure(monthSpend).value = String(num(monthSpend) + delta);
          ensure(monthSpend).expireAt = Date.now() + monthTtl * 1000;
        }
        return client.rawGet(daySpend);
      }
      if (String(script).includes("avatar-match:release-lock")) {
        const [key] = keys;
        const [token] = rawArgv;
        if (client.rawGet(key) === token && data.delete(key)) return 1;
        return 0;
      }
      throw new Error("fake redis received an unknown script");
    },
  };
  return client;
}

// ---- Crafted JPEG builder ---------------------------------------------------
const u16 = (value) => [value >> 8, value & 0xff];
const chars = (text) => [...text].map((character) => character.charCodeAt(0));
const segment = (marker, payload) => [0xff, marker, ...u16(payload.length + 2), ...payload];

function buildJpeg({
  width = 600, height = 800, app0 = true, exif = false, gps = false, comment = null,
  sof = true, entropy = 96, trailing = false,
} = {}) {
  const parts = [0xff, 0xd8];
  if (app0) parts.push(...segment(0xe0, [...chars("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (exif) parts.push(...segment(0xe1, [...chars("Exif\0\0"), 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, ...Array(24).fill(0x37)]));
  if (gps) parts.push(...segment(0xe1, [...chars("GPS\0"), 0, 1, ...Array(20).fill(0x51)]));
  if (comment) parts.push(...segment(0xfe, chars(comment)));
  parts.push(...segment(0xdb, [0, 1, 2, 3, ...Array(64).fill(0x20)])); // DQT
  if (sof) parts.push(...segment(0xc0, [8, ...u16(height), ...u16(width), 1, 1, 0x11, 0])); // SOF0
  parts.push(...segment(0xc4, [0x00, ...Array(12).fill(0x01)])); // DHT
  parts.push(...segment(0xda, [1, 1, 0x00, 0, 63, 0])); // SOS
  parts.push(...Array(entropy).fill(0xa7)); // entropy-coded data (no 0xff bytes)
  parts.push(0xff, 0xd9); // EOI
  if (trailing) parts.push(0x00, 0x00);
  return Buffer.from(parts);
}

const jpegDataUrl = (jpeg) => `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const requestBody = (jpeg, overrides = {}) => ({
  requestId: REQUEST_ID,
  image: jpegDataUrl(jpeg),
  ...overrides,
});

const HAPPY_BASE = { ...CHARACTER_DEFAULTS, clothing: "hoodie", shirtColor: "#123456", expression: "wink" };
const SUGGESTION = {
  status: "match", hair: "long", face: "soft", glasses: "none", facialHair: "none",
  headwear: "none", earrings: "none", clothing: null, freckles: false,
  skinTone: "skin3", hairColor: "black",
  faceWidth: 50, eyeSpacing: 50, noseSize: 50, mouthWidth: 50,
};

const providerResponse = (content, usage = { cost: 0.000044, total_tokens: 1200 }) => ({
  ok: true,
  status: 200,
  json: async () => ({
    id: "gen-abc123",
    provider: "alibaba",
    model: "qwen/qwen3.7-flash",
    choices: [{ message: { content } }],
    usage,
  }),
});

function makeHarness({ env = {}, fetchImpl, redis, silent = true, log } = {}) {
  const fetchCalls = [];
  const resolvedFetch =
    fetchImpl ||
    (async (url, init) => {
      fetchCalls.push({ url, init });
      return providerResponse(JSON.stringify(SUGGESTION));
    });
  const fakeRedis = redis || createFakeRedis();
  const service = createAvatarMatchService({
    redis: fakeRedis,
    fetchImpl: resolvedFetch,
    env: { SELFIE_MATCHING_ENABLED: "true", AVATAR_MATCH_API_KEY: API_KEY, ...env },
    // silent=false falls back to the real console so tests can capture output;
    // an explicit log wins over both.
    ...(log ? { log } : silent ? { log: { log: () => {} } } : {}),
  });
  return { service, fakeRedis, fetchCalls };
}

const keysNow = () => quotaKeys(USER, Date.now());

// ---- Flag and configuration -------------------------------------------------
test("feature flag and config default off in every environment", () => {
  for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "production" }]) {
    assert.equal(appConfig.isSelfieMatchingEnabled(env), false);
    assert.equal(readConfig(env).enabled, false);
  }
  assert.equal(appConfig.isSelfieMatchingEnabled({ SELFIE_MATCHING_ENABLED: "true" }), true);
  assert.equal(readConfig({ SELFIE_MATCHING_ENABLED: "true" }).enabled, false); // key missing
  assert.equal(readConfig({ SELFIE_MATCHING_ENABLED: "true", OPENROUTER_API_KEY: "k" }).enabled, true);
  assert.equal(readConfig({ SELFIE_MATCHING_ENABLED: "true", AVATAR_MATCH_API_KEY: "a", OPENROUTER_API_KEY: "b" }).apiKey, "a");
});

test("flag off returns 404 from the suggest route and enabled:false from status", async () => {
  const { service, fetchCalls } = makeHarness({ env: { SELFIE_MATCHING_ENABLED: "false" } });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 404);
  assert.equal(result.body.error.code, "FEATURE_DISABLED");
  const status = await service.getSuggestStatus({ userId: USER });
  assert.equal(status.httpStatus, 200);
  assert.deepEqual(status.body, { ok: true, enabled: false, remainingToday: null, remainingMonth: null });
  assert.equal(fetchCalls.length, 0);
});

test("missing provider key disables the feature", async () => {
  const { service } = makeHarness({ env: { SELFIE_MATCHING_ENABLED: "true", AVATAR_MATCH_API_KEY: "" } });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 404);
  assert.equal(result.body.error.code, "FEATURE_DISABLED");
  const status = await service.getSuggestStatus({ userId: USER });
  assert.equal(status.body.enabled, false);
});

// ---- Image validation --------------------------------------------------------
test("rejects non-JPEG data URLs, bad base64 and missing images", async () => {
  const { service, fetchCalls } = makeHarness();
  const cases = [
    ["png data URL", { image: "data:image/png;base64,iVBORw0KGgo=" }],
    ["remote URL", { image: "https://example.com/selfie.jpg" }],
    ["not base64", { image: "data:image/jpeg;base64,!!!!" }],
    ["odd-length base64", { image: "data:image/jpeg;base64,AAAAA" }],
    ["missing image", { image: undefined }],
    ["non-string image", { image: 42 }],
  ];
  for (const [label, overrides] of cases) {
    const body = { requestId: REQUEST_ID, ...overrides };
    const result = await service.suggestAvatar({ userId: USER, body });
    assert.equal(result.httpStatus, 400, label);
    assert.equal(result.body.error.code, "INVALID_IMAGE", label);
  }
  assert.equal(fetchCalls.length, 0);
});

test("rejects corrupt, truncated and trailing-garbage JPEGs", async () => {
  const { service, fetchCalls } = makeHarness();
  const garbage = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]);
  const truncated = buildJpeg().subarray(0, buildJpeg().length - 2);
  const trailing = buildJpeg({ trailing: true });
  for (const [label, jpeg] of [["garbage", garbage], ["truncated", truncated], ["trailing", trailing]]) {
    const result = await service.suggestAvatar({ userId: USER, body: requestBody(jpeg) });
    assert.equal(result.httpStatus, 400, label);
    assert.equal(result.body.error.code, "INVALID_IMAGE", label);
  }
  assert.equal(fetchCalls.length, 0);
});

test("rejects oversized images with 413 before decoding work", async () => {
  const { service, fetchCalls } = makeHarness();
  const oversized = `data:image/jpeg;base64,${"A".repeat(1_500_000)}`;
  const result = await service.suggestAvatar({ userId: USER, body: { requestId: REQUEST_ID, image: oversized } });
  assert.equal(result.httpStatus, 413);
  assert.equal(result.body.error.code, "IMAGE_TOO_LARGE");
  assert.equal(fetchCalls.length, 0);
  // A base64 string within the length cap but decoding past 1 MB is also 413.
  const decodedOver = decodeBase64Image(`data:image/jpeg;base64,${Buffer.alloc(1_100_000).toString("base64")}`);
  assert.equal(decodedOver.ok, false);
  assert.equal(decodedOver.code, "IMAGE_TOO_LARGE");
});

test("rejects too-large, too-small and missing SOF dimensions", async () => {
  const { service, fetchCalls } = makeHarness();
  const cases = [
    ["too wide", buildJpeg({ width: 1025, height: 600 })],
    ["too tall", buildJpeg({ width: 600, height: 2000 })],
    ["too narrow", buildJpeg({ width: 32, height: 600 })],
    ["too short", buildJpeg({ width: 600, height: 63 })],
    ["no SOF", buildJpeg({ sof: false })],
  ];
  for (const [label, jpeg] of cases) {
    const result = await service.suggestAvatar({ userId: USER, body: requestBody(jpeg) });
    assert.equal(result.httpStatus, 400, label);
    assert.equal(result.body.error.code, "INVALID_IMAGE", label);
  }
  assert.equal(fetchCalls.length, 0);
});

test("request validation rejects bad requestId and invalid base config", async () => {
  const { service, fetchCalls } = makeHarness();
  for (const [label, overrides] of [
    ["missing requestId", { requestId: undefined }],
    ["non-v4 requestId", { requestId: "12345678-1234-1234-1234-123456789012" }],
    ["v5 requestId", { requestId: "9f1c3ab2-7d34-5c15-9e8f-a1b2c3d4e5f6" }],
    ["invalid base", { base: { hair: "mohawk" } }],
    ["null base", { base: null }],
  ]) {
    const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg(), overrides) });
    assert.equal(result.httpStatus, 400, label);
    assert.equal(result.body.error.code, "INVALID_REQUEST", label);
  }
  assert.equal(fetchCalls.length, 0);
});

// ---- Metadata stripping -------------------------------------------------------
test("metadata stripping drops APP1/COM payloads and keeps image segments", () => {
  const jpeg = buildJpeg({ exif: true, gps: true, comment: "secret GPS note" });
  const stripped = stripJpegMetadata(jpeg);
  assert.equal(stripped.ok, true);
  assert.ok(!stripped.buffer.includes(Buffer.from("Exif")));
  assert.ok(!stripped.buffer.includes(Buffer.from("GPS")));
  assert.ok(!stripped.buffer.includes(Buffer.from("secret GPS note")));
  assert.ok(stripped.buffer.includes(Buffer.from("JFIF"))); // APP0 kept
  assert.ok(stripped.buffer.includes(Buffer.from([0xa7]))); // entropy kept
  assert.equal(stripped.buffer[0], 0xff);
  assert.equal(stripped.buffer[1], 0xd8);
  assert.equal(stripped.buffer[stripped.buffer.length - 2], 0xff);
  assert.equal(stripped.buffer[stripped.buffer.length - 1], 0xd9);
  const size = parseJpegSize(stripped.buffer);
  assert.equal(size.ok, true);
  assert.equal(size.width, 600);
  assert.equal(size.height, 800);
  assert.ok(stripped.buffer.length < jpeg.length);
  // Stripping again is a no-op (idempotent).
  const twice = stripJpegMetadata(stripped.buffer);
  assert.equal(twice.ok, true);
  assert.deepEqual(twice.buffer, stripped.buffer);
});

// ---- Happy path ---------------------------------------------------------------
test("happy path returns three valid configs that keep user-owned base fields", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness();
  const result = await service.suggestAvatar({
    userId: USER,
    body: requestBody(buildJpeg({ exif: true, comment: "strip me" }), { base: HAPPY_BASE }),
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.status, "match");
  assert.equal(result.body.model, "qwen/qwen3.7-flash");
  assert.equal(typeof result.body.promptVersion, "string");
  assert.equal(result.body.configs.length, 3);
  for (const config of result.body.configs) {
    assert.deepEqual(validateCharacter(config), config);
    assert.equal(config.clothing, "hoodie");
    assert.equal(config.shirtColor, "#123456");
    assert.equal(config.expression, "wink");
    assert.equal(config.skin, "#dca47c"); // skin3 palette id mapped to hex
    assert.equal(config.hair, "long");
  }
  // One provider call, authenticated correctly, with the stripped image.
  assert.equal(fetchCalls.length, 1);
  const { url, init } = fetchCalls[0];
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers["X-Title"], "Giggle");
  const providerBody = JSON.parse(init.body);
  assert.equal(providerBody.model, "qwen/qwen3.7-flash");
  assert.deepEqual(providerBody.response_format, { type: "json_object" });
  assert.deepEqual(providerBody.reasoning, { enabled: false, exclude: true });
  const sentImage = Buffer.from(
    providerBody.messages[1].content[1].image_url.url.replace("data:image/jpeg;base64,", ""),
    "base64"
  );
  assert.ok(!sentImage.includes(Buffer.from("strip me")));
  assert.equal(parseJpegSize(sentImage).width, 600);
  // Quota consumed once; spend reconciled to the billed cost (0.000044 USD = 44 micro).
  const keys = keysNow();
  assert.equal(fakeRedis.rawGet(keys.day), "1");
  assert.equal(fakeRedis.rawGet(keys.month), "1");
  assert.equal(fakeRedis.rawGet(keys.daySpend), "44");
  assert.equal(fakeRedis.rawGet(keys.monthSpend), "44");
});

test("no_face status returns empty configs but consumes quota and reconciles", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return providerResponse(JSON.stringify({ ...SUGGESTION, status: "no_face", hair: null, skinTone: null }), {
        cost: 0.000031,
        total_tokens: 900,
      });
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, { ok: true, status: "no_face", configs: [] });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fakeRedis.rawGet(keysNow().day), "1");
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "31");
});

// ---- Failure paths --------------------------------------------------------------
test("invalid model JSON returns MATCH_FAILED with quota still consumed", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return providerResponse("not json at all", { cost: 0.00005, total_tokens: 800 });
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 502);
  assert.equal(result.body.error.code, "MATCH_FAILED");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fakeRedis.rawGet(keysNow().day), "1");
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "50");
});

test("timeout returns MATCH_TIMEOUT and keeps the full reservation", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    env: { AVATAR_MATCH_TIMEOUT_MS: "40" },
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        fetchCalls.push({ url, init });
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 504);
  assert.equal(result.body.error.code, "MATCH_TIMEOUT");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fakeRedis.rawGet(keysNow().day), "1");
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "5000"); // 0.005 USD reservation kept
});

test("a provider that stalls after headers still times out and keeps the reservation", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    env: { AVATAR_MATCH_TIMEOUT_MS: "40" },
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: () => new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      };
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 504);
  assert.equal(result.body.error.code, "MATCH_TIMEOUT");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "5000");
  assert.equal(fakeRedis.rawGet(keysNow().inflight), null, "the in-flight lock is released");
});

test("provider HTTP error returns UNAVAILABLE and keeps the reservation", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return { ok: false, status: 500, json: async () => ({}) };
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.error.code, "UNAVAILABLE");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "5000");
});

// ---- Primary refusal (429/503) fallback ---------------------------------------
const FALLBACK_MODEL = "qwen/qwen3-vl-8b-instruct";
const refusal = (status) => ({ ok: false, status, json: async () => ({}) });

test("fallback config: default model, explicit empty disables, structured/reasoning default off", () => {
  assert.equal(readConfig({}).fallbackModel, FALLBACK_MODEL); // unset keeps the default
  assert.equal(readConfig({ AVATAR_MATCH_FALLBACK_MODEL: "" }).fallbackModel, ""); // "" disables
  assert.equal(readConfig({ AVATAR_MATCH_FALLBACK_MODEL: "other/model" }).fallbackModel, "other/model");
  assert.equal(readConfig({}).fallbackStructured, false);
  assert.equal(readConfig({ AVATAR_MATCH_FALLBACK_STRUCTURED: "true" }).fallbackStructured, true);
  assert.equal(readConfig({}).fallbackReasoningControl, false);
  assert.equal(readConfig({ AVATAR_MATCH_FALLBACK_REASONING_CONTROL: "true" }).fallbackReasoningControl, true);
});

test("primary 429 falls back once; the answer reports the fallback model and its cost", async () => {
  const lines = [];
  const { service, fakeRedis, fetchCalls } = makeHarness({
    log: { log: (...args) => lines.push(args.map(String).join(" ")) },
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetchCalls.length === 1
        ? refusal(429)
        : providerResponse(JSON.stringify(SUGGESTION), { cost: 0.000037, total_tokens: 1500 });
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, "match");
  assert.equal(result.body.model, FALLBACK_MODEL); // the model that actually answered
  assert.equal(fetchCalls.length, 2); // exactly one fallback call, never more
  assert.equal(fakeRedis.rawGet(keysNow().day), "1"); // quota consumed once, not per attempt
  assert.equal(fakeRedis.rawGet(keysNow().month), "1");
  // Reconciled to the fallback's billed cost (0.000037 USD = 37 micro), not the primary's.
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "37");
  assert.equal(fakeRedis.rawGet(keysNow().monthSpend), "37");
  // One log line per provider attempt; the second carries fallback:true.
  const attempts = lines.map((line) => JSON.parse(line.slice(line.indexOf("{"))));
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].model, "qwen/qwen3.7-flash");
  assert.equal(attempts[0].status, "provider_error");
  assert.equal(attempts[0].httpStatus, 429);
  assert.equal(attempts[0].fallback, undefined);
  assert.equal(attempts[1].model, FALLBACK_MODEL);
  assert.equal(attempts[1].fallback, true);
  assert.equal(attempts[1].status, "match");
});

test("the fallback request body omits reasoning; the primary's keeps it", async () => {
  const { service, fetchCalls } = makeHarness({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetchCalls.length === 1 ? refusal(429) : providerResponse(JSON.stringify(SUGGESTION));
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 200);
  const primaryBody = JSON.parse(fetchCalls[0].init.body);
  const fallbackBody = JSON.parse(fetchCalls[1].init.body);
  assert.deepEqual(primaryBody.reasoning, { enabled: false, exclude: true }); // reasoningControl true by default
  assert.ok(!("reasoning" in fallbackBody), "the fallback must not send the reasoning parameter by default");
  assert.deepEqual(fallbackBody.response_format, { type: "json_object" }); // fallbackStructured false by default
});

test("primary 503 also falls back", async () => {
  const { service, fetchCalls } = makeHarness({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetchCalls.length === 1 ? refusal(503) : providerResponse(JSON.stringify(SUGGESTION));
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.model, FALLBACK_MODEL);
  assert.equal(fetchCalls.length, 2);
});

test("only a 429/503 refusal falls back; other primary failures stand alone", async () => {
  // [label, responder, expected error code, expected status, expected day spend]
  // (an invalid 200 body is billed and reconciled; the others keep the reservation).
  const cases = [
    ["http 500", () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }), "UNAVAILABLE", 503, "5000"],
    ["network error", () => Promise.reject(new Error("connection reset")), "UNAVAILABLE", 503, "5000"],
    [
      "timeout",
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      "MATCH_TIMEOUT",
      504,
      "5000",
    ],
    ["invalid JSON from a 200", () => Promise.resolve(providerResponse("not json at all")), "MATCH_FAILED", 502, "44"],
  ];
  for (const [label, respond, expectedCode, expectedStatus, expectedSpend] of cases) {
    const fetchCalls = [];
    const { service, fakeRedis } = makeHarness({
      env: { AVATAR_MATCH_TIMEOUT_MS: "40" }, // bounded even for the timeout case
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url, init });
        return respond(url, init);
      },
    });
    const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
    assert.equal(result.httpStatus, expectedStatus, label);
    assert.equal(result.body.error.code, expectedCode, label);
    assert.equal(fetchCalls.length, 1, label); // no second provider call
    assert.equal(fakeRedis.rawGet(keysNow().daySpend), expectedSpend, label);
  }
});

test("a fallback that is also refused returns UNAVAILABLE with the reservation kept", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return refusal(429);
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.error.code, "UNAVAILABLE");
  assert.equal(fetchCalls.length, 2); // primary + fallback, and that is all
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "5000"); // uncertain billing: full reservation kept
});

test("an explicitly empty or same-as-primary fallback model disables the fallback", async () => {
  for (const [label, fallbackModel] of [
    ["explicitly empty", ""],
    ["same as primary", "qwen/qwen3.7-flash"],
  ]) {
    const fetchCalls = [];
    const { service, fakeRedis } = makeHarness({
      env: { AVATAR_MATCH_FALLBACK_MODEL: fallbackModel },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url, init });
        return refusal(429);
      },
    });
    const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
    assert.equal(result.httpStatus, 503, label);
    assert.equal(result.body.error.code, "UNAVAILABLE", label);
    assert.equal(fetchCalls.length, 1, label);
    assert.equal(fakeRedis.rawGet(keysNow().daySpend), "5000", label);
  }
});

test("the primary and fallback share one overall timeout budget", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    env: { AVATAR_MATCH_TIMEOUT_MS: "40" },
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      if (fetchCalls.length === 1) return refusal(429); // refuses immediately
      // The fallback sends headers and then stalls forever.
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      };
    },
  });
  const startedAt = Date.now();
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 504);
  assert.equal(result.body.error.code, "MATCH_TIMEOUT");
  assert.equal(fetchCalls.length, 2);
  // Both attempts ride the same AbortController: one timer bounds the pair.
  assert.equal(fetchCalls[0].init.signal, fetchCalls[1].init.signal);
  assert.ok(Date.now() - startedAt < 5000, "the shared timer must still fire");
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "5000");
});

test("budget cap refusal happens before any fetch call", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    env: { AVATAR_MATCH_DAILY_BUDGET_USD: "0.002" }, // below the 0.005 reservation
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.error.code, "BUDGET_EXHAUSTED");
  assert.equal(fetchCalls.length, 0);
  const keys = keysNow();
  assert.equal(fakeRedis.rawGet(keys.day), null); // no quota consumed either
  assert.equal(fakeRedis.rawGet(keys.daySpend), null);
});

test("a failed pending idempotency write consumes nothing and skips the provider", async () => {
  const fakeRedis = createFakeRedis();
  const failingPendingSet = Object.create(fakeRedis);
  failingPendingSet.set = async (key, value, ...rest) => {
    if (key.startsWith("avatar-match:idem:") && String(value).includes("pending")) {
      throw new Error("fake redis unavailable");
    }
    return fakeRedis.set(key, value, ...rest);
  };
  const { service, fetchCalls } = makeHarness({ redis: failingPendingSet });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.error.code, "UNAVAILABLE");
  assert.equal(fetchCalls.length, 0);
  const keys = keysNow();
  assert.equal(fakeRedis.rawGet(keys.day), null); // the reservation never ran
  assert.equal(fakeRedis.rawGet(keys.month), null);
  assert.equal(fakeRedis.rawGet(keys.daySpend), null);
  assert.equal(fakeRedis.rawGet(keys.inflight), null); // the lock is still released
});

// ---- Rate and quota limits --------------------------------------------------------
test("second request inside the 60s window is rate limited with retryAfterSeconds", async () => {
  const { service, fetchCalls } = makeHarness();
  const first = await service.suggestAvatar({
    userId: USER,
    body: requestBody(buildJpeg(), { requestId: "11111111-2222-4333-8444-555555555555" }),
  });
  assert.equal(first.httpStatus, 200);
  const second = await service.suggestAvatar({
    userId: USER,
    body: requestBody(buildJpeg(), { requestId: "66666666-7777-4888-8999-000000000000" }),
  });
  assert.equal(second.httpStatus, 429);
  assert.equal(second.body.error.code, "RATE_LIMITED");
  assert.ok(second.body.error.retryAfterSeconds >= 1 && second.body.error.retryAfterSeconds <= 60);
  assert.equal(Number(second.headers["Retry-After"]), second.body.error.retryAfterSeconds);
  assert.equal(fetchCalls.length, 1);
});

test("daily and monthly quotas refuse without a provider call", async () => {
  const keys = keysNow();
  const daily = makeHarness();
  daily.fakeRedis.rawSet(keys.day, "3");
  const dailyResult = await daily.service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(dailyResult.httpStatus, 429);
  assert.equal(dailyResult.body.error.code, "QUOTA_EXCEEDED");
  assert.equal(daily.fetchCalls.length, 0);

  const monthly = makeHarness();
  monthly.fakeRedis.rawSet(keys.month, "10");
  const monthlyResult = await monthly.service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(monthlyResult.httpStatus, 429);
  assert.equal(monthlyResult.body.error.code, "QUOTA_EXCEEDED");
  assert.equal(monthly.fetchCalls.length, 0);
});

// ---- Concurrency and idempotency ------------------------------------------------
test("a second concurrent request gets 409 IN_PROGRESS and the lock is released", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    env: { AVATAR_MATCH_TIMEOUT_MS: "60" },
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        fetchCalls.push({ url, init });
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  const first = service.suggestAvatar({
    userId: USER,
    body: requestBody(buildJpeg(), { requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }),
  });
  const second = await service.suggestAvatar({
    userId: USER,
    body: requestBody(buildJpeg(), { requestId: "ffffffff-0000-4111-8222-333333333333" }),
  });
  assert.equal(second.httpStatus, 409);
  assert.equal(second.body.error.code, "IN_PROGRESS");
  const firstResult = await first;
  assert.equal(firstResult.httpStatus, 504);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fakeRedis.rawGet(keysNow().inflight), null); // released in finally
});

test("the in-flight lock is released only by its current owner", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      // The PX lease expired and another request took the lock meanwhile.
      fakeRedis.rawSet(keysNow().inflight, "another-owners-token");
      return providerResponse(JSON.stringify(SUGGESTION));
    },
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 200);
  assert.equal(fetchCalls.length, 1);
  // The stale owner's release must not delete the new owner's lock.
  assert.equal(fakeRedis.rawGet(keysNow().inflight), "another-owners-token");
});

test("after a timeout the same requestId is retryable and re-enters the guards", async () => {
  const { service, fakeRedis, fetchCalls } = makeHarness({
    env: { AVATAR_MATCH_TIMEOUT_MS: "40" },
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        fetchCalls.push({ url, init });
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  const first = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(first.httpStatus, 504);
  assert.equal(first.body.error.code, "MATCH_TIMEOUT");
  // The transient outcome is not cached: the retry runs the reservation again
  // and is answered by the 60s rate window, not by a stored result.
  const retry = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(retry.httpStatus, 429);
  assert.equal(retry.body.error.code, "RATE_LIMITED");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fakeRedis.rawGet(keysNow().day), "1"); // the retry consumed nothing
});

test("MATCH_FAILED is a final outcome and is replayed from the idempotency cache", async () => {
  const { service, fetchCalls } = makeHarness({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return providerResponse("not json at all", { cost: 0.00005, total_tokens: 800 });
    },
  });
  const first = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(first.httpStatus, 502);
  const replay = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(replay.httpStatus, 502);
  assert.deepEqual(replay.body, first.body);
  assert.equal(fetchCalls.length, 1); // the replay never reached the provider
});

test("idempotent replay returns the stored result with fetch called once", async () => {
  const { service, fetchCalls } = makeHarness();
  const first = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(first.httpStatus, 200);
  const replay = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(replay.httpStatus, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(fetchCalls.length, 1);
});

test("replaying the requestId of a running request returns 409 IN_PROGRESS", async () => {
  const { service } = makeHarness({
    env: { AVATAR_MATCH_TIMEOUT_MS: "60" },
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  const first = service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  const replay = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(replay.httpStatus, 409);
  assert.equal(replay.body.error.code, "IN_PROGRESS");
  assert.equal((await first).httpStatus, 504);
});

// ---- Redis availability -----------------------------------------------------------
test("Redis failures return UNAVAILABLE with no provider call and status reports disabled", async () => {
  const failingRedis = createFakeRedis({ failOps: true });
  const { service, fetchCalls } = makeHarness({ redis: failingRedis });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.error.code, "UNAVAILABLE");
  assert.equal(fetchCalls.length, 0);
  const status = await service.getSuggestStatus({ userId: USER });
  assert.equal(status.httpStatus, 200);
  assert.equal(status.body.enabled, false);
  assert.equal(status.body.remainingToday, null);
  assert.equal(status.body.remainingMonth, null);
});

// ---- Secret hygiene ------------------------------------------------------------------
test("the API key never appears in response bodies or captured console output", async () => {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { lines.push(args.map(String).join(" ")); };
  console.error = (...args) => { lines.push(args.map(String).join(" ")); };
  const bodies = [];
  try {
    const harness = makeHarness({ silent: false }); // no injected log: defaults to console
    const outcomes = [];
    outcomes.push(await harness.service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) }));
    const broken = makeHarness({
      silent: false,
      fetchImpl: async () => providerResponse("###invalid###"),
    });
    outcomes.push(await broken.service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) }));
    const offline = makeHarness({ silent: false, redis: createFakeRedis({ failOps: true }) });
    outcomes.push(await offline.service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) }));
    bodies.push(...outcomes.map((outcome) => outcome.body));
    assert.ok(outcomes.some((outcome) => outcome.httpStatus === 200));
    assert.ok(outcomes.some((outcome) => outcome.httpStatus === 502));
    assert.ok(outcomes.some((outcome) => outcome.httpStatus === 503));
    assert.ok(lines.length > 0, "the service logs one line per provider attempt");
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.ok(!JSON.stringify(bodies).includes(API_KEY));
  for (const line of lines) {
    assert.ok(!line.includes(API_KEY), `console leak: ${line.slice(0, 120)}`);
  }
});

// ---- Reconciliation and status ---------------------------------------------------
test("reconciliation adjusts spend to the billed cost and unknown billing keeps the reservation", async () => {
  const cheap = makeHarness({
    fetchImpl: async () => providerResponse(JSON.stringify(SUGGESTION), { cost: 0.000002, total_tokens: 500 }),
  });
  const cheapResult = await cheap.service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(cheapResult.httpStatus, 200);
  assert.equal(cheap.fakeRedis.rawGet(keysNow().daySpend), "2");

  const unknownBilling = makeHarness({
    fetchImpl: async () => providerResponse(JSON.stringify(SUGGESTION), {}),
  });
  const unknownResult = await unknownBilling.service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(unknownResult.httpStatus, 200);
  assert.equal(unknownBilling.fakeRedis.rawGet(keysNow().daySpend), "5000");
});

test("large billed costs reconcile the spend counters upward", async () => {
  const { service, fakeRedis } = makeHarness({
    fetchImpl: async () => providerResponse(JSON.stringify(SUGGESTION), { cost: 2, total_tokens: 900000 }),
  });
  const result = await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  assert.equal(result.httpStatus, 200);
  // 2 USD = 2,000,000 micro: reservation (5,000) plus 1,995,000 reconciled.
  assert.equal(fakeRedis.rawGet(keysNow().daySpend), "2000000");
  assert.equal(fakeRedis.rawGet(keysNow().monthSpend), "2000000");
});

test("status reports remaining quota after a successful match", async () => {
  const { service } = makeHarness();
  await service.suggestAvatar({ userId: USER, body: requestBody(buildJpeg()) });
  const status = await service.getSuggestStatus({ userId: USER });
  assert.equal(status.httpStatus, 200);
  assert.deepEqual(status.body, { ok: true, enabled: true, remainingToday: 2, remainingMonth: 9 });
});
