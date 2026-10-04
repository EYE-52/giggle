const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const nextConfigSource = () => readFileSync(path.join(__dirname, "../next.config.ts"), "utf8");
const panelSource = () => readFileSync(path.join(__dirname, "../components/GamePanel.tsx"), "utf8");
const panelCssSource = () => readFileSync(path.join(__dirname, "../components/GamePanel.module.css"), "utf8");
const bridgeSource = () => readFileSync(path.join(__dirname, "../lib/gameBridge.ts"), "utf8");
const lobbySource = () => readFileSync(path.join(__dirname, "../app/(app)/lobby/page.tsx"), "utf8");
const lobbyCssSource = () => readFileSync(path.join(__dirname, "../app/(app)/lobby/lobby.module.css"), "utf8");

/* lib/gameBridge.ts is TypeScript; transpile it on the fly and exercise the
 * real validators (same pattern as look.test.js). Freshness semantics are
 * asserted behaviorally here — not via source regexes. */
function loadBridge() {
  const js = ts.transpileModule(bridgeSource(), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const requireStub = () => {
    throw new Error("gameBridge has no runtime imports");
  };
  new Function("require", "module", "exports", js)(requireStub, module, module.exports);
  return module.exports;
}

test("next config frames only the configured games origin and keeps hardening", () => {
  const config = nextConfigSource();

  assert.match(config, /NEXT_PUBLIC_GAMES_URL/);
  assert.match(config, /frame-src 'self' \$\{GAMES_FRAME_SRC\}/);
  assert.match(config, /"frame-ancestors 'none'"/);
  assert.match(config, /X-Frame-Options", value: "DENY"/);
  assert.match(config, /camera=\(self\), microphone=\(self\)/);
  // Same shape rules as the API: https in production, no creds/query/hash.
  assert.match(config, /process\.env\.NODE_ENV === "production"\) return null/);
  assert.match(config, /url\.username \|\| url\.password \|\| url\.search \|\| url\.hash/);
});

test("game bridge helper versions and validates the postMessage protocol", () => {
  const bridge = bridgeSource();

  assert.match(bridge, /GAME_BRIDGE_VERSION = 1/);
  assert.match(bridge, /export function isGameChildMessage/);
  assert.match(bridge, /msg\.v !== GAME_BRIDGE_VERSION/);
  // Bounded optional presentation hint on state (contextual video layout).
  assert.match(bridge, /GAME_PRESENTATIONS = \["social", "board", "immersive", "balanced"\]/);
  assert.match(bridge, /export function isValidPresentation/);
  assert.match(bridge, /DEFAULT_PRESENTATION/);
  assert.match(bridge, /presentation\?: GamePresentation/);
  assert.match(bridge, /!isValidPresentation\(msg\.presentation\)/);
  // Verified authorization ack: the child posts `authed` only after the
  // game server accepts a ticket, echoing the parent's per-ticket nonce.
  assert.match(bridge, /\| \{ v: 1; t: "authed"; n\?: string \}/);
  assert.match(bridge, /\| \{ v: 1; t: "auth"; ticket: string; n: string \}/);
  assert.match(bridge, /export function isValidNonce/);
  assert.match(bridge, /MAX_NONCE_CHARS = 128/);
  assert.match(bridge, /export function isFreshAuthAck/);
  assert.match(bridge, /export function createAuthNonce/);
  assert.match(bridge, /getRandomValues/);
  // Presence counts are typed: finite nonnegative integers ≤ room cap.
  assert.match(bridge, /GAME_ROOM_CAP = 24/);
  assert.match(bridge, /export function isValidCount/);
  assert.match(bridge, /Number\.isInteger\(n\) && n >= 0 && n <= GAME_ROOM_CAP/);
  assert.match(bridge, /!isValidCount\(msg\.players\)/);
  assert.match(bridge, /!isValidCount\(msg\.watchers\)/);
  assert.match(bridge, /export function buildEmbedUrl/);
  assert.match(bridge, /embed=1&parentOrigin=/);
  // The embed URL carries mode + origin only — never the ticket.
  const embedUrlBody = bridge.slice(bridge.indexOf("export function buildEmbedUrl"));
  assert.doesNotMatch(embedUrlBody, /ticket/i);
});

test("auth ack freshness correlates to the latest pending id (behavioral)", () => {
  const bridge = loadBridge();

  // Nonce bounds: nonsecret, non-empty, ≤128 chars.
  assert.equal(bridge.isValidNonce("auth-1"), true);
  assert.equal(bridge.isValidNonce("x".repeat(128)), true);
  assert.equal(bridge.isValidNonce(""), false);
  assert.equal(bridge.isValidNonce("x".repeat(129)), false);
  assert.equal(bridge.isValidNonce(42), false);
  assert.equal(bridge.isValidNonce(null), false);
  assert.equal(bridge.isValidNonce(undefined), false);

  // Minted ids are valid and distinct per authorization.
  const a = bridge.createAuthNonce();
  const b = bridge.createAuthNonce();
  assert.equal(bridge.isValidNonce(a), true);
  assert.equal(bridge.isValidNonce(b), true);
  assert.notEqual(a, b);

  // Accepted: the ack echoes the CURRENT pending id.
  assert.equal(bridge.isFreshAuthAck("auth-2", { v: 1, t: "authed", n: "auth-2" }), true);
  // Stale: an older delayed ack (auth-1) arriving while auth-2 is pending.
  assert.equal(bridge.isFreshAuthAck("auth-2", { v: 1, t: "authed", n: "auth-1" }), false);
  // Superseded: the pending id moved on; the old echo no longer counts.
  assert.equal(bridge.isFreshAuthAck("auth-1", { v: 1, t: "authed", n: "auth-2" }), false);
  // Invalid: missing/empty/oversize/non-string echoes never count.
  assert.equal(bridge.isFreshAuthAck("auth-2", { v: 1, t: "authed" }), false);
  assert.equal(bridge.isFreshAuthAck("auth-2", { v: 1, t: "authed", n: "" }), false);
  assert.equal(bridge.isFreshAuthAck("auth-2", { v: 1, t: "authed", n: "x".repeat(200) }), false);
  assert.equal(bridge.isFreshAuthAck("auth-2", { v: 1, t: "authed", n: 7 }), false);
  // Retry cleared the pending id: in-flight acks cannot land.
  assert.equal(bridge.isFreshAuthAck(null, { v: 1, t: "authed", n: "auth-2" }), false);
  assert.equal(bridge.isFreshAuthAck("", { v: 1, t: "authed", n: "auth-2" }), false);
  // Wrong version/type/shape never counts, even with a matching echo.
  assert.equal(bridge.isFreshAuthAck("auth-2", { v: 2, t: "authed", n: "auth-2" }), false);
  assert.equal(bridge.isFreshAuthAck("auth-2", { v: 1, t: "state", n: "auth-2" }), false);
  assert.equal(bridge.isFreshAuthAck("auth-2", null), false);
  assert.equal(bridge.isFreshAuthAck("auth-2", "authed"), false);

  // `authed` shape: valid with or without the echo (freshness is decided by
  // isFreshAuthAck at the panel); a malformed echo fails shape outright.
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "authed", n: "auth-2" }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "authed" }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "authed", n: "" }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "authed", n: "x".repeat(200) }), false);
  assert.equal(bridge.isGameChildMessage({ v: 2, t: "authed", n: "auth-2" }), false);

  // Presence counts stay typed integers within the room cap.
  assert.equal(bridge.isValidCount(0), true);
  assert.equal(bridge.isValidCount(2), true);
  assert.equal(bridge.isValidCount(24), true);
  assert.equal(bridge.isValidCount(25), false);
  assert.equal(bridge.isValidCount(-1), false);
  assert.equal(bridge.isValidCount(1.5), false);
  assert.equal(bridge.isValidCount(NaN), false);
  assert.equal(bridge.isValidCount("2"), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", game: "chess", players: 2, watchers: 1 }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", players: 99 }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", watchers: -1 }), false);
});

test("presentation hint validates as a bounded optional enum (behavioral)", () => {
  const bridge = loadBridge();

  // Valid values pass; everything else fails closed.
  assert.equal(bridge.isValidPresentation("social"), true);
  assert.equal(bridge.isValidPresentation("board"), true);
  assert.equal(bridge.isValidPresentation("immersive"), true);
  assert.equal(bridge.isValidPresentation("balanced"), true);
  assert.equal(bridge.isValidPresentation("weird"), false);
  assert.equal(bridge.isValidPresentation("faces"), false); // visual name, not the hint
  assert.equal(bridge.isValidPresentation(""), false);
  assert.equal(bridge.isValidPresentation(42), false);
  assert.equal(bridge.isValidPresentation(null), false);
  assert.equal(bridge.isValidPresentation(undefined), false);
  assert.equal(bridge.isValidPresentation({}), false);

  // Omitted (old child) stays valid — the panel falls back to balanced.
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", game: "chess", players: 2 }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", game: null, players: 0 }), true);
  // Each valid hint rides along.
  for (const p of ["social", "board", "immersive", "balanced"]) {
    assert.equal(
      bridge.isGameChildMessage({ v: 1, t: "state", game: "chess", players: 2, presentation: p }),
      true, `hint ${p} accepted`,
    );
  }
  // Unknown/invalid hints reject the snapshot outright (like bad counts),
  // so spoofed layouts never apply — no raw values reach the parent.
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", players: 2, presentation: "weird" }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", players: 2, presentation: "" }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", players: 2, presentation: 42 }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", players: 2, presentation: null }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", players: 2, presentation: ".evil{position:fixed}" }), false);
});

test("game panel enforces exact origin/source and never leaks tickets", () => {
  const panel = panelSource();

  // Exact source (our own iframe) + exact origin + shape/version.
  assert.match(panel, /ev\.source !== frame\.contentWindow/);
  assert.match(panel, /ev\.origin !== originRef\.current/);
  assert.match(panel, /isGameChildMessage\(ev\.data\)/);
  assert.match(panel, /postMessage\(msg, origin\)/);
  assert.doesNotMatch(panel, /postMessage\([^)]*"\*"|'[^']*'\s*\)/);
  assert.doesNotMatch(panel, /"\*"/);
  // Fresh ticket per auth send; served URL must match configured origin.
  assert.match(panel, /api\.gameToken\(squadId\)/);
  assert.match(panel, /ev\.data\.t === "ready" \|\| ev\.data\.t === "auth-needed"/);
  assert.match(panel, /served\.origin !== configured\.origin/);
  // The iframe gets no camera/mic permission.
  assert.match(panel, /allow="autoplay; clipboard-write; encrypted-media; fullscreen"/);
  assert.doesNotMatch(panel, /allow="[^"]*(camera|microphone)/);
  // Honest unavailable state with retry.
  assert.match(panel, /Games are unavailable/);
  assert.match(panel, />Retry</);
  // No ticket in URL, storage, or logs.
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.doesNotMatch(panel, /console\.(log|info|debug)/);
});

test("game panel renews on a stable channel and keeps errors visible", () => {
  const panel = panelSource();

  // Continuous authorization: fresh tickets ~every 60s with cleanup, keyed
  // off the framed URL (same iframe/socket/seat — never leave/rejoin).
  assert.match(panel, /RENEW_EVERY_MS = 60_000/);
  assert.match(panel, /setInterval\(\(\) => \{\s*requestAuth\(\);\s*\}, RENEW_EVERY_MS\)/);
  assert.match(panel, /return \(\) => clearInterval\(timer\);/);
  // Theme changes must NOT re-run auth or remount: latest theme via ref,
  // stable auth deps, theme effect posts context only.
  assert.match(panel, /const themeRef = useRef\(THEME_FOR_MODE\[themeMode\]/);
  assert.match(panel, /theme: themeRef\.current/);
  assert.match(panel, /\}, \[themeMode, sendContext, status, embedUrl\]\);/);
  assert.match(panel, /setEmbedUrl\(prev => prev \?\? src\)/);
  // Authorization errors stay visible above the frame with retry, and only
  // the verified `authed` acknowledgment promotes loading to live — a
  // posted ticket or a stale state snapshot never does.
  assert.match(panel, /status === "error" && embedUrl/);
  assert.match(panel, /styles\.authError/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /const authedRef = useRef\(false\);/);
  assert.match(panel, /ev\.data\.t === "authed"/);
  assert.match(panel, /authedRef\.current = true;/);
  assert.match(panel, /prev === "loading" && authedRef\.current \? "live" : prev/);
  assert.doesNotMatch(panel, /freshAuthRef/);
  // Freshness correlation: every auth mints a nonce, only its echo counts,
  // and Retry clears the pending id so stale in-flight acks cannot land.
  assert.match(panel, /const pendingAuthRef = useRef<string \| null>\(null\);/);
  assert.match(panel, /pendingAuthRef\.current = nonce;/);
  assert.match(panel, /const nonce = createAuthNonce\(\);/);
  assert.match(panel, /isFreshAuthAck\(pendingAuthRef\.current, ev\.data\)/);
  assert.match(panel, /pendingAuthRef\.current = null;/);
  // Typed presence counts (no ad hoc casts).
  assert.match(panel, /isValidCount\(ev\.data\.players\)/);
  assert.match(panel, /isValidCount\(ev\.data\.watchers\)/);
  // Contextual hint: stable subscriber via ref (auth deps unchanged),
  // authed-only, omitted-falls-back, deduped, frame untouched.
  assert.match(panel, /onPresentation\?: \(p: GamePresentation\) => void/);
  assert.match(panel, /const onPresentationRef = useRef\(onPresentation\);/);
  assert.match(panel, /onPresentationRef\.current = onPresentation;/);
  assert.match(panel, /const presentationRef = useRef<GamePresentation>\(DEFAULT_PRESENTATION\);/);
  assert.match(panel, /if \(authedRef\.current\) \{\s*const raw = ev\.data\.presentation \?\? DEFAULT_PRESENTATION;/);
  assert.match(panel, /isValidPresentation\(raw\) \? raw : DEFAULT_PRESENTATION/);
  assert.match(panel, /if \(next !== presentationRef\.current\) \{\s*presentationRef\.current = next;\s*onPresentationRef\.current\?\.\(next\);/);
  // Layout override switcher in the panel header (no extra row).
  assert.match(panel, /GameLayoutOverride = "auto" \| "faces" \| "compact"/);
  assert.match(panel, /aria-label="Video layout"/);
  assert.match(panel, /<option value="auto">Auto<\/option>/);
  assert.match(panel, /<option value="faces">Faces<\/option>/);
  assert.match(panel, /<option value="compact">Compact<\/option>/);
  // Bounded recovery when the frame never reports live + iframe failures.
  // Every Retry re-arms the timeout; a never-answered (404/blank) document
  // reloads via the iframe key while the parent stays mounted, and an
  // auth-only Retry on a live frame preserves it.
  assert.match(panel, /READY_TIMEOUT_MS = 20_000/);
  assert.match(panel, /The game service isn't responding\. Try again\./);
  assert.match(panel, /\[embedUrl, attempt\]/);
  assert.match(panel, /setAttempt\(a => a \+ 1\)/);
  assert.match(panel, /const heardRef = useRef\(false\);/);
  assert.match(panel, /heardRef\.current = true;/);
  // Regression: no blanket heard-mark for any shape-valid message — a stale
  // ack or pre-auth state snapshot must not make a dead document look alive.
  assert.doesNotMatch(panel, /heardRef\.current = true; \/\/ a valid child message proves a live document/);
  assert.match(panel, /if \(embedUrl && !heardRef\.current\)/);
  assert.match(panel, /setFrameKey\(k => k \+ 1\)/);
  assert.match(panel, /key=\{frameKey\}/);
  assert.match(panel, /onError=\{frameFailed\}/);
});

test("game panel fallback and error banner stay bounded to the panel", () => {
  const css = panelCssSource();

  // The absolute fallback/error overlay must anchor to the panel itself,
  // never the full lobby (which would cover call controls).
  assert.match(css, /\.panel \{\s*position: relative;/);
  assert.match(css, /\.authError \{/);
  assert.match(css, /\.authError \{[^}]*position: absolute;[^}]*z-index: 2;/s);
});

test("lobby adds games inside the page without disturbing the call", () => {
  const lobby = lobbySource();
  const css = lobbyCssSource();

  // Strong entry gated on the API switch; games open in-page, not away.
  assert.match(lobby, /useGamesEnabled\(\) === true/);
  assert.match(lobby, /Play together/);
  assert.match(lobby, /<GamePanel squadId=\{squadId\} onClose=\{\(\) => setGameOpen\(false\)\} onPresentation=\{handlePresentation\} layout=\{layoutOverride\} onLayoutChange=\{setLayoutOverride\} voice=\{\{ mic: micCapture, onEnableMic: \(\) => void toggleDevice\("audio"\) \}\} \/>/);
  assert.doesNotMatch(lobby, /router\.push\([^)]*[Gg]ame/);
  // The seats (media nodes) stay mounted: no conditional around them.
  assert.match(lobby, /<section className=\{styles\.seats\}/);
  assert.match(lobby, /data-games=\{gameOpen \|\| undefined\}/);
  // Contextual rail: auto maps the hint, pins win, close resets.
  assert.match(lobby, /data-layout=\{gameOpen \? effectiveLayout : undefined\}/);
  assert.match(lobby, /resolveGameLayout\(layoutOverride, gamePresentation\)/);
  assert.match(lobby, /resolveGameLayout\(layoutOverride, gamePresentation\)/);
  assert.match(lobby, /resolveGameLayout\(layoutOverride, gamePresentation\)/);
  assert.match(lobby, /if \(!gameOpen\) \{\s*setFocusedMemberId\(null\);\s*setLayoutOverride\("auto"\);/);
  // Focus/pin: explicit per-seat button (own + friends), original tile grows
  // via data-focused; stale pins clear on leave/offline/chat/ESC — no call
  // leave, no navigation, video DOM untouched.
  assert.match(lobby, /data-focused=\{focused \|\| undefined\}/);
  assert.match(lobby, /data-focus-btn=\{member\.memberId\}/);
  assert.match(lobby, /Enlarge your video/);
  assert.match(lobby, /aria-pressed=\{focused\}/);
  assert.match(lobby, /e\.key !== "Escape"\) return;/);
  assert.doesNotMatch(lobby, /vcRef\.current = createVideoClient\(\);\s*\/\/ focus/);
  // The lobby still owns the Agora client with squadId/unmount cleanup.
  assert.match(lobby, /vcRef\.current\?\.leave\(\)/);
  assert.match(lobby, /}, \[squadId\]\);/);
  assert.match(lobby, /api\.setLobbyVideo\(squadId, false\)/);
  // Stage + persistent rail layout, desktop and phone.
  assert.match(css, /\.stage \{ flex: 1;/);
  assert.match(css, /\.body\[data-games\] \.seats/);
  assert.match(css, /\.playBtn/);
  // Contextual faces/compact rails, focused tile, hidden (not unmounted)
  // invite tiles, small options + focus buttons that never cover video.
  assert.match(css, /\.body\[data-games\]\[data-layout="faces"\] \.seats \{ width: 300px; \}/);
  assert.match(css, /\.body\[data-games\]\[data-layout="compact"\] \.seats \{ width: 168px; \}/);
  assert.match(css, /\.body\[data-games\] \.openSeat \{ display: none; \}/);
  assert.match(css, /\.seat\[data-focused\] \.focusBtn/);
  assert.match(css, /\.focusBtn \{ position:absolute; top:6px; left:6px;/);
  assert.match(css, /\.personOptions \{ position:absolute; top:6px; right:6px;/);
  assert.doesNotMatch(css, /\.personOptions \{ position:absolute; inset:0;/);
});
