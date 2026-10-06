const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const panelSource = () => readFileSync(path.join(__dirname, "../components/GamePanel.tsx"), "utf8");
const panelCssSource = () => readFileSync(path.join(__dirname, "../components/GamePanel.module.css"), "utf8");
const bridgeSource = () => readFileSync(path.join(__dirname, "../lib/gameBridge.ts"), "utf8");
const lobbySource = () => readFileSync(path.join(__dirname, "../app/(app)/lobby/page.tsx"), "utf8");
const encounterSource = () => readFileSync(path.join(__dirname, "../app/(app)/encounter/page.tsx"), "utf8");

/* lib/gameBridge.ts is TypeScript; transpile it on the fly and exercise the
 * real voice validators (same pattern as game-bridge.test.js). */
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

test("voice protocol versions and validates on the shared frame channel", () => {
  const bridge = bridgeSource();

  assert.match(bridge, /VOICE_MIC_STATES = \["active", "off", "denied", "unavailable"\]/);
  assert.match(bridge, /export function isValidVoiceMic/);
  assert.match(bridge, /export function mapCaptureToVoiceMic/);
  assert.match(bridge, /export function buildVoiceState/);
  assert.match(bridge, /\| \{ v: 1; t: "voice-request"; id: string \}/);
  assert.match(bridge, /\| \{ v: 1; t: "voice-state"; mic: VoiceMic; enabled: boolean; for\?: string \}/);
  assert.match(bridge, /if \(msg\.t === "voice-request"\) \{\s*\/\/ Bounded request id/s);
  assert.match(bridge, /return isValidNonce\(msg\.id\);/);
  // The bridge itself never touches media: mapping + validation only.
  assert.doesNotMatch(bridge, /getUserMedia|RTCPeerConnection|MediaStream|AudioContext/);
});

test("voice mic mapping stays honest and fails closed (behavioral)", () => {
  const bridge = loadBridge();

  assert.equal(bridge.isValidVoiceMic("active"), true);
  assert.equal(bridge.isValidVoiceMic("off"), true);
  assert.equal(bridge.isValidVoiceMic("denied"), true);
  assert.equal(bridge.isValidVoiceMic("unavailable"), true);
  assert.equal(bridge.isValidVoiceMic("loud"), false);
  assert.equal(bridge.isValidVoiceMic(""), false);
  assert.equal(bridge.isValidVoiceMic(42), false);
  assert.equal(bridge.isValidVoiceMic(null), false);
  assert.equal(bridge.isValidVoiceMic(undefined), false);

  // The call owner's truth, mapped: active stays active, pending means not
  // live yet, denied/unavailable pass through, garbage fails closed.
  assert.equal(bridge.mapCaptureToVoiceMic("active"), "active");
  assert.equal(bridge.mapCaptureToVoiceMic("off"), "off");
  assert.equal(bridge.mapCaptureToVoiceMic("pending"), "off");
  assert.equal(bridge.mapCaptureToVoiceMic("denied"), "denied");
  assert.equal(bridge.mapCaptureToVoiceMic("unavailable"), "unavailable");
  assert.equal(bridge.mapCaptureToVoiceMic("loud"), "unavailable");
  assert.equal(bridge.mapCaptureToVoiceMic(""), "unavailable");
  assert.equal(bridge.mapCaptureToVoiceMic(42), "unavailable");
  assert.equal(bridge.mapCaptureToVoiceMic(null), "unavailable");
  assert.equal(bridge.mapCaptureToVoiceMic(undefined), "unavailable");
});

test("voice request/state shapes validate strictly (behavioral)", () => {
  const bridge = loadBridge();

  // Requests: bounded id, same 1..128 bound as auth nonces.
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "voice-request", id: "r1" }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "voice-request", id: "x".repeat(128) }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "voice-request" }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "voice-request", id: "" }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "voice-request", id: "x".repeat(129) }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "voice-request", id: 7 }), false);
  assert.equal(bridge.isGameChildMessage({ v: 2, t: "voice-request", id: "r1" }), false);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "voice", id: "r1" }), false);

  // State constructor: null unless mic + enabled + optional echo are valid.
  assert.deepEqual(bridge.buildVoiceState("active", true), { v: 1, t: "voice-state", mic: "active", enabled: true });
  assert.deepEqual(bridge.buildVoiceState("off", true, "r1"), { v: 1, t: "voice-state", mic: "off", enabled: true, for: "r1" });
  assert.deepEqual(bridge.buildVoiceState("off", false), { v: 1, t: "voice-state", mic: "off", enabled: false });
  assert.equal(bridge.buildVoiceState("loud", true), null);
  assert.equal(bridge.buildVoiceState("active", "yes"), null);
  assert.equal(bridge.buildVoiceState("active", true, ""), null);
  assert.equal(bridge.buildVoiceState("active", true, "x".repeat(200)), null);
  assert.equal(bridge.buildVoiceState(null, true), null);
  assert.equal(bridge.buildVoiceState("active", undefined), null);

  // The existing protocol is unaffected by the new union members.
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "ready" }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "authed", n: "auth-2" }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", game: "chess", players: 2 }), true);
  assert.equal(bridge.isGameChildMessage({ v: 1, t: "state", players: 2, presentation: "weird" }), false);
});

test("game panel gates voice requests on verified auth and never auto-captures", () => {
  const panel = panelSource();

  // Voice prop: actual mic truth + the existing device toggle.
  assert.match(panel, /voice\?: \{ mic: VoiceMic; onEnableMic: \(\) => void \};/);
  assert.match(panel, /const voiceRef = useRef\(voice\);/);
  // Requests need verified authorization (dropped pre-auth without a prompt
  // and without marking the frame heard); nothing captures from postMessage.
  assert.match(panel, /ev\.data\.t === "voice-request"/);
  assert.match(panel, /ev\.data\.t === "voice-request"[\s\S]{0,500}if \(!authedRef\.current\) return;/);
  assert.match(panel, /isValidVoiceMic\(v\.mic\)/);
  // Already enabled: direct active answer echoing the request id, no prompt.
  assert.match(panel, /const direct = buildVoiceState\("active", true, ev\.data\.id\);/);
  assert.match(panel, /if \(direct\) postToChild\(direct\);/);
  assert.match(panel, /setVoicePrompt\(\{ id: ev\.data\.id \}\);/);
  // The ONE invocation path: the prompt button's click calls the existing
  // toggle via ref. Exactly two mentions (definition + onClick) — no effect,
  // no timer, no message handler calls it.
  assert.match(panel, /const enableVoiceMic = \(\) => \{\s*voiceRef\.current\?\.onEnableMic\(\);\s*\};/);
  assert.equal(panel.split("enableVoiceMic").length - 1, 2);
  assert.equal(panel.split("onEnableMic()").length - 1, 1);
  assert.equal((panel.match(/setInterval/g) || []).length, 1);
  // Status pushes on mic change (+ once when live): the child never polls.
  assert.match(panel, /const voiceMic = voice\?\.mic;/);
  assert.match(panel, /const push = buildVoiceState\(voiceMic, true\);/);
  assert.match(panel, /if \(push\) postToChild\(push\);/);
  assert.match(panel, /if \(voiceMic === "active"\) setVoicePrompt\(null\);/);
  assert.match(panel, /}, \[voiceMic, status, postToChild\]\);/);
  // Retry clears the prompt alongside auth; unmount removes the listener.
  assert.match(panel, /setVoicePrompt\(null\);\s*authedRef\.current = false;/);
  assert.match(panel, /return \(\) => window\.removeEventListener\("message", onMessage\);/);
  // The panel never captures and the frame still gets no mic permission.
  assert.doesNotMatch(panel, /getUserMedia|RTCPeerConnection|MediaStream/);
  assert.match(panel, /allow="autoplay; clipboard-write; encrypted-media; fullscreen"/);
  assert.doesNotMatch(panel, /allow="[^"]*(camera|microphone)/);
});

test("voice prompt is a real parent dialog with honest mic copy", () => {
  const panel = panelSource();
  const css = panelCssSource();

  assert.match(panel, /role="dialog" aria-label="Voice chat request"/);
  assert.match(panel, /styles\.voicePrompt/);
  assert.match(panel, /<button type="button" className=\{styles\.voiceEnable\} onClick=\{enableVoiceMic\}>/);
  assert.match(panel, /Enable microphone/);
  assert.match(panel, /aria-label="Dismiss voice request"/);
  assert.match(panel, /microphone is blocked/);
  assert.match(panel, /no microphone was found/);
  // Bottom-anchored inside the panel (never over the top auth banner),
  // panel tokens only, real native buttons.
  assert.match(css, /\.voicePrompt \{/);
  assert.match(css, /\.voicePrompt \{[^}]*position: absolute;[^}]*bottom: 12px;/s);
  assert.match(css, /\.voiceEnable \{/);
  assert.match(css, /\.voiceDismiss \{/);
});

test("lobby and encounter wire actual capture status to the existing toggles", () => {
  const lobby = lobbySource();
  const encounter = encounterSource();

  // Lobby: full capture truth (denied/unavailable stay honest) into the panel,
  // toggled by the EXISTING device switch — no new client, no new join.
  assert.match(lobby, /const media = useSquadCall\(squadId\);/);
  assert.match(lobby, /const micCapture = mapCaptureToVoiceMic\(media\.capture\.audio\);/);
  assert.match(lobby, /onEnableMic: \(\) => void toggleDevice\("audio"\)/);
  assert.match(lobby, /await squadCall\.setDevice\(squadId, kind, next\);/);
  // Encounter: the call's capture state maps straight in; the mic pill's own
  // toggle answers the prompt.
  assert.match(encounter, /mapCaptureToVoiceMic, resolveGameLayout/);
  assert.match(encounter, /mic: mapCaptureToVoiceMic\(captureState\.audio\)/);
  assert.match(encounter, /onEnableMic: toggleMic/);
  assert.match(encounter, /const toggleMic = \(\) => toggleDevice\("audio"\);/);
});
