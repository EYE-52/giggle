// Selfie → avatar suggestion: one bounded, paid vision request per accepted
// upload, gated by a flag, per-user quotas and reserved app-wide budget.
// Implements the "Spending, privacy, and failure controls" section of
// docs/SELFIE_MATCHING_PLAN.md. One bounded 429/503 fallback, no image
// persistence: the decoded buffer lives only in request scope and never
// reaches Redis, Mongo or logs.
// Rolling per-user windows are approximated with fixed UTC day / calendar
// month buckets (keys carry the bucket date, so a bucket never straddles days).
const crypto = require("node:crypto");
const {
  MATCH_PROMPT_VERSION,
  buildMatchRequest,
  parseSuggestion,
  suggestionToConfig,
  suggestionVariations,
} = require("../utils/avatarMatch");
const { CHARACTER_DEFAULTS, validateCharacter } = require("../utils/characterConfig");
const { isSelfieMatchingEnabled } = require("../config/appConfig");

const DATA_URL_PREFIX = "data:image/jpeg;base64,";
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_LENGTH = 1_400_000; // ≈1.4 MB base64 ⇒ ≤1 MB decoded
const MAX_DECODED_BYTES = 1_048_576;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 1024;
const MICRO_USD = 1_000_000;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const IN_FLIGHT_LOCK_MS = 60_000;
// Per-user limits (docs/SELFIE_MATCHING_PLAN.md pilot settings).
const RATE_WINDOW_SECONDS = 60;
const RATE_LIMIT_PER_WINDOW = 1;
const DAILY_REQUEST_LIMIT = 3;
const MONTHLY_REQUEST_LIMIT = 10;
// Counter cleanup horizons; well past the bucket they name.
const DAY_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;
const MONTH_KEY_TTL_SECONDS = 35 * 24 * 60 * 60;

const DEFAULT_MODEL = "qwen/qwen3.7-flash"; // chosen by the measured synthetic pilot
// Answers normally while the primary endpoint intermittently refuses with
// 429; used for exactly one second attempt after such a refusal.
const DEFAULT_FALLBACK_MODEL = "qwen/qwen3-vl-8b-instruct";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_RESERVE_USD = 0.005;
const DEFAULT_DAILY_BUDGET_USD = 1;
const DEFAULT_MONTHLY_BUDGET_USD = 10;
const DEFAULT_TIMEOUT_MS = 20_000;

// Atomically applies every spending guard before anything is consumed: either
// the rate window, both quota buckets and both spend reservations all succeed,
// or nothing changes. Keys: rate, day, month, daySpend, monthSpend.
const RESERVE_LUA = `
-- avatar-match:reserve
local rate = KEYS[1]
local day = KEYS[2]
local month = KEYS[3]
local daySpend = KEYS[4]
local monthSpend = KEYS[5]
local reserveMicro = tonumber(ARGV[1])
local dailyCapMicro = tonumber(ARGV[2])
local monthlyCapMicro = tonumber(ARGV[3])
local rateLimit = tonumber(ARGV[4])
local dailyLimit = tonumber(ARGV[5])
local monthlyLimit = tonumber(ARGV[6])
local rateWindowSec = tonumber(ARGV[7])
local dayTtl = tonumber(ARGV[8])
local monthTtl = tonumber(ARGV[9])
if tonumber(redis.call('GET', rate) or '0') >= rateLimit then
  local ttl = tonumber(redis.call('PTTL', rate))
  if ttl < 0 then ttl = rateWindowSec * 1000 end
  return {'RATE_LIMITED', tostring(ttl)}
end
if tonumber(redis.call('GET', day) or '0') >= dailyLimit then
  return {'QUOTA_EXCEEDED', '0'}
end
if tonumber(redis.call('GET', month) or '0') >= monthlyLimit then
  return {'QUOTA_EXCEEDED', '0'}
end
if tonumber(redis.call('GET', daySpend) or '0') + reserveMicro > dailyCapMicro then
  return {'BUDGET_EXHAUSTED', '0'}
end
if tonumber(redis.call('GET', monthSpend) or '0') + reserveMicro > monthlyCapMicro then
  return {'BUDGET_EXHAUSTED', '0'}
end
redis.call('SET', rate, '1', 'EX', rateWindowSec)
redis.call('INCR', day)
redis.call('EXPIRE', day, dayTtl)
redis.call('INCR', month)
redis.call('EXPIRE', month, monthTtl)
redis.call('INCRBY', daySpend, reserveMicro)
redis.call('EXPIRE', daySpend, dayTtl)
redis.call('INCRBY', monthSpend, reserveMicro)
redis.call('EXPIRE', monthSpend, monthTtl)
return {'OK', '0'}
`;

// Adjusts both spend counters by (actual - reserved) micro-dollars after the
// provider answers. A delta of 0 (unknown billing, timeout, network error)
// keeps the full reservation.
const RECONCILE_LUA = `
-- avatar-match:reconcile
local delta = tonumber(ARGV[1])
if delta == nil or delta == 0 then return redis.call('GET', KEYS[1]) end
if delta > 0 or tonumber(redis.call('GET', KEYS[1]) or '0') + delta >= 0 then
  redis.call('INCRBY', KEYS[1], delta)
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  redis.call('INCRBY', KEYS[2], delta)
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
end
return redis.call('GET', KEYS[1])
`;

// Releases the in-flight lock only when this request still owns it: a request
// that outlived its PX lease must not delete a newer owner's lock.
const RELEASE_LOCK_LUA = `
-- avatar-match:release-lock
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end
`;

const sha256hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isUuidV4 = (value) =>
  typeof value === "string" && UUID_V4_PATTERN.test(value);

const pad2 = (value) => String(value).padStart(2, "0");
function utcDateParts(nowMs) {
  const date = new Date(nowMs);
  const day = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  const month = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
  return { day, month };
}

// Redis key layout (tests rely on this to pre-seed counters).
function quotaKeys(userId, nowMs) {
  const { day, month } = utcDateParts(nowMs);
  return {
    inflight: `avatar-match:inflight:${userId}`,
    rate: `avatar-match:rate:${userId}`,
    day: `avatar-match:day:${userId}:${day}`,
    month: `avatar-match:month:${userId}:${month}`,
    daySpend: `avatar-match:spend:day:${day}`,
    monthSpend: `avatar-match:spend:month:${month}`,
  };
}

const fail = (httpStatus, code, message, extra = null) => ({
  httpStatus,
  body: { ok: false, error: extra ? { code, message, ...extra } : { code, message } },
});

const toFiniteNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// All configuration is read at call time so tests and late env changes are
// honored. AVATAR_MATCH_API_KEY is a separate capped OpenRouter key; the
// generic OPENROUTER_API_KEY is only a fallback. It is never logged, returned
// or embedded in errors.
function readConfig(env = process.env) {
  const apiKey = typeof env.AVATAR_MATCH_API_KEY === "string" && env.AVATAR_MATCH_API_KEY
    ? env.AVATAR_MATCH_API_KEY
    : typeof env.OPENROUTER_API_KEY === "string" && env.OPENROUTER_API_KEY
    ? env.OPENROUTER_API_KEY
    : null;
  return {
    apiKey,
    flagEnabled: isSelfieMatchingEnabled(env),
    enabled: isSelfieMatchingEnabled(env) && Boolean(apiKey),
    model: typeof env.AVATAR_MATCH_MODEL === "string" && env.AVATAR_MATCH_MODEL
      ? env.AVATAR_MATCH_MODEL
      : DEFAULT_MODEL,
    structured: env.AVATAR_MATCH_STRUCTURED === "true",
    reasoningControl: env.AVATAR_MATCH_REASONING_CONTROL !== "false",
    // An explicitly EMPTY AVATAR_MATCH_FALLBACK_MODEL disables the fallback;
    // an unset one keeps the default, hence hasOwn instead of a truthiness
    // check on the value.
    fallbackModel: Object.hasOwn(env, "AVATAR_MATCH_FALLBACK_MODEL")
      ? String(env.AVATAR_MATCH_FALLBACK_MODEL)
      : DEFAULT_FALLBACK_MODEL,
    fallbackStructured: env.AVATAR_MATCH_FALLBACK_STRUCTURED === "true",
    fallbackReasoningControl: env.AVATAR_MATCH_FALLBACK_REASONING_CONTROL === "true",
    baseUrl: (env.AVATAR_MATCH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    reserveUsd: toFiniteNumber(env.AVATAR_MATCH_RESERVE_USD, DEFAULT_RESERVE_USD),
    dailyBudgetUsd: toFiniteNumber(env.AVATAR_MATCH_DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD),
    monthlyBudgetUsd: toFiniteNumber(env.AVATAR_MATCH_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD),
    timeoutMs: toFiniteNumber(env.AVATAR_MATCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

// ---- Dependency-free JPEG handling -----------------------------------------

const isStandaloneMarker = (marker) =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
const isSofMarker = (marker) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
// APP1–APP15 (EXIF/XMP/GPS/ICC) and COM carry metadata; APP0/JFIF stays.
const isMetadataMarker = (marker) =>
  (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;

const corruptJpeg = () => ({ ok: false, code: "INVALID_IMAGE", message: "Corrupt JPEG data" });

// Rewrites the byte stream without APP1–APP15/COM segments. Walks the
// length-prefixed segment chain, keeps the entropy-coded scan verbatim
// (honouring 0x00 stuffing and RST markers) and strips metadata segments
// wherever they appear. Requires SOI at the start and EOI at the very end.
function stripJpegMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return corruptJpeg();
  }
  // Buffer chunks (never spread large arrays into push(): 1 MB images would
  // overflow the call stack).
  const chunks = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) return corruptJpeg();
    let j = i + 1;
    while (j < buffer.length && buffer[j] === 0xff) j += 1; // fill bytes
    if (j >= buffer.length) return corruptJpeg();
    const marker = buffer[j];
    if (marker === 0x00) return corruptJpeg(); // stuffed byte outside entropy data
    if (marker === 0xd9) {
      chunks.push(Buffer.from([0xff, 0xd9]));
      if (j + 1 !== buffer.length) return corruptJpeg(); // trailing garbage after EOI
      return { ok: true, buffer: Buffer.concat(chunks) };
    }
    if (isStandaloneMarker(marker)) {
      chunks.push(Buffer.from([0xff, marker]));
      i = j + 1;
      continue;
    }
    if (j + 3 > buffer.length) return corruptJpeg();
    const length = buffer.readUInt16BE(j + 1);
    if (length < 2) return corruptJpeg();
    const segmentEnd = j + 1 + length;
    if (segmentEnd > buffer.length) return corruptJpeg();
    if (!isMetadataMarker(marker)) {
      chunks.push(Buffer.from([0xff]), buffer.subarray(j, segmentEnd));
    }
    i = segmentEnd;
    if (marker === 0xda) {
      // Entropy-coded scan: copy bytes until the next real marker.
      let k = segmentEnd;
      while (k < buffer.length) {
        if (buffer[k] !== 0xff) {
          k += 1;
          continue;
        }
        if (k + 1 >= buffer.length) return corruptJpeg();
        const next = buffer[k + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          k += 2; // byte stuffing / restart marker
          continue;
        }
        break;
      }
      chunks.push(buffer.subarray(segmentEnd, k));
      i = k;
    }
  }
  return corruptJpeg(); // ran out of bytes without EOI
}

// Validates the whole segment chain and reads width/height from the first
// SOFn marker (which must precede the scan).
function parseJpegSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { ok: false, reason: "missing SOI" };
  }
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) return { ok: false, reason: "expected marker" };
    let j = i + 1;
    while (j < buffer.length && buffer[j] === 0xff) j += 1;
    if (j >= buffer.length) return { ok: false, reason: "truncated marker" };
    const marker = buffer[j];
    if (marker === 0x00) return { ok: false, reason: "stuffed byte outside entropy data" };
    if (marker === 0xd9) {
      return j + 1 === buffer.length
        ? { ok: false, reason: "no frame marker" }
        : { ok: false, reason: "trailing bytes after EOI" };
    }
    if (isStandaloneMarker(marker)) {
      i = j + 1;
      continue;
    }
    if (j + 3 > buffer.length) return { ok: false, reason: "truncated segment" };
    const length = buffer.readUInt16BE(j + 1);
    if (length < 2) return { ok: false, reason: "bad segment length" };
    const segmentEnd = j + 1 + length;
    if (segmentEnd > buffer.length) return { ok: false, reason: "truncated segment" };
    if (isSofMarker(marker)) {
      if (length < 7) return { ok: false, reason: "short frame header" };
      return { ok: true, height: buffer.readUInt16BE(j + 4), width: buffer.readUInt16BE(j + 6) };
    }
    i = segmentEnd;
    if (marker === 0xda) return { ok: false, reason: "no frame marker before scan" };
  }
  return { ok: false, reason: "no EOI" };
}

// Data-URL validation → decoded buffer. Nothing is written anywhere.
function decodeBase64Image(image) {
  if (typeof image !== "string" || !image.startsWith(DATA_URL_PREFIX)) {
    return { ok: false, status: 400, code: "INVALID_IMAGE", message: "image must be a data:image/jpeg;base64 data URL" };
  }
  const base64 = image.slice(DATA_URL_PREFIX.length);
  if (base64.length > MAX_BASE64_LENGTH) {
    return { ok: false, status: 413, code: "IMAGE_TOO_LARGE", message: "image exceeds the size limit" };
  }
  if (base64.length === 0 || base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) {
    return { ok: false, status: 400, code: "INVALID_IMAGE", message: "image is not valid base64" };
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_DECODED_BYTES) {
    return { ok: false, status: 413, code: "IMAGE_TOO_LARGE", message: "image exceeds the size limit" };
  }
  return { ok: true, buffer };
}

// ---- Service ---------------------------------------------------------------

const isRedisReady = (client) => {
  if (!client || typeof client.eval !== "function" || typeof client.get !== "function") return false;
  const status = client.status;
  return typeof status !== "string" || status === "ready" || status === "connect";
};

const toCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

// Billed cost → micro-dollars; null when missing or not a finite
// non-negative number (then the full reservation stays put, per the
// uncertain-billing rule).
const costToMicroUsd = (usage) => {
  const cost = usage?.cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return null;
  return Math.round(cost * MICRO_USD);
};

const parseIdempotencyEntry = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && (parsed.state === "pending" || parsed.state === "done")) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
};

function createAvatarMatchService(deps = {}) {
  const envOf = deps.env ? () => deps.env : () => process.env;
  const fetchOf = () => (typeof deps.fetchImpl === "function" ? deps.fetchImpl : globalThis.fetch);
  const nowOf = typeof deps.now === "function" ? deps.now : Date.now;
  const logger = deps.log || console;
  // redisConfig is resolved lazily so requiring this module (and the flag-off
  // request path) never opens connections; tests inject a fake client.
  const redisOf = () => (deps.redis !== undefined ? deps.redis : require("../config/redisConfig").redis);

  const logAttempt = (fields) => {
    // One line per provider attempt; never the image, prompt, content or key.
    logger.log("[avatar-match]", JSON.stringify(fields));
  };

  async function getSuggestStatus({ userId }) {
    const offline = () => ({
      httpStatus: 200,
      body: { ok: true, enabled: false, remainingToday: null, remainingMonth: null },
    });
    const config = readConfig(envOf());
    if (!config.enabled) return offline();
    const redis = redisOf();
    if (!isRedisReady(redis)) return offline();
    try {
      const keys = quotaKeys(userId, nowOf());
      const [dayCount, monthCount] = await Promise.all([redis.get(keys.day), redis.get(keys.month)]);
      return {
        httpStatus: 200,
        body: {
          ok: true,
          enabled: true,
          remainingToday: Math.max(0, DAILY_REQUEST_LIMIT - toCount(dayCount)),
          remainingMonth: Math.max(0, MONTHLY_REQUEST_LIMIT - toCount(monthCount)),
        },
      };
    } catch {
      return offline();
    }
  }

  async function suggestAvatar({ userId, body }) {
    const config = readConfig(envOf());
    if (!config.enabled) {
      return fail(404, "FEATURE_DISABLED", "Avatar photo matching is not available");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail(400, "INVALID_REQUEST", "Invalid request body");
    }
    if (!isUuidV4(body.requestId)) {
      return fail(400, "INVALID_REQUEST", "requestId must be a client-generated UUID v4");
    }
    let base = CHARACTER_DEFAULTS;
    if (body.base !== undefined) {
      base = validateCharacter(body.base);
      if (!base) return fail(400, "INVALID_REQUEST", "base must be a valid character configuration");
    }
    const image = decodeBase64Image(body.image);
    if (!image.ok) return fail(image.status, image.code, image.message);
    const size = parseJpegSize(image.buffer);
    if (!size.ok) return fail(400, "INVALID_IMAGE", "image is not a readable JPEG");
    if (size.width < MIN_DIMENSION || size.height < MIN_DIMENSION) {
      return fail(400, "INVALID_IMAGE", `image dimensions must be at least ${MIN_DIMENSION}px`);
    }
    if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
      return fail(400, "INVALID_IMAGE", `image dimensions must be at most ${MAX_DIMENSION}px`);
    }
    const stripped = stripJpegMetadata(image.buffer);
    if (!stripped.ok) return fail(400, "INVALID_IMAGE", stripped.message);
    // The stripped bytes exist only in this call's scope; nothing below persists them.
    const imageDataUrl = `data:image/jpeg;base64,${stripped.buffer.toString("base64")}`;

    const redis = redisOf();
    if (!isRedisReady(redis)) {
      return fail(503, "UNAVAILABLE", "Avatar matching is temporarily unavailable");
    }
    const now = nowOf();
    const keys = quotaKeys(userId, now);
    const idemKey = `avatar-match:idem:${sha256hex(`${userId}:${body.requestId}`)}`;
    const logId = sha256hex(`${userId}:${body.requestId}`).slice(0, 12);

    // Idempotency replay: stored result without a second provider call.
    let stored = null;
    try {
      stored = await redis.get(idemKey);
    } catch {
      return fail(503, "UNAVAILABLE", "Avatar matching is temporarily unavailable");
    }
    if (stored) {
      const entry = parseIdempotencyEntry(stored);
      if (entry?.state === "pending") {
        return fail(409, "IN_PROGRESS", "A match request is already running");
      }
      if (entry?.state === "done" && entry.body && Number.isInteger(entry.httpStatus)) {
        return { httpStatus: entry.httpStatus, body: entry.body };
      }
    }

    let locked = false;
    const lockToken = crypto.randomUUID();
    try {
      const acquired = await redis.set(keys.inflight, lockToken, "PX", IN_FLIGHT_LOCK_MS, "NX");
      if (acquired !== "OK") {
        return fail(409, "IN_PROGRESS", "A match request is already running");
      }
      locked = true;

      // Mark the requestId pending before anything is consumed, so a failure
      // here refuses the request with every counter untouched.
      try {
        await redis.set(idemKey, JSON.stringify({ state: "pending" }), "EX", IDEMPOTENCY_TTL_SECONDS);
      } catch {
        return fail(503, "UNAVAILABLE", "Avatar matching is temporarily unavailable");
      }

      // Nothing has been consumed when a guard refuses; dropping the pending
      // entry keeps this requestId retryable. Best effort — the entry also
      // expires via its TTL.
      const clearPending = async () => {
        try {
          await redis.del(idemKey);
        } catch {
          // Swallowed: refusing the request matters more than the cleanup.
        }
      };

      // Atomic rate/quota/budget reservation; refuses without consuming.
      let reserve;
      try {
        reserve = await redis.eval(
          RESERVE_LUA,
          5,
          keys.rate,
          keys.day,
          keys.month,
          keys.daySpend,
          keys.monthSpend,
          Math.round(config.reserveUsd * MICRO_USD),
          Math.round(config.dailyBudgetUsd * MICRO_USD),
          Math.round(config.monthlyBudgetUsd * MICRO_USD),
          RATE_LIMIT_PER_WINDOW,
          DAILY_REQUEST_LIMIT,
          MONTHLY_REQUEST_LIMIT,
          RATE_WINDOW_SECONDS,
          DAY_KEY_TTL_SECONDS,
          MONTH_KEY_TTL_SECONDS
        );
      } catch {
        await clearPending();
        return fail(503, "UNAVAILABLE", "Avatar matching is temporarily unavailable");
      }
      const [verdict, verdictTtlMs] = Array.isArray(reserve) ? reserve : ["ERROR", "0"];
      if (verdict === "RATE_LIMITED") {
        await clearPending();
        const retryAfterSeconds = Math.max(1, Math.ceil(toCount(verdictTtlMs) / 1000) || RATE_WINDOW_SECONDS);
        return {
          httpStatus: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
          body: {
            ok: false,
            error: {
              code: "RATE_LIMITED",
              message: "Please wait before requesting another match",
              retryAfterSeconds,
            },
          },
        };
      }
      if (verdict === "QUOTA_EXCEEDED") {
        await clearPending();
        return fail(429, "QUOTA_EXCEEDED", "Avatar match quota exceeded; try again tomorrow");
      }
      if (verdict !== "OK") {
        await clearPending();
        return fail(503, "BUDGET_EXHAUSTED", "Avatar matching is temporarily unavailable");
      }

      // ---- Bounded provider calls: the primary plus at most one fallback ----
      // Both attempts share ONE AbortController/timer, so AVATAR_MATCH_TIMEOUT_MS
      // bounds the total time of the pair, not each call individually.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      // One provider request. The timer stays armed while the body is read: a
      // provider that sends headers and then stalls must still hit the timeout.
      // Returns { response, payload, networkError }; a non-2xx body is never
      // read, so a refusal costs nothing to inspect.
      async function callProvider({ model, structured, reasoningControl }) {
        let response;
        let networkError = null;
        try {
          response = await fetchOf()(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
              "X-Title": "Giggle",
            },
            body: JSON.stringify(
              buildMatchRequest({
                model,
                imageDataUrl,
                structured,
                reasoningControl,
              })
            ),
            signal: controller.signal,
          });
        } catch (error) {
          networkError = error;
        }
        let payload = null;
        if (!networkError && response.ok) {
          try {
            payload = await response.json();
          } catch (error) {
            if (error && error.name === "AbortError") networkError = error;
            payload = null;
          }
        }
        return { response, payload, networkError };
      }

      const primaryStartedAt = nowOf();
      const primary = await callProvider({
        model: config.model,
        structured: config.structured,
        reasoningControl: config.reasoningControl,
      });
      const primaryLatencyMs = nowOf() - primaryStartedAt;

      // The single fallback runs only when the primary was REFUSED — an
      // actual HTTP response with status 429 or 503, never a timeout, network
      // error, any other status or an unreadable body — and a different
      // fallback model is configured (an explicitly empty
      // AVATAR_MATCH_FALLBACK_MODEL disables it). The fallback never falls
      // back again, so an accepted POST makes at most two provider calls.
      const fallbackConfigured =
        typeof config.fallbackModel === "string" &&
        config.fallbackModel !== "" &&
        config.fallbackModel !== config.model;
      let answer = primary; // the attempt that produced the answer
      let answerModel = config.model;
      let answerLatencyMs = primaryLatencyMs;
      let fallbackUsed = false;
      if (
        !primary.networkError &&
        (primary.response.status === 429 || primary.response.status === 503) &&
        fallbackConfigured
      ) {
        logAttempt({
          id: logId,
          model: config.model,
          status: "provider_error",
          httpStatus: primary.response.status,
          latencyMs: primaryLatencyMs,
          costUsd: null,
          tokens: null,
        });
        fallbackUsed = true;
        answerModel = config.fallbackModel;
        const fallbackStartedAt = nowOf();
        answer = await callProvider({
          model: config.fallbackModel,
          structured: config.fallbackStructured,
          reasoningControl: config.fallbackReasoningControl,
        });
        answerLatencyMs = nowOf() - fallbackStartedAt;
      }
      clearTimeout(timer);

      // One log line per provider attempt; the fallback's line carries
      // fallback:true. Never the image, prompt, content or key.
      const logBase = { id: logId, model: answerModel, ...(fallbackUsed ? { fallback: true } : {}) };
      let result; // { httpStatus, body }
      let reconcileDelta = 0;

      if (answer.networkError) {
        const timedOut = answer.networkError.name === "AbortError";
        result = timedOut
          ? fail(504, "MATCH_TIMEOUT", "The avatar service took too long")
          : fail(503, "UNAVAILABLE", "Avatar matching is temporarily unavailable");
        logAttempt({ ...logBase, status: timedOut ? "timeout" : "network_error", latencyMs: answerLatencyMs, costUsd: null, tokens: null });
      } else if (!answer.response.ok) {
        result = fail(503, "UNAVAILABLE", "Avatar matching is temporarily unavailable");
        logAttempt({ ...logBase, status: "provider_error", httpStatus: answer.response.status, latencyMs: answerLatencyMs, costUsd: null, tokens: null });
      } else {
        const payload = answer.payload;
        const actualMicro = payload ? costToMicroUsd(payload.usage) : null;
        reconcileDelta = actualMicro === null ? 0 : actualMicro - Math.round(config.reserveUsd * MICRO_USD);
        const tokens = typeof payload?.usage?.total_tokens === "number" && Number.isFinite(payload.usage.total_tokens)
          ? payload.usage.total_tokens
          : null;
        const logExtra = {
          provider: typeof payload?.provider === "string" ? payload.provider : null,
          generationId: typeof payload?.id === "string" ? payload.id : null,
        };
        const parsed = parseSuggestion(payload?.choices?.[0]?.message?.content);
        if (!parsed.ok) {
          result = fail(502, "MATCH_FAILED", "The avatar service returned an invalid result");
          logAttempt({ ...logBase, ...logExtra, status: "match_failed", latencyMs: answerLatencyMs, costUsd: payload ? payload.usage?.cost ?? null : null, tokens });
        } else if (parsed.suggestion.status !== "match") {
          result = {
            httpStatus: 200,
            body: { ok: true, status: parsed.suggestion.status, configs: [] },
          };
          logAttempt({ ...logBase, ...logExtra, status: parsed.suggestion.status, latencyMs: answerLatencyMs, costUsd: payload ? payload.usage?.cost ?? null : null, tokens });
        } else {
          const config0 = suggestionToConfig(parsed.suggestion, base);
          if (!config0) {
            result = fail(502, "MATCH_FAILED", "The avatar service returned an invalid result");
            logAttempt({ ...logBase, ...logExtra, status: "match_failed", latencyMs: answerLatencyMs, costUsd: payload ? payload.usage?.cost ?? null : null, tokens });
          } else {
            result = {
              httpStatus: 200,
              body: {
                ok: true,
                status: "match",
                configs: suggestionVariations(config0),
                model: answerModel, // the model that actually answered
                promptVersion: MATCH_PROMPT_VERSION,
              },
            };
            logAttempt({ ...logBase, ...logExtra, status: "match", latencyMs: answerLatencyMs, costUsd: payload ? payload.usage?.cost ?? null : null, tokens });
          }
        }
      }

      // Reconcile actual billed cost against the reservation (best effort;
      // a failure never changes the answer already computed).
      if (reconcileDelta !== 0) {
        try {
          await redis.eval(
            RECONCILE_LUA,
            2,
            keys.daySpend,
            keys.monthSpend,
            reconcileDelta,
            DAY_KEY_TTL_SECONDS,
            MONTH_KEY_TTL_SECONDS
          );
        } catch {
          logAttempt({ ...logBase, status: "reconcile_failed", reconcileDelta });
        }
      }

      // Persist only the returned status/configs for 24h replay; no image, no
      // raw model content. Only final outcomes are stored: HTTP 200 answers
      // and MATCH_FAILED (billed, deterministic). Transient outcomes
      // (MATCH_TIMEOUT / UNAVAILABLE) clear the entry instead, so the same
      // requestId can be retried later through the full rate/quota/budget
      // checks again. Failure to store is logged, not fatal.
      if (result.httpStatus === 200 || result.body?.error?.code === "MATCH_FAILED") {
        try {
          await redis.set(
            idemKey,
            JSON.stringify({ state: "done", httpStatus: result.httpStatus, body: result.body }),
            "EX",
            IDEMPOTENCY_TTL_SECONDS
          );
        } catch {
          logAttempt({ ...logBase, status: "idempotency_store_failed", httpStatus: result.httpStatus });
        }
      } else {
        try {
          await redis.del(idemKey);
        } catch {
          logAttempt({ ...logBase, status: "idempotency_clear_failed", httpStatus: result.httpStatus });
        }
      }
      return result;
    } finally {
      if (locked) {
        try {
          // Compare-and-delete: only the owner releases its own lock.
          await redis.eval(RELEASE_LOCK_LUA, 1, keys.inflight, lockToken);
        } catch {
          // The PX lease expires on its own; nothing else to do safely.
        }
      }
    }
  }

  return { getSuggestStatus, suggestAvatar };
}

// The controller (and route tests) go through these wrappers so the default
// dependencies — real Redis client, global fetch, process.env — resolve lazily
// on first actual use and can be swapped per property in tests.
let defaultService = null;
const getDefaultService = () => {
  if (!defaultService) defaultService = createAvatarMatchService();
  return defaultService;
};

module.exports = {
  createAvatarMatchService,
  suggestAvatar: (args) => getDefaultService().suggestAvatar(args),
  getSuggestStatus: (args) => getDefaultService().getSuggestStatus(args),
  // Pure helpers and constants for tests.
  decodeBase64Image,
  parseJpegSize,
  stripJpegMetadata,
  readConfig,
  quotaKeys,
  isUuidV4,
  MAX_BASE64_LENGTH,
  RATE_WINDOW_SECONDS,
  DAILY_REQUEST_LIMIT,
  MONTHLY_REQUEST_LIMIT,
  IN_FLIGHT_LOCK_MS,
  IDEMPOTENCY_TTL_SECONDS,
};
