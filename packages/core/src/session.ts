import { api } from "./api";
import { setTokenGetter } from "./client";
import { randomPlayerName } from "./names";
import { syncServerTokens } from "./billing";
import { disconnectSocket } from "./socket";
import type { BackendUser } from "./api";

const PENDING_REF_KEY = "giggle.pendingRef";

/** Stash a referral code (from a ?ref= invite link) until the user signs up. */
export function setPendingReferral(code: string) {
  try {
    if (typeof localStorage !== "undefined" && code) {
      localStorage.setItem(PENDING_REF_KEY, code.trim().toUpperCase());
    }
  } catch {}
}

function getPendingReferral(): string | undefined {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(PENDING_REF_KEY) || undefined;
    }
  } catch {}
  return undefined;
}

function clearPendingReferral() {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(PENDING_REF_KEY);
  } catch {}
}

// Lightweight session: holds the backend JWT + user in memory (and localStorage
// on web for convenience). Works across Next.js and React Native.

let token: string | null = null;
let user: BackendUser | null = null;

const STORAGE_KEY = "giggle.session";

function randomDevSeed() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(8));
    return "guest-" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
  }
  return "guest-" + Date.now().toString(36);
}

function decodeBase64UrlJson(segment: string) {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return JSON.parse(
    decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    )
  );
}

function decodeJwtPayload(jwtToken: string) {
  if (!jwtToken || typeof jwtToken !== "string") throw new Error("INVALID_AUTH_TOKEN");
  const parts = jwtToken.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("INVALID_AUTH_TOKEN");
  let payload: any;
  try {
    payload = decodeBase64UrlJson(parts[1]);
  } catch {
    throw new Error("INVALID_AUTH_TOKEN");
  }
  if (!payload.email || !(payload.userId || payload.sub)) throw new Error("INVALID_AUTH_TOKEN");
  return payload;
}

function normalizeSessionUser(storedUser: Partial<BackendUser> | null | undefined, payload: any): BackendUser | null {
  const id = String(payload.userId || payload.sub || storedUser?.id || "");
  const email = String(payload.email || storedUser?.email || "");
  if (!id || !email) return null;
  return {
    id,
    email,
    name: String(payload.name || storedUser?.name || ""),
    image: payload.image || storedUser?.image,
    isPremium: !!(payload.isPremium ?? storedUser?.isPremium),
    isApproved: !!(payload.isApproved ?? storedUser?.isApproved),
    // Age gates — carry through from the JWT payload or the persisted user.
    // Left as undefined when the backend hasn't set them (treated as "not
    // confirmed" by the gate, never crashes).
    isAdult: payload.isAdult ?? storedUser?.isAdult,
    ageConfirmed: payload.ageConfirmed ?? storedUser?.ageConfirmed,
    ageVerified: payload.ageVerified ?? storedUser?.ageVerified,
  } as BackendUser;
}

function persist() {
  try {
    if (typeof localStorage !== "undefined") {
      if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

function restore() {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const restoredPayload = decodeJwtPayload(parsed.token);
        token = parsed.token;
        user = normalizeSessionUser(parsed.user, restoredPayload);
        if (!user) throw new Error("INVALID_AUTH_TOKEN");
      }
    }
  } catch {
    token = null;
    user = null;
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}

restore();
setTokenGetter(() => token);

export const session = {
  get token() {
    return token;
  },
  get user() {
    return user;
  },
  isAuthed() {
    return !!token;
  },
  async startEmailSignIn(email: string) {
    const ref = getPendingReferral();
    return api.startEmailMagicLink(email, ref);
  },
  /** Exchange identity for a backend JWT. Pass real OAuth identity, or a dev one. */
  async signIn(identity: { email: string; name?: string; image?: string }) {
    const ref = getPendingReferral();
    const res = await api.exchange({ ...identity, ref });
    token = res.token;
    user = res.user;
    persist();
    // Mirror any server-side token balance (incl. referral rewards) into wallet.
    if (typeof res.user?.tokens === "number") {
      syncServerTokens(res.user.tokens);
    }
    // A referral only converts once — clear it so it isn't re-sent on relogin.
    if (ref) clearPendingReferral();
    return res;
  },
  /**
   * Dev/local sign-in. With no seed, mints a UNIQUE identity per browser profile
   * (persisted) so two windows/profiles are two different users — enabling a real
   * two-squad matchmaking test. Pass an explicit seed to force a specific user.
   */
  async devSignIn(seed?: string) {
    // Dev-only escape hatch — must NEVER authenticate anyone in production.
    // In prod, Google OAuth is the real gate; this is a no-op so callers that
    // auto-invoke it (page ensureAuthed helpers) can't silently sign people in.
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
      return undefined;
    }
    let s = seed;
    if (!s) {
      try {
        if (typeof localStorage !== "undefined") {
          s = localStorage.getItem("giggle.devseed") || undefined;
          if (!s) {
            s = randomDevSeed();
            localStorage.setItem("giggle.devseed", s);
          }
        }
      } catch {}
      s = s || "alex";
    }
    // Stable cool display name per browser profile.
    let displayName = seed === "alex" ? "Alex Carter" : "";
    try {
      if (!displayName && typeof localStorage !== "undefined") {
        displayName = localStorage.getItem("giggle.devname") || "";
        if (!displayName) {
          displayName = randomPlayerName();
          localStorage.setItem("giggle.devname", displayName);
        }
      }
    } catch {}
    return session.signIn({
      email: `${s}@dev.giggle.local`,
      name: displayName || randomPlayerName(),
      image: undefined,
    });
  },
  /**
   * Persist a backend JWT obtained via an OAuth/magic-link redirect (the token
   * arrives in the URL hash; there's no /exchange round-trip). Decodes the JWT
   * payload into a minimal user object, stores it like signIn() does, syncs the
   * token wallet from the server, and clears any pending referral.
   */
  setTokenFromOAuth(jwtToken: string) {
    const payload = decodeJwtPayload(jwtToken);
    const nextUser = normalizeSessionUser(null, payload);
    if (!nextUser) throw new Error("INVALID_AUTH_TOKEN");
    token = jwtToken;
    user = nextUser;
    persist();
    // A referral conversion already happened server-side during the redirect.
    clearPendingReferral();
    return user;
  },
  /** True once the user has attested a date of birth (age gate satisfied). */
  get ageConfirmed() {
    return user?.ageConfirmed === true;
  },
  /** True when the attested DOB is 18+. Undefined-safe (false when unknown). */
  get isAdult() {
    return user?.isAdult === true;
  },
  /**
   * Submit the self-attested date of birth ("YYYY-MM-DD"). Set-once on the
   * backend. On success, syncs the returned gates into the in-memory + persisted
   * session user (mirrors how tokens are synced) so the app updates without a
   * reload. Throws (ApiError) on failure — callers surface the message.
   */
  async setAge(birthDate: string) {
    const res = await api.setAge(birthDate);
    if (user) {
      user = { ...user, isAdult: res.isAdult, ageConfirmed: res.ageConfirmed };
      persist();
    }
    return res;
  },
  signOut() {
    token = null;
    user = null;
    persist();
    disconnectSocket();
  },
};
