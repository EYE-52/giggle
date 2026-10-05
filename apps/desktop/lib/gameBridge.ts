// Parent-side Game Night embed adapter (postMessage protocol v1).
// The lobby frames Game Night in an iframe; single-use tickets cross the
// frame boundary here, then ride the Game Night WebSocket. Tickets never
// appear in URLs, storage, or logs.
//
// Child -> parent: ready {v}, auth-needed {v}, authed {v, n?},
//   state {v, game, players, watchers?, presentation?}
// Parent -> child: auth {v, ticket, n}, context {v, theme?}
// Both sides enforce the exact configured origin and the exact
// event.source — no '*', no unrelated same-origin frames.
//
// `authed` is the verified authorization acknowledgment: the child posts it
// only after the game server accepts a ticket (Giggle hello on the child's
// socket), echoing the parent's per-ticket nonce `n`. The panel promotes
// loading to live only after an ack correlated to its fresh pending
// authorization — a posted ticket, a stale ack, or a stale state snapshot
// is never enough.

export const GAME_BRIDGE_VERSION = 1;

// Game Night room cap: presence counts above this are invalid, never shown.
export const GAME_ROOM_CAP = 24;

// Contextual video hint derived by the child from public catalog metadata
// (communication/renderer/cat/realtime — never per-game ids): social wants
// large faces, board wants calm side-by-side faces, immersive wants a
// compact filmstrip with maximum game area, balanced is the default. The
// parent maps this to its own layout classes — never raw CSS from the frame.
export const GAME_PRESENTATIONS = ["social", "board", "immersive", "balanced"] as const;
export type GamePresentation = (typeof GAME_PRESENTATIONS)[number];
export const DEFAULT_PRESENTATION: GamePresentation = "balanced";
export function isValidPresentation(p: unknown): p is GamePresentation {
  return typeof p === "string" && (GAME_PRESENTATIONS as readonly string[]).includes(p);
}

// Effective in-call video rail while games are open, shared by the lobby
// and the encounter page: explicit pins win; auto maps the child's
// contextual hint (social->faces, immersive->compact, board/balanced stay
// calm side-by-side). Layout changes only restyle the rail — the call,
// its client, and every video node stay mounted.
export type GameCameraScene = { mode: "spotlight" | "gallery"; featured: string | null; caption: string };
export const CAMERA_GALLERY_SCENE: GameCameraScene = { mode: "gallery", featured: null, caption: "" };
export function isValidCameraScene(value: unknown): value is GameCameraScene {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scene = value as Record<string, unknown>;
  if (typeof scene.caption !== "string" || scene.caption.length > 120) return false;
  if (scene.mode === "gallery") return scene.featured === null;
  return scene.mode === "spotlight" && typeof scene.featured === "string" && scene.featured.length > 0 && scene.featured.length <= 128;
}

export type GameRailLayout = "faces" | "balanced" | "compact" | "floating" | "stage";
export function resolveGameLayout(
  override: "auto" | "faces" | "compact" | "floating" | "stage",
  presentation: GamePresentation,
  camera?: GameCameraScene | null,
): GameRailLayout {
  if (override === "faces") return "faces";
  if (override === "compact") return "compact";
  if (override === "floating") return "floating";
  if (override === "stage" || camera) return "stage";
  if (presentation === "social") return "faces";
  if (presentation === "immersive") return "compact";
  return "balanced";
}

export type GameChildMessage =
  | { v: 1; t: "ready" }
  | { v: 1; t: "auth-needed" }
  | { v: 1; t: "authed"; n?: string }
  | { v: 1; t: "state"; game?: string | null; players?: number; watchers?: number; presentation?: GamePresentation; camera?: GameCameraScene | null }
  | { v: 1; t: "voice-request"; id: string };

export type GameParentMessage =
  | { v: 1; t: "auth"; ticket: string; n: string }
  | { v: 1; t: "context"; theme?: string }
  | { v: 1; t: "voice-state"; mic: VoiceMic; enabled: boolean; for?: string };

// Per-ticket nonce: short opaque nonsecret string, echoed by the child in
// `authed` so the panel can correlate the ack to its fresh pending
// authorization. Bounded so a hostile value can never grow the protocol.
export const MAX_NONCE_CHARS = 128;
export function isValidNonce(n: unknown): n is string {
  return typeof n === "string" && n.length > 0 && n.length <= MAX_NONCE_CHARS;
}

// Fresh per-authorization id. Uses crypto.getRandomValues when available —
// it works on plain-http origins too (unlike crypto.randomUUID, which needs
// a secure context), so configured Tailnet previews stay covered — with a
// time+random fallback for runtimes without WebCrypto.
export function createAuthNonce(): string {
  try {
    const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (cryptoObj?.getRandomValues) {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Fall through to the compat helper below.
  }
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

// Freshness gate: an `authed` ack counts only when it echoes the exact
// nonce the panel posted with its latest ticket. Stale acks (an older
// ticket's echo arriving after a Retry/renewal posted a newer one) and
// spoofed acks (wrong or missing nonce) never mark the panel live.
export function isFreshAuthAck(pendingNonce: string | null, data: unknown): boolean {
  if (!pendingNonce || !isValidNonce(pendingNonce)) return false;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const msg = data as Record<string, unknown>;
  if (msg.v !== GAME_BRIDGE_VERSION || msg.t !== "authed") return false;
  return msg.n === pendingNonce;
}

// A valid presence count: a finite nonnegative integer within the room
// cap — never NaN, negative, fractional, or above 24.
export function isValidCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= GAME_ROOM_CAP;
}

// Shape/version validation for ONE child->parent message body.
export function isGameChildMessage(data: unknown): data is GameChildMessage {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const msg = data as Record<string, unknown>;
  if (msg.v !== GAME_BRIDGE_VERSION) return false;
  if (msg.t === "ready" || msg.t === "auth-needed") return true;
  if (msg.t === "authed") {
    // Shape-valid with or without the echo; freshness (matching the fresh
    // pending nonce) is decided by isFreshAuthAck at the panel.
    return msg.n === undefined || isValidNonce(msg.n);
  }
  if (msg.t === "voice-request") {
    // Bounded request id, same 1..128 bound as auth nonces: the parent
    // echoes it in the direct voice-state answer so the child can reject
    // stale answers. Shape only — the panel additionally requires verified
    // authorization before a request ever shows a prompt.
    return isValidNonce(msg.id);
  }
  if (msg.t === "state") {
    if (msg.game !== undefined && msg.game !== null && typeof msg.game !== "string") return false;
    if (msg.players !== undefined && !isValidCount(msg.players)) return false;
    if (msg.watchers !== undefined && !isValidCount(msg.watchers)) return false;
    // Bounded optional hint: omitted (old child) falls back to balanced in
    // the panel; a present-but-unknown value rejects the snapshot outright
    // (like out-of-shape counts) so spoofed layouts never apply.
    if (msg.presentation !== undefined && !isValidPresentation(msg.presentation)) return false;
    if (msg.camera !== undefined && msg.camera !== null && !isValidCameraScene(msg.camera)) return false;
    return true;
  }
  return false;
}

// Voice capability (protocol v1, same frame channel): the child NEVER
// captures audio — voice rides this parent page's existing Agora call. The
// child posts voice-request, the parent shows its own prompt with a real
// Enable button (the existing device toggle, a real user gesture), and posts
// the call's ACTUAL capture status back. An already-enabled mic answers
// active directly. The manifest communication=voice hint guides layout; it
// never forces permission.
export const VOICE_MIC_STATES = ["active", "off", "denied", "unavailable"] as const;
export type VoiceMic = (typeof VOICE_MIC_STATES)[number];
export function isValidVoiceMic(m: unknown): m is VoiceMic {
  return typeof m === "string" && (VOICE_MIC_STATES as readonly string[]).includes(m);
}

// Map the call owner's capture truth to the voice status the child sees:
// pending means not live yet (honest: off), and anything unknown fails
// closed to unavailable — never to active.
export function mapCaptureToVoiceMic(audio: unknown): VoiceMic {
  if (audio === "active") return "active";
  if (audio === "off" || audio === "pending") return "off";
  if (audio === "denied") return "denied";
  return "unavailable";
}

// Validated parent->child voice-state constructor: null unless the mic,
// the enabled flag, and the optional request echo are all well-formed.
export function buildVoiceState(
  mic: unknown,
  enabled: unknown,
  forId?: unknown,
): Extract<GameParentMessage, { t: "voice-state" }> | null {
  if (!isValidVoiceMic(mic)) return null;
  if (typeof enabled !== "boolean") return null;
  if (forId !== undefined && !isValidNonce(forId)) return null;
  return forId === undefined
    ? { v: 1, t: "voice-state", mic, enabled }
    : { v: 1, t: "voice-state", mic, enabled, for: forId };
}

// Validate the configured Game Night base URL: absolute http(s), https in
// production (http only for local development), no credentials/query/hash.
export function parseGamesUrl(raw: string | undefined, nodeEnv = process.env.NODE_ENV): { gamesUrl: string; origin: string } | null {
  const value = (raw || "").trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.protocol !== "https:" && nodeEnv === "production") return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  return { gamesUrl: value.replace(/\/+$/, "") || url.origin, origin: url.origin };
}

// Embed src for the iframe: embed mode + our exact origin so the child can
// enforce origin/source. The ticket is NEVER a query param.
export function buildEmbedUrl(gameUrl: string, parentOrigin: string): string | null {
  const parsed = parseGamesUrl(gameUrl);
  if (!parsed) return null;
  let parent: URL;
  try {
    parent = new URL(parentOrigin);
  } catch {
    return null;
  }
  if (parent.origin !== parentOrigin) return null;
  return `${parsed.gamesUrl}/?embed=1&parentOrigin=${encodeURIComponent(parent.origin)}`;
}
