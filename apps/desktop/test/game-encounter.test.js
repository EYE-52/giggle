const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

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
  assert.match(encounter, /hidden=\{chatTakesStage && chatOpen\}/);
  assert.match(encounter, /const chatTakesStage = chatUsesStage\(width, height, gameOpen && GAMES_ENABLED\);/);
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


test("media and reaction recovery controls stay outside bounded game and video rails", () => {
  const tree = ts.createSourceFile("encounter.tsx", encounterSource(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const testId = node => ts.isJsxElement(node) ? node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "data-testid")?.initializer?.text : undefined;
  const notices = new Map();
  function visit(node) {
    if (["media-recovery-notice","reaction-error"].includes(testId(node))) notices.set(testId(node),node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const [id,retry,dismiss] of [["media-recovery-notice","retryVideo","setVideoError(null)"],["reaction-error","fireReaction(failedReaction, true)","dismissReactionError"]]) {
    const notice = notices.get(id);
    assert.ok(notice, `${id} remains in the real failure path`);
    const ancestors = [];
    for (let node = notice.parent; node; node = node.parent) if (ts.isJsxElement(node)) ancestors.push(testId(node));
    assert.deepEqual(ancestors.slice(0,2), ["recovery-notices","encounter-shell"], `${id} shares the bounded shell row, outside the 84px Compact rail`);
    assert.equal(ancestors.includes("video-stage"), false);
    assert.equal(ancestors.includes("encounter-game-stage"), false);
    const handlers = [];
    function button(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "button") {
        const action = node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "onClick");
        if (action) handlers.push(action.initializer.getText(tree));
      }
      ts.forEachChild(node, button);
    }
    button(notice);
    assert.equal(handlers.length, 2, `${id} keeps separate Retry and Dismiss controls`);
    assert.ok(handlers.some(handler => handler.includes(retry)), "Retry keeps its actual existing handler");
    assert.ok(handlers.some(handler => handler.includes(dismiss)), "Dismiss keeps its actual existing handler");
  }
  const css = readFileSync(path.join(__dirname, "../app/(app)/encounter/call-feedback.module.css"), "utf8");
  assert.match(css, /\.recoveryRows \{[^}]*max-height:[^;]+;[^}]*overflow-y:auto;/);
  assert.match(css, /\.recoveryActions button \{[^}]*height:44px;[^}]*min-height:44px;/);
});

test("call-only recovery reserves its real header row instead of overlapping it", () => {
  const css = revampCssSource();
  const recoveryHeader = css.match(/\.gg-screen-call:not\(\[data-games\]\):has\(\[data-testid="recovery-notices"\]\) \.call-top \{([^}]+)\}/)?.[1];
  assert.ok(recoveryHeader, "games-closed failures must reserve the header's actual height");
  assert.match(recoveryHeader, /position:\s*relative\s*!important/);
  assert.match(recoveryHeader, /left:\s*auto/);
  assert.match(recoveryHeader, /right:\s*auto/);
});

test("selected chat audience text has readable call-theme contrast", () => {
  const css = revampCssSource();
  const selected = css.match(/\.gg-chat-audience button\[aria-pressed="true"\] \{([^}]+)\}/)[1];
  const tokens = readFileSync(path.join(__dirname, "../app/call-room.css"), "utf8");
  const color = property => {
    const variable = selected.match(new RegExp(property + ":\\s*var\\((--[\\w-]+)"))[1];
    return tokens.match(new RegExp(variable + ":\\s*(#[\\da-f]{6})", "i"))[1];
  };
  const luminance = hex => {
    const rgb = [1,3,5].map(index => parseInt(hex.slice(index,index + 2),16) / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return rgb.reduce((sum,channel,index) => sum + channel * [.2126,.7152,.0722][index],0);
  };
  const pair = [luminance(color("color")),luminance(color("background"))].sort((a,b) => a-b);
  assert.ok((pair[1] + .05) / (pair[0] + .05) >= 4.5, "14px audience text needs at least 4.5:1 on its actual call fill");
});


// Evaluate only arithmetic from the actual padding declarations, with explicit
// synthetic safe-area values. This is source geometry, not physical-device QA.
function paddingPixels(value, edges, viewportWidth) {
  let depth = 0, token = "", tokens = [];
  for (const char of value.trim()) {
    if (/\s/.test(char) && depth === 0) { if (token) tokens.push(token); token = ""; continue; }
    token += char;
    if (char === "(") depth++;
    if (char === ")") depth--;
  }
  if (token) tokens.push(token);
  const pixels = tokens.map(expression => {
    const numeric = expression.replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_, edge) => String(edges[edge])).replace(/([\d.]+)%/g, (_, n) => String(viewportWidth * Number(n) / 100)).replace(/px\b/g, "").replace(/calc\(/g, "(");
    assert.match(numeric.replace(/\b(max|min)\b/g,""), /^[\d\s,.()+*/-]+$/);
    return vm.runInNewContext(numeric, {max:Math.max,min:Math.min});
  });
  return pixels.length === 4 ? pixels : pixels.length === 3 ? [pixels[0],pixels[1],pixels[2],pixels[1]] : pixels;
}

test("lobby padding reserves each nonzero safe edge once in phone and short layouts", () => {
  const css = readFileSync(path.join(__dirname, "../app/(app)/lobby/lobby.module.css"), "utf8");
  const pageRules = [...css.matchAll(/\.page \{([^}]+)\}/g)];
  const padding = rule => rule.match(/padding:\s*([^;]+);/)[1];
  const short = css.match(/\.page\[data-short-games\] \{([^}]+)\}/)[1];
  assert.deepEqual(paddingPixels(padding(pageRules[1][1]),{top:47,right:0,bottom:34,left:0},390), [47,10,34,10]);
  assert.deepEqual(paddingPixels(padding(short),{top:47,right:0,bottom:34,left:0},390), [47,10,34,10]);
  assert.deepEqual(paddingPixels(padding(short),{top:0,right:44,bottom:21,left:44},844), [4,44,21,44]);
  assert.deepEqual(paddingPixels(padding(short),{top:0,right:0,bottom:0,left:0},1024), [4,10,6,10]);
});

test("encounter short chrome preserves safe edges and chat owns hidden bar insets", () => {
  const css = revampCssSource();
  const header = css.match(/\.gg-screen-call\[data-short-games\] \.call-top \{[^}]*padding:\s*([^;]+);/)[1].replace(/\s*!important$/, "");
  const footer = css.match(/\.gg-screen-call\[data-short-games\] \.gg-call-controls-wrap \{[^}]*padding:\s*([^;]+);/)[1].replace(/\s*!important$/, "");
  const portrait = {top:47,right:0,bottom:34,left:0};
  assert.deepEqual(paddingPixels(header,portrait,390), [47,10,4,10]);
  assert.deepEqual(paddingPixels(footer,portrait,390), [4,8,34,8]);
  assert.match(css, /\.gg-screen-call:has\(\.gg-chat-open\) \{ padding-top: env\(safe-area-inset-top\); padding-bottom: env\(safe-area-inset-bottom\); \}/);
  assert.match(css, /\.gg-screen-call:not\(\[data-games\]\) :is\(\.call-top, \.gg-call-controls-wrap\) \{ left: env\(safe-area-inset-left\); right: env\(safe-area-inset-right\); \}/);
  const layout = readFileSync(path.join(__dirname, "../app/(app)/layout.tsx"), "utf8");
  assert.match(layout, /!isCalling && <TopNav/);
  assert.match(layout, /isCalling \? \(\s*children/);
});
