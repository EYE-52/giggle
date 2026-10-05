const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const encounterSource = () => readFileSync(path.join(__dirname, "../app/(app)/encounter/page.tsx"), "utf8");
const panelSource = () => readFileSync(path.join(__dirname, "../components/GamePanel.tsx"), "utf8");
const bridgeSource = () => readFileSync(path.join(__dirname, "../lib/gameBridge.ts"), "utf8");
const stageSource = () => readFileSync(path.join(__dirname, "../components/FocusVideoStage.tsx"), "utf8");
const revampCssSource = () => readFileSync(path.join(__dirname, "../app/revamp.css"), "utf8");

/* lib/gameBridge.ts is TypeScript; transpile it on the fly and exercise the
 * real layout resolver (same pattern as game-bridge.test.js). */
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

test("game rail layout resolves pins over the contextual hint (behavioral)", () => {
  const bridge = loadBridge();

  // Auto follows the child's hint: social wants faces, immersive wants a
  // compact filmstrip, board/balanced stay calm side-by-side.
  assert.equal(bridge.resolveGameLayout("auto", "social"), "faces");
  assert.equal(bridge.resolveGameLayout("auto", "immersive"), "compact");
  assert.equal(bridge.resolveGameLayout("auto", "board"), "balanced");
  assert.equal(bridge.resolveGameLayout("auto", "balanced"), "balanced");
  // Explicit pins win across every game change until Auto.
  for (const presentation of ["social", "board", "immersive", "balanced"]) {
    assert.equal(bridge.resolveGameLayout("faces", presentation), "faces", `faces pins ${presentation}`);
    assert.equal(bridge.resolveGameLayout("compact", presentation), "compact", `compact pins ${presentation}`);
    assert.equal(bridge.resolveGameLayout("floating", presentation), "floating", `floating pins ${presentation}`);
  }
});

test("game panel takes an optional encounter scope without changing the protocol", () => {
  const panel = panelSource();

  // Encounter calls pass their id; the squad path is untouched.
  assert.match(panel, /encounter\?: \{ encounterId: string \};/);
  assert.match(panel, /const encounterId = encounter\?\.encounterId \?\? null;/);
  assert.match(panel, /const \{ gameUrl, ticket \} = encounterId !== null\s*\? await api\.encounterGameToken\(encounterId\)\s*: await api\.gameToken\(squadId\);/);
  assert.match(panel, /}, \[configured, postToChild, sendContext, squadId, encounterId\]\);/);
  // Honest per-scope denial message.
  assert.match(panel, /Games aren't available for this call right now\./);
  assert.match(panel, /Games aren't available for this squad right now\./);
});

test("encounter page opens games inside the call without touching media", () => {
  const encounter = encounterSource();

  // Entry is gated on the API switch and lives in the reachable control bar.
  assert.match(encounter, /const GAMES_ENABLED = useGamesEnabled\(\) === true;/);
  assert.match(encounter, /\.\.\.\(GAMES_ENABLED/);
  assert.match(encounter, /id: "games",/);
  assert.match(encounter, /<Icon\.dice size=\{20\}/);
  assert.match(encounter, /onClick: toggleGames,/);
  // The toggle is state-only: no join/leave, no navigation, no permission
  // prompt — the Agora client and every video node stay exactly as they are.
  assert.equal(
    encounter.includes("function toggleGames() {\n    setMoreOpen(false);\n    setGameOpen((open) => !open);\n  }"),
    true
  );
  // Games never route to the lobby, a new tab, or another page.
  assert.doesNotMatch(encounter, /router\.push\([^)]*[Gg]ame/);
  assert.doesNotMatch(encounter, /router\.replace\([^)]*[Gg]ame/);
  assert.doesNotMatch(encounter, /window\.open\(/);
  // The shared room closes with the call (renewal would be denied anyway).
  assert.match(encounter, /\/\/ The call is over: close the shared game room with it/);
});

test("encounter games mount beside the video stage, which stays mounted", () => {
  const encounter = encounterSource();

  // One shared GamePanel for both squads, mounted only on gameOpen — beside
  // the stage, never instead of it.
  assert.match(encounter, /\{gameOpen && GAMES_ENABLED && \(/);
  assert.match(encounter, /data-testid="encounter-game-stage"/);
  assert.match(
    encounter,
    /<GamePanel squadId=\{squadId\} encounter=\{\{ encounterId: encId \}\} onClose=\{\(\) => setGameOpen\(false\)\} onPresentation=\{handlePresentation\} onCameraScene=\{handleCameraScene\} layout=\{layoutOverride\} onLayoutChange=\{setLayoutOverride\} voice=\{\{ mic: mapCaptureToVoiceMic\(captureState\.audio\), onEnableMic: toggleMic \}\} \/>/
  );
  // On a phone the game hides (nodes stay mounted) while chat takes over.
  assert.match(encounter, /hidden=\{isPhone && chatOpen\}/);
  // The video stage itself is unconditional: exactly one, never inside a
  // gameOpen branch, so tiles and media hosts are never remounted.
  assert.equal(encounter.split('data-testid="video-stage"').length - 1, 1);
  const gameBlock = encounter.slice(
    encounter.indexOf("{gameOpen && GAMES_ENABLED && ("),
    encounter.indexOf('data-testid="video-stage"')
  );
  assert.doesNotMatch(gameBlock, /joinVideo|retryVideo|leaveVideo|router\.push|router\.replace/);
  // The stage accepts camera geometry: same ids, same keys,
  // same tile components across open/select/layout/close.
  const stageBlock = encounter.slice(
    encounter.indexOf("function renderAdaptiveStage"),
    encounter.indexOf("const renderStage")
  );
  assert.doesNotMatch(stageBlock, /gameOpen|effectiveLayout|layoutOverride|gamePresentation/);
  assert.match(encounter, /key=\{person\.id\}/);
  // The stage contract: layout changes move existing media hosts, never
  // remount video or restart the call.
  assert.match(stageSource(), /key=\{id\}/);
  assert.match(stageSource(), /they never remount video or restart the call/);
  // Layout resolution is the shared tested helper; close resets the pins.
  assert.match(encounter, /const effectiveLayout = resolveGameLayout\(layoutOverride, gamePresentation, cameraScene\);/);
  assert.match(encounter, /data-games-layout=\{gameOpen && GAMES_ENABLED \? effectiveLayout : undefined\}/);
  assert.match(encounter, /if \(!gameOpen\) \{\s*setLayoutOverride\("auto"\);\s*setGamePresentation\("balanced"\);/);
});

test("encounter games restyle the rail without unmounting or hiding video", () => {
  const css = revampCssSource();

  // Game stage takes the freed space; hidden (phone chat) keeps it mounted.
  assert.match(css, /\.gg-encounter-game \{\s*flex: 1;/);
  assert.match(css, /\.gg-encounter-game\[hidden\] \{\s*display: none;\s*\}/);
  // The rail only shrinks (lobby geometry); layout pins switch its size.
  assert.match(css, /\.gg-games-open \[data-testid="video-stage"\] \{\s*flex: none !important;\s*width: 232px !important;/);
  assert.match(css, /\.gg-games-open\[data-games-layout="faces"\] \[data-testid="video-stage"\] \{\s*width: 300px !important;/);
  assert.match(css, /\.gg-games-open\[data-games-layout="compact"\] \[data-testid="video-stage"\] \{\s*width: 168px !important;/);
  assert.match(css, /height: 108px !important;/);
  assert.match(css, /height: 132px !important;/);
  assert.match(css, /height: 84px !important;/);
  // No games rule may display:none the stage: video stays visible as a rail.
  // The one rule that hides the stage is the pre-existing phone-chat rule.
  for (const rule of css.match(/\.gg-games-open[^{]*\{[^}]*\}/g) || []) {
    assert.doesNotMatch(rule, /display:\s*none/);
  }
  const stageHides = [...css.matchAll(/([^{}]+)\{\s*display:\s*none\s*!important;\s*\}/g)].filter((rule) =>
    rule[1].includes('video-stage')
  );
  assert.equal(stageHides.length, 1);
  assert.match(stageHides[0][1], /\.gg-chat-open/);
});
