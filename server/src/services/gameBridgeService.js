// Game bridge: mint short-lived single-use tickets that let squad members
// join a private Game Night room beside their call. This is a small embed
// adapter, not an auth/call framework: identity still comes from the
// Giggle session (requireApiAuth + membership checks on the route), and
// the ticket below is NOT a Giggle backend JWT — it only authorizes one
// Game Night join and carries no Giggle privileges.
//
// Verification lives in Game Night (server/bridge.js, native crypto):
// exact HS256/issuer/audience, timing-safe signature, 90s window,
// single-use jti. Giggle's job here is strict config validation +
// minimal-claim minting.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const BRIDGE_ISSUER = "giggle-meet";
const BRIDGE_AUDIENCE = "game-night";
const TICKET_TTL_SECONDS = 90;
const MIN_SECRET_CHARS = 32;

// Encounter calls share ONE game room for both squads. The room key is the
// encounter id under this prefix so it can never collide with a squad id
// (squad ids are `sq_<ts>_<rand>`, encounter ids `enc_<ts>_<rand>` — the
// prefix makes the separation explicit rather than incidental). It rides in
// the existing `squadId` ticket claim, so the ticket protocol (claims,
// issuer, audience, 90s window, single-use jti) is unchanged and older Game
// Night verifiers keep working as long as they treat the claim opaquely.
const ENCOUNTER_ROOM_PREFIX = "enc:";

const encounterRoomKey = (encounterId) => {
  const id = String(encounterId || "").trim();
  if (!id) {
    const error = new Error("MISSING_IDENTITY");
    error.code = "MISSING_IDENTITY";
    throw error;
  }
  return `${ENCOUNTER_ROOM_PREFIX}${id}`;
};

// Validate the configured Game Night base URL:
// - absolute http(s) URL; https required in production, http only in dev
// - no credentials, query, or hash (a clean embeddable origin + path)
const validateGamesUrl = (raw, env = process.env) => {
  const value = (raw || "").trim();
  if (!value) return { ok: false, reason: "not-configured" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "invalid-scheme" };
  }
  if (url.protocol !== "https:" && env.NODE_ENV === "production") {
    return { ok: false, reason: "https-required" };
  }
  if (url.username || url.password) return { ok: false, reason: "no-credentials" };
  if (url.search || url.hash) return { ok: false, reason: "no-query-or-hash" };
  return { ok: true, origin: url.origin, gamesUrl: value.replace(/\/+$/, "") || url.origin };
};

// Full bridge config, read at call time so tests and late env changes apply.
// Anything misconfigured => { enabled: false } (games stay unavailable; the
// rest of Giggle is unaffected).
const getGamesConfig = (env = process.env) => {
  const checked = validateGamesUrl(env.GAMES_PUBLIC_URL, env);
  if (!checked.ok) return { enabled: false, reason: checked.reason };
  const secret = env.GAME_BRIDGE_SECRET || "";
  if (secret.length < MIN_SECRET_CHARS) return { enabled: false, reason: "bad-secret" };
  return {
    enabled: true,
    gamesUrl: checked.gamesUrl,
    gamesOrigin: checked.origin,
  };
};

const isGamesEnabled = (env = process.env) => getGamesConfig(env).enabled;

// Mint one single-use ticket. Identity MUST come from the verified session
// (req.squadAccess + req.giggleIdentity), never from the request body —
// the route enforces that; this function just signs what it is given.
const issueGameTicket = ({ squadId, userId, displayName } = {}, env = process.env) => {
  const config = getGamesConfig(env);
  if (!config.enabled) {
    const error = new Error("GAMES_UNAVAILABLE");
    error.code = "GAMES_UNAVAILABLE";
    throw error;
  }
  if (!squadId || !userId) {
    const error = new Error("MISSING_IDENTITY");
    error.code = "MISSING_IDENTITY";
    throw error;
  }
  const token = jwt.sign(
    {
      squadId: String(squadId),
      displayName: String(displayName || "Player").slice(0, 64),
    },
    env.GAME_BRIDGE_SECRET,
    {
      algorithm: "HS256",
      issuer: BRIDGE_ISSUER,
      audience: BRIDGE_AUDIENCE,
      subject: String(userId),
      jwtid: crypto.randomBytes(16).toString("hex"),
      expiresIn: TICKET_TTL_SECONDS,
    }
  );
  return { ticket: token, gameUrl: config.gamesUrl, gamesOrigin: config.gamesOrigin };
};

// Mint one single-use ticket for an encounter call. Both squads receive
// tickets whose room claim is the SAME namespaced encounter key, so Game
// Night seats them in one shared room — never each side's own squad room.
// Same protocol as issueGameTicket (claims, issuer, audience, TTL, jti).
const issueEncounterGameTicket = ({ encounterId, userId, displayName } = {}, env = process.env) => {
  return issueGameTicket(
    { squadId: encounterRoomKey(encounterId), userId, displayName },
    env
  );
};

module.exports = {
  BRIDGE_ISSUER,
  BRIDGE_AUDIENCE,
  TICKET_TTL_SECONDS,
  ENCOUNTER_ROOM_PREFIX,
  validateGamesUrl,
  getGamesConfig,
  isGamesEnabled,
  issueGameTicket,
  encounterRoomKey,
  issueEncounterGameTicket,
};
