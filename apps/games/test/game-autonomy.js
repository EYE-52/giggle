'use strict';
// Real adapter modules + independently authored exports, not source-pattern tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { validateManifest } = require('../games/_validate');
const { build } = require('../scripts/build-game-pages');
const registry = require('../games/registry');
const ROOT = path.join(__dirname, '..');
function emitter() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, event) { for (const fn of [...listeners.get(type) || []]) fn(event); },
    count(type) { return listeners.get(type)?.size || 0; },
  };
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-autonomy-'));
  const globals = new Map(['window', 'document', 'location'].map(k => [k, Object.getOwnPropertyDescriptor(global, k)]));
  try {
    const js = path.join(tmp, 'js'); fs.mkdirSync(js);
    fs.writeFileSync(path.join(js, 'package.json'), '{"type":"module"}');
    for (const f of ['game-client.js', 'game-frame.js', 'game-protocol.mjs', 'game-host.js']) fs.copyFileSync(path.join(ROOT, 'public/js', f), path.join(js, f));
    const { createGameClient } = await import(pathToFileURL(path.join(js, 'game-client.js')).href);
    const { createGameFrame } = await import(pathToFileURL(path.join(js, 'game-frame.js')).href);
    const protocol = await import(pathToFileURL(path.join(js, 'game-protocol.mjs')).href);
    for (const renderer of ['dom', 'canvas', '3d', 'webgpu', 'wasm', 'phaser', 'unity']) {
      assert(validateManifest({ id: 'any-game', manifest: { renderer, homepage: true, runtime: { type: 'frame', entry: 'build/index.html' } } }).ok);
    }
    assert(validateManifest({ id: 'any-game', manifest: { runtime: { type: 'module', waitForResult: true } } }).ok);
    assert.equal(validateManifest({ id: 'any-game', manifest: { runtime: { type: 'module', entry: 'index.html' } } }).ok, false);
    assert.equal(validateManifest({ id: 'any-game', manifest: { runtime: { type: 'module', waitForResult: 'yes' } } }).ok, false);
    assert.equal(registry.meta('chain-reaction').runtime.waitForResult, true, 'winning cascade wait survives catalogue projection');
    assert.equal(registry.list().find(g => g.id === 'chain-reaction').runtime.waitForResult, true, 'public client receives cascade wait');
    const moduleRoot = path.join(tmp, 'module-games/any-game');
    fs.mkdirSync(moduleRoot, { recursive: true });
    fs.writeFileSync(path.join(moduleRoot, 'server.js'), "module.exports={id:'any-game',manifest:{runtime:{type:'module',waitForResult:true}},create(){},onAction(){},view(){}};");
    assert.deepEqual(registry.discover(path.dirname(moduleRoot))[0].runtime, { type: 'module', waitForResult: true }, 'module presentation wait survives discovery');
    for (const entry of ['../secret.html', '/index.html', 'https://evil.test/game.html', 'a/../../x.html', 'a\\x.html', '%2e%2e/x.html', 'index.html?x', 'index.js']) {
      assert.equal(validateManifest({ id: 'any-game', manifest: { runtime: { type: 'frame', entry } } }).ok, false, entry);
      assert.equal(protocol.frameEntry('any-game', { type: 'frame', entry }), null);
    }

    // A third-party-shaped browser export: its own home topology, worker,
    // styles, nested engine entry and WASM pass through without a wrapper.
    const source = path.join(tmp, 'games/any-game');
    fs.mkdirSync(path.join(source, 'home'), { recursive: true });
    fs.mkdirSync(path.join(source, 'browser/build'), { recursive: true });
    const home = '<!doctype html><title>My own world</title><canvas></canvas><script src="home.js"></script>';
    fs.writeFileSync(path.join(source, 'home/index.html'), home);
    fs.writeFileSync(path.join(source, 'home/home.js'), 'document.body.dataset.engine="custom";');
    fs.writeFileSync(path.join(source, 'browser/build/index.html'), '<!doctype html><title>WASM game</title><script src="worker.js"></script>');
    fs.writeFileSync(path.join(source, 'browser/build/worker.js'), 'self.postMessage("independent worker");');
    const wasm = Buffer.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11]);
    fs.writeFileSync(path.join(source, 'browser/build/engine.wasm'), wasm);
    const game = { ...registry.list().find(g => g.id === 'chain-reaction'), id: 'any-game', homepage: true, runtime: { type: 'frame', entry: 'build/index.html' } };
    const publicDir = path.join(tmp, 'public');
    build({ publicDir, games: [game], gamesDir: path.join(tmp, 'games') });
    assert.equal(fs.readFileSync(path.join(publicDir, 'games/any-game/index.html'), 'utf8'), home);
    const packed = fs.readFileSync(path.join(publicDir, 'game-assets/any-game/build/engine.wasm'));
    assert.deepEqual(packed, wasm); assert.equal((await WebAssembly.instantiate(packed)).instance.exports.answer(), 42);
    fs.symlinkSync(path.join(source, 'home/index.html'), path.join(source, 'home/leak.html'));
    assert.throws(() => build({ publicDir, games: [game], gamesDir: path.join(tmp, 'games') }), /symlink/);
    assert.equal(fs.readFileSync(path.join(publicDir, 'games/any-game/index.html'), 'utf8'), home, 'failed preflight leaves previous build intact');
    fs.unlinkSync(path.join(source, 'home/leak.html'));
    fs.writeFileSync(path.join(source, 'home/.env'), 'fixture-only');
    assert.throws(() => build({ publicDir, games: [game], gamesDir: path.join(tmp, 'games') }), /private/);
    fs.unlinkSync(path.join(source, 'home/.env'));
    build({ publicDir, games: [{ ...game, homepage: false, runtime: null }], gamesDir: path.join(tmp, 'games') });
    assert(!fs.existsSync(path.join(publicDir, 'game-assets/any-game')), 'removing frame export prunes stale files');
    assert(!fs.existsSync(path.join(publicDir, 'games/any-game/home.js')), 'returning to fallback removes owned assets');

    // Parent/child execute the actual protocol, with differently skewed
    // wall clocks. Only the parent opens the room connection.
    const origin = 'https://play.gigglemeet.com';
    let mono = 1000;
    const parent = { ...emitter() }, child = { ...emitter(), location: { origin, hash: '' }, performance: { now: () => mono } };
    child.parent = parent;
    parent.postMessage = (data, targetOrigin) => { assert.equal(targetOrigin, origin); parent.emit('message', { data, origin, source: child }); };
    child.postMessage = (data, targetOrigin) => { assert.equal(targetOrigin, origin); child.emit('message', { data, origin, source: parent }); };
    let element;
    global.window = parent; global.location = { origin };
    global.document = { createElement: () => element = { ...emitter(), contentWindow: child, attributes: {}, setAttribute(k,v) { this.attributes[k]=v; }, remove() { this.removed = true; } } };
    const root = { replaceChildren(frame) { this.frame = frame; child.name = frame.name; child.location.hash = new URL(frame.src, origin).hash; } };
    let now = 1700000000000, context = { isHost: true, theme: 'day', sound: false, voice: { enabled: true, mic: 'muted' } };
    const actions = [], notices = [], observers = new Set(), results = [], cues = []; let rematches = 0, lobbies = 0, voices = 0, unlocks = 0;
    const api = {
      now: () => now, context: () => context,
      send: (action, options) => actions.push({ action, options }), toast: text => notices.push(text), announce: () => {},
      rematch: () => rematches++, lobby: () => lobbies++,
      resultsReady: id => results.push(id),
      cue: (name, options) => cues.push({ name, ...options }), audioUnlock: () => unlocks++,
      voice: { subscribe(fn) { observers.add(fn); return () => observers.delete(fn); }, request: () => voices++ },
    };
    const host = createGameFrame('any-game', { ...game.runtime, waitForResult: true });
    host.mount(root, api);
    let state = { instanceId: 'a', w: 'first', phase: 'play', spectator: false, players: [{ id: 'me', name: 'A' }] };
    host.update(root, state, api);
    const client = createGameClient({ window: child });
    const seen = []; client.subscribe((s, c) => seen.push({ s, c }));
    assert.equal(seen.length, 1, 'ready receives latest snapshot even after initial update');
    assert.equal(client.name('me'), 'A');
    assert.equal(client.now(), now); mono += 800; assert.equal(client.now(), now + 800, 'monotonic calibrated server clock');
    client.send({ move: 1 }, { silent: true }); assert.equal(actions.length, 1); assert.equal(actions[0].options.silent, true);
    const prepared = { ...state, preparing: true }, signal = new AbortController().signal;
    host.update(root, prepared, api);
    let preparedFrame = false;
    const presentation = Promise.resolve(host.ready(root, prepared, { ...api, signal })).then(() => { preparedFrame = true; });
    mono += 500; await Promise.resolve();
    assert.equal(client.now(), now, 'a preparing child uses the frozen game clock');
    assert.equal(preparedFrame, false, 'transport-ready cannot acknowledge an unrendered frame');
    client.send({ move: 'too-early' }); assert.equal(actions.length, 1, 'preparation cannot send gameplay input');
    client.ready({ ...prepared, w: 'old-phase' }); await Promise.resolve(); assert.equal(preparedFrame, false);
    client.ready(); await presentation; assert.equal(preparedFrame, true, 'explicit rendered phase acknowledgement releases the frame gate');
    host.update(root, state, api);
    const session = child.name.slice(12);
    assert.equal(new URL(element.src, origin).hash, '', 'engine hash routing is untouched');
    const sendAs = (fields, overrides = {}) => parent.emit('message', { data: protocol.envelope(session, 'action', fields), origin, source: child, ...overrides });
    const jsonActions = [null, 'ready', 42, ['vote', 1], { text: 'x'.repeat(65537) }];
    for (const action of jsonActions) client.send(action);
    assert.deepEqual(actions.slice(1).map(a => a.action), jsonActions, 'frame actions retain the full module JSON contract');
    const accepted = actions.length;
    assert.equal(client.cue('piece', {id:'a:move:1'}), false, 'muted child refuses cues');
    child.emit('pointerdown', {isTrusted:true}); assert.equal(unlocks,0,'muted game does not warm audio');
    context = {...context, sound:true}; host.update(root,state,api);
    child.emit('pointerdown', {isTrusted:false}); assert.equal(unlocks,0,'synthetic gesture cannot unlock');
    child.emit('keydown', {isTrusted:true}); assert.equal(unlocks,1,'real game keyboard gesture asks for audio unlock');
    assert.equal(client.cue('piece',{id:'a:move:1',gain:.5}),true);
    assert.deepEqual(cues,[{name:'piece',id:'a:move:1',gain:.5,rate:undefined}]);
    host.update(root,{...state,preparing:true},api); assert.equal(client.cue('piece',{id:'a:early'}),false);
    host.update(root,{...state,audioBaseline:true},api); assert.equal(client.cue('piece',{id:'a:history'}),false);
    host.update(root,state,api);
    const cueAs=(fields,overrides={})=>parent.emit('message',{data:protocol.envelope(session,'cue',fields),origin,source:child,...overrides});
    const cueFields={instanceId:'a',window:'first',name:'piece',id:'a:move:2'};
    cueAs(cueFields,{source:{}}); cueAs(cueFields,{origin:'https://evil.test'});
    cueAs({...cueFields,instanceId:'old'}); cueAs({...cueFields,window:'old'});
    parent.emit('message',{data:protocol.envelope('old-session','cue',cueFields),origin,source:child});
    assert.equal(cues.length,1,'wrong source/origin/session/instance/phase audio rejected');
    const cyclic = {}; cyclic.self = cyclic;
    for (const action of [undefined, cyclic]) sendAs({ instanceId: 'a', window: 'first', action });
    assert.equal(actions.length, accepted, 'non-JSON intents cannot crash or reach the socket');
    sendAs({ instanceId: 'a', window: 'first', action: 'stale source' }, { source: {} });
    sendAs({ instanceId: 'a', window: 'first', action: 'wrong origin' }, { origin: 'https://evil.test' });
    parent.emit('message', { data: protocol.envelope('old-session', 'action', { action: 'bad session' }), origin, source: child });
    state = { ...state, w: 'second' }; host.update(root, state, api);
    sendAs({ instanceId: 'a', window: 'first', action: 'stale turn' });
    sendAs({ instanceId: 'old', window: 'second', action: 'old instance' });
    assert.equal(actions.length, accepted, 'foreign/stale actions rejected before attaching current room stamps');
    host.update(root, { ...state, spectator: true }, api); client.send({ move: 2 });
    sendAs({ instanceId: 'a', window: 'second', action: 'watcher' }); assert.equal(actions.length, accepted);
    client.rematch(); assert.equal(rematches, 0, 'cannot restart during play');
    client.resultsReady(); assert.equal(results.length, 0, 'live play cannot announce finished presentation');
    host.update(root, { ...state, phase: 'done' }, api); client.rematch(); assert.equal(rematches, 1);
    parent.emit('message', { data: protocol.envelope(session, 'results-ready', { instanceId:'old' }), origin, source:child });
    parent.emit('message', { data: protocol.envelope(session, 'results-ready', { instanceId:'a' }), origin, source:{} });
    parent.emit('message', { data: protocol.envelope(session, 'results-ready', { instanceId:'a' }), origin:'https://evil.test', source:child });
    assert.equal(results.length, 0, 'stale or foreign completion cannot reveal a result');
    client.resultsReady(); assert.deepEqual(results, ['a']);
    client.send('play-again-vote'); assert.equal(actions.at(-1).action, 'play-again-vote', 'server game owns legality of done-phase intents');
    context = { ...context, isHost: false }; host.update(root, { ...state, phase: 'done' }, api);
    client.rematch(); client.lobby(); assert.equal(rematches, 1); assert.equal(lobbies, 0);
    context = { ...context, isHost: true, voice: { enabled: true, mic: 'live' } };
    host.update(root, state, api); client.lobby(); assert.equal(lobbies, 1);
    let voice; client.voice.subscribe(s => { voice = s; }); for (const fn of observers) fn();
    assert.equal(voice.mic, 'live'); client.voice.request(); assert.equal(voices, 1);
    client.toast('Hello'); assert.equal(notices.at(-1), 'Hello');
    element.emit('load', {}); assert(seen.length > 3, 'reload handshake restores latest snapshot');
    assert(!JSON.stringify(seen).includes('seatToken'));
    client.dispose(); host.dispose(); host.dispose();
    assert.equal(parent.count('message'), 0); assert.equal(child.count('message'), 0); assert.equal(child.count('pointerdown'),0); assert.equal(child.count('keydown'),0);
    assert.equal(client.cue('piece',{id:'a:disposed'}),false); child.emit('pointerdown',{isTrusted:true}); assert.equal(unlocks,1); assert.equal(observers.size, 0); assert(element.removed);
    client.send({ move: 3 }); assert.equal(actions.length, accepted + 1, 'disposed document cannot send');

    const gameHost = await import(pathToFileURL(path.join(js, 'game-host.js')).href);
    const view = await gameHost.show(root, game.id, state, api, game);
    assert(view?.ownsInputs && gameHost.isLoaded(game.id), 'host mounts arbitrary document without a game-specific module');
    const previousFrame = root.frame;
    gameHost.reset(); assert(previousFrame.removed);
    await gameHost.show(root, game.id, { ...state, instanceId: 'rematch' }, api, game);
    assert.notEqual(root.frame, previousFrame);
    assert.notEqual(root.frame.name, previousFrame.name, 'rematches receive a fresh document/session');
    gameHost.reset(); assert.equal(parent.count('message'), 0); assert.equal(observers.size, 0);

    // Portable frame starter works without a bespoke client registration.
    const scaffold = path.join(tmp, 'scaffold');
    const generated = require('../sdk/scaffold').generate('new-world', { root: scaffold, template: 'frame' });
    assert.equal(generated.files.length, 7);
    const def = require(path.join(scaffold, 'games/new-world/server.js'));
    assert(def.manifest.homepage && def.manifest.runtime.type === 'frame');
    assert(!fs.existsSync(path.join(scaffold, 'public/js/games/new-world.js')));
    const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-game.js'), 'new-world', '--root', scaffold], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout + check.stderr);
    const entryFile = path.join(scaffold, 'games/new-world/browser/index.html');
    fs.appendFileSync(entryFile, '<script>new Function("return 42")();</script><script type="module">import engine from "https://engine.example/export.js";</script>');
    const engineCheck = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-game.js'), 'new-world', '--root', scaffold], { encoding: 'utf8' });
    assert.equal(engineCheck.status, 0, 'engine-owned HTML is not subjected to module-specific bundling rules: ' + engineCheck.stdout + engineCheck.stderr);
    fs.unlinkSync(path.join(scaffold, 'games/new-world/home/index.html'));
    const missingHome = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-game.js'), 'new-world', '--root', scaffold], { encoding: 'utf8' });
    assert.notEqual(missingHome.status, 0); assert.match(missingHome.stdout + missingHome.stderr, /missing game-owned home/);
    console.log('GAME_AUTONOMY_PASS: arbitrary renderer labels, independent home/bundle/WASM, safe atomic asset preflight, frame handshake/clock/voice/actions/staleness/spectators/host/cleanup, portable frame scaffold');
  } finally {
    for (const [k, descriptor] of globals) { if (descriptor) Object.defineProperty(global, k, descriptor); else delete global[k]; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
