// src/controllers/oauthController.js
//
// Real OAuth + magic-link auth on the Express backend. Every provider funnels
// into issueSessionForEmail() (shared with /api/auth/exchange) and then
// redirects the browser to the frontend at:
//
//     ${FRONTEND_URL_PRIMARY}/auth/callback#token=<jwt>
//
// The token is delivered in the URL *hash* (not the query) so it never lands in
// server logs, proxies, or the Referer header.
//
// Providers degrade gracefully: if a provider's env vars are missing, its
// `GET /api/auth/<provider>` returns a clean JSON 503 (PROVIDER_NOT_CONFIGURED)
// instead of crashing, so local dev + the dev-skip keep working.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { issueSessionForEmail, normalizeEmail, isValidEmailIdentity } = require("./authController");

// ── URL helpers ───────────────────────────────────────────────────────────
function backendPublicUrl() {
  return (process.env.BACKEND_PUBLIC_URL || "http://localhost:3001").replace(/\/$/, "");
}

// FRONTEND_URL may be a comma-separated list; the FIRST entry is the redirect base.
function frontendPrimaryUrl() {
  const first = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((u) => u.trim().replace(/\/$/, ""))
    .filter(Boolean)[0];
  return first || "http://localhost:4000";
}

function callbackRedirect(res, token) {
  // Token in the hash fragment so it isn't logged anywhere server-side.
  const url = `${frontendPrimaryUrl()}/auth/callback#token=${encodeURIComponent(token)}`;
  return res.redirect(302, url);
}

function callbackError(res, code) {
  const url = `${frontendPrimaryUrl()}/auth/callback#error=${encodeURIComponent(code)}`;
  return res.redirect(302, url);
}

function notConfigured(res, provider) {
  return res.status(503).json({
    ok: false,
    error: {
      code: "PROVIDER_NOT_CONFIGURED",
      message: `${provider} sign-in is not configured on this server.`,
    },
  });
}

// ── OAuth `state`: CSRF-hardened ────────────────────────────────────────────
// Login-CSRF defense: the `state` is HMAC-signed (so the carried referral can't
// be forged/tampered) AND bound to the user's browser via a single-use nonce
// stored in an HttpOnly cookie. On callback we require the cookie nonce to match
// the nonce inside the signed state (timing-safe) — a forged/replayed state from
// an attacker's browser has no matching cookie and is rejected.
const STATE_COOKIE = "giggle_oauth_state";
const stateSecret = () => process.env.JWT_SECRET || "dev-oauth-state-secret";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");
let appleJwks = null;

function hmac(data) {
  return crypto.createHmac("sha256", stateSecret()).update(data).digest("base64url");
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Build a signed state from a random nonce + optional referral.
function makeState(nonce, ref) {
  const payload = Buffer.from(JSON.stringify({ n: nonce, ref: ref || null })).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}
// Verify HMAC, return { n, ref } or null if forged/malformed.
function verifyState(state) {
  const s = String(state || "");
  const dot = s.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = s.slice(0, dot);
  const sig = s.slice(dot + 1);
  if (!safeEqual(sig, hmac(payload))) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function setStateCookie(res, nonce, sameSite) {
  res.cookie(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Apple posts back cross-site (form_post) → needs SameSite=None; Google's
    // top-level redirect works with Lax.
    sameSite,
    maxAge: 10 * 60 * 1000,
    path: "/api/auth",
  });
}
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}
function clearStateCookie(res) {
  res.clearCookie(STATE_COOKIE, { path: "/api/auth" });
}

// Validate a callback's state against the browser's cookie. Returns the trusted
// referral (or null) on success, or false on any mismatch/forgery.
function consumeState(req, res, rawState) {
  const cookieNonce = readCookie(req, STATE_COOKIE);
  clearStateCookie(res); // single-use regardless of outcome
  const parsed = verifyState(rawState);
  if (!parsed || !cookieNonce || !safeEqual(cookieNonce, parsed.n)) return false;
  return { ref: parsed.ref || null, nonce: parsed.n };
}

// ── Google ──────────────────────────────────────────────────────────────--
function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
function googleRedirectUri() {
  return `${backendPublicUrl()}/api/auth/google/callback`;
}

const googleStart = (req, res) => {
  if (!googleConfigured()) return notConfigured(res, "Google");
  const ref = (req.query.ref || "").toString().trim().toUpperCase() || null;
  const nonce = crypto.randomBytes(32).toString("base64url");
  setStateCookie(res, nonce, "lax");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "select_account",
    state: makeState(nonce, ref),
  });
  return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
};

const googleCallback = async (req, res) => {
  if (!googleConfigured()) return notConfigured(res, "Google");
  const { code, state } = req.query;
  if (!code) return callbackError(res, "GOOGLE_NO_CODE");
  // CSRF: state must verify (HMAC) AND match the browser's single-use cookie.
  const checked = consumeState(req, res, state);
  if (!checked) return callbackError(res, "GOOGLE_BAD_STATE");
  try {
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      googleRedirectUri()
    );
    const { tokens } = await client.getToken(String(code));
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();
    if (!p || !p.email) return callbackError(res, "GOOGLE_NO_EMAIL");

    const session = await issueSessionForEmail({
      email: p.email,
      name: p.name,
      image: p.picture,
      ref: checked.ref,
    });
    return callbackRedirect(res, session.token);
  } catch (err) {
    console.error("Google OAuth callback error:", err.message);
    return callbackError(res, "GOOGLE_FAILED");
  }
};

// ── Apple (Sign in with Apple, form_post) ──────────────────────────────────
function appleConfigured() {
  return !!(
    process.env.APPLE_SERVICE_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  );
}
function appleRedirectUri() {
  return `${backendPublicUrl()}/api/auth/apple/callback`;
}

function sanitizeAppleTokenError(data) {
  if (!data || typeof data !== "object") return { responseType: typeof data };
  return {
    error: typeof data.error === "string" ? data.error : undefined,
    errorDescription: typeof data.error_description === "string" ? data.error_description : undefined,
    hasIdToken: typeof data.id_token === "string",
    hasAccessToken: typeof data.access_token === "string",
    hasRefreshToken: typeof data.refresh_token === "string",
  };
}

// Build the Apple "client secret" — an ES256 JWT signed with the private key.
function buildAppleClientSecret() {
  // Allow the key to be provided with literal "\n" sequences (common in env files).
  const privateKey = process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: process.env.APPLE_TEAM_ID,
      iat: now,
      exp: now + 60 * 5, // max 6 months; we mint per-request and keep it short
      aud: "https://appleid.apple.com",
      sub: process.env.APPLE_SERVICE_ID,
    },
    privateKey,
    {
      algorithm: "ES256",
      header: { alg: "ES256", kid: process.env.APPLE_KEY_ID },
    }
  );
}

async function verifyAppleIdToken(idToken, expectedNonce, options = {}) {
  const serviceId = process.env.APPLE_SERVICE_ID;
  if (!serviceId) throw new Error("APPLE_SERVICE_ID_NOT_CONFIGURED");

  let jwtVerifyImpl = options.jwtVerifyImpl;
  let jwks = options.jwks;
  if (!jwtVerifyImpl || !jwks) {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    jwtVerifyImpl = jwtVerifyImpl || jwtVerify;
    if (!appleJwks) appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);
    jwks = jwks || appleJwks;
  }

  const { payload } = await jwtVerifyImpl(String(idToken), jwks, {
    issuer: "https://appleid.apple.com",
    audience: serviceId,
  });

  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error("APPLE_BAD_NONCE");
  }
  if (!payload.email) {
    throw new Error("APPLE_NO_EMAIL");
  }
  return payload;
}

const appleStart = (req, res) => {
  if (!appleConfigured()) return notConfigured(res, "Apple");
  const ref = (req.query.ref || "").toString().trim().toUpperCase() || null;
  const nonce = crypto.randomBytes(32).toString("base64url");
  // Apple posts back cross-site → cookie must be SameSite=None (requires Secure).
  setStateCookie(res, nonce, "none");
  const params = new URLSearchParams({
    client_id: process.env.APPLE_SERVICE_ID,
    redirect_uri: appleRedirectUri(),
    response_type: "code id_token",
    response_mode: "form_post",
    scope: "name email",
    nonce,
    state: makeState(nonce, ref),
  });
  return res.redirect(302, `https://appleid.apple.com/auth/authorize?${params.toString()}`);
};

const appleCallback = async (req, res) => {
  if (!appleConfigured()) return notConfigured(res, "Apple");
  // form_post: Apple POSTs application/x-www-form-urlencoded.
  const code = req.body?.code;
  const state = req.body?.state;
  if (!code) return callbackError(res, "APPLE_NO_CODE");
  const checked = consumeState(req, res, state);
  if (!checked) return callbackError(res, "APPLE_BAD_STATE");
  try {
    const clientSecret = buildAppleClientSecret();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: appleRedirectUri(),
      client_id: process.env.APPLE_SERVICE_ID,
      client_secret: clientSecret,
    });
    const resp = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await resp.json();
    if (!data.id_token) {
      console.error("Apple token exchange failed:", sanitizeAppleTokenError(data));
      return callbackError(res, "APPLE_FAILED");
    }
    const decoded = await verifyAppleIdToken(data.id_token, checked.nonce);
    const email = decoded?.email;
    if (!email) return callbackError(res, "APPLE_NO_EMAIL");

    // Apple sends the user's name only on first consent, as JSON in `user`.
    let name;
    try {
      if (req.body?.user) {
        const u = typeof req.body.user === "string" ? JSON.parse(req.body.user) : req.body.user;
        name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(" ") || undefined;
      }
    } catch {}

    const session = await issueSessionForEmail({ email, name, ref: checked.ref });
    return callbackRedirect(res, session.token);
  } catch (err) {
    console.error("Apple OAuth callback error:", err.message);
    return callbackError(res, "APPLE_FAILED");
  }
};

// ── Email magic link ───────────────────────────────────────────────────────
const MAGIC_TTL = "15m";
const MAGIC_TTL_SECONDS = 15 * 60;
const MAGIC_USED_PREFIX = "magic:used:";

const consumeMagicLinkId = async (jti, redisClient) => {
  if (!jti) return false;
  const client = redisClient || require("../config/redisConfig").redis;
  const result = await client.set(`${MAGIC_USED_PREFIX}${jti}`, "1", "EX", MAGIC_TTL_SECONDS, "NX");
  return result === "OK";
};

const emailStart = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const ref = (req.body?.ref || "").toString().trim().toUpperCase() || null;
  // Don't reveal whether the email exists — always return ok for a valid format.
  if (!isValidEmailIdentity(email)) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "A valid email is required." },
    });
  }

  try {
    if (!process.env.RESEND_API_KEY && process.env.NODE_ENV === "production") {
      return res.status(503).json({
        ok: false,
        error: {
          code: "EMAIL_NOT_CONFIGURED",
          message: "Email sign-in is not configured on this server.",
        },
      });
    }

    const token = jwt.sign(
      { email, ref, purpose: "magic" },
      process.env.JWT_SECRET,
      { expiresIn: MAGIC_TTL, jwtid: crypto.randomUUID() }
    );
    const link = `${backendPublicUrl()}/api/auth/email/verify?token=${encodeURIComponent(token)}`;

    if (process.env.RESEND_API_KEY) {
      const { Resend } = require("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.RESEND_FROM || "Giggle <onboarding@resend.dev>",
        to: email,
        subject: "Your Giggle sign-in link",
        html: `<p>Tap to sign in to Giggle:</p><p><a href="${link}">Sign in to Giggle</a></p><p>This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
      });
    } else {
      // Dev: no email provider — log the link so the developer can click it.
      console.log(`\n[magic-link] Sign-in link for ${email}:\n${link}\n`);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("emailStart error:", err.message);
    // Still don't leak details.
    return res.json({ ok: true });
  }
};

const emailVerify = async (req, res) => {
  const token = (req.query.token || "").toString();
  if (!token) return callbackError(res, "MAGIC_NO_TOKEN");
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== "magic" || !payload.email) {
      return callbackError(res, "MAGIC_INVALID");
    }
    const unused = await consumeMagicLinkId(payload.jti);
    if (!unused) return callbackError(res, "MAGIC_INVALID");
    const session = await issueSessionForEmail({ email: payload.email, ref: payload.ref });
    return callbackRedirect(res, session.token);
  } catch (err) {
    console.error("emailVerify error:", err.message);
    return callbackError(res, "MAGIC_EXPIRED");
  }
};

module.exports = {
  googleStart,
  googleCallback,
  appleStart,
  appleCallback,
  emailStart,
  emailVerify,
  consumeMagicLinkId,
  verifyAppleIdToken,
};
