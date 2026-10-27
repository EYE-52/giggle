'use strict';
// Await actual async hooks, critical CSS/fonts/assets and painted frames.
// The old host resolves before every barrier and lets paints interleave.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function emitter() {
  const callbacks = new Map();
  return {
    addEventListener(type, fn) { if (!callbacks.has(type)) callbacks.set(type, new Set()); callbacks.get(type).add(fn); },
    removeEventListener(type, fn) { callbacks.get(type)?.delete(fn); },
    emit(type, event) { for (const fn of [...(callbacks.get(type) || [])]) fn(event); },
    count: type => type ? callbacks.get(type)?.size || 0 : [...callbacks.values()].reduce((sum, set) => sum + set.size, 0),
  };
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-readiness-'));
  const originals = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'IntersectionObserver', 'setTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const originalError = console.error;
  let host;
  try {
    fs.mkdirSync(path.join(tmp, 'games')); fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(process.env.GAME_HOST_SOURCE || path.join(__dirname, '../public/js/game-host.js'), path.join(tmp, 'game-host.js'));
    fs.writeFileSync(path.join(tmp, 'games/async-view.js'), `export default {
      async mount(el,api) { el.api=api; el.mounts++; await el.mount.promise; },
      async update(el,S,api) { el.renderApi=api; el.starts.push(S.value); await el.render.promise; el.value=S.value; },
      ready(el,S) { return el.assets[S.w]?.promise; },
      dispose(el) { el.disposes++; }
    };`);
    fs.writeFileSync(path.join(tmp, 'games/css-view.js'), `export default {styles:['/critical.css'],
      render(el,S,api) { el.api=api; el.value=S.value; },
      usabilityChanged(el,S,api) { (el.usability ||= []).push({window:S.w,usable:api.isUsable()}); }, dispose(el) { el.disposes++; }
    };`);
    fs.writeFileSync(path.join(tmp, 'games/visibility-view.js'), `export default {styles:['/visibility.css'],
      async mount(el) { el.mounts++; await el.mount.promise; },
      async render(el,S) { el.starts.push(S.value); await el.render.promise; el.value=S.value; },
      ready(el,S) { el.readyCalls.push(S.w); return el.assets[S.w].promise; },
      dispose(el) { el.disposes++; }
    };`);
    fs.writeFileSync(path.join(tmp, 'games/failing-view.js'), `export default {
      async mount(el) { await el.mount.promise; throw Error('async mount failed'); },
      render() {}, dispose(el) { el.disposes++; el.innerHTML=''; }
    };`);
    const doc = { ...emitter(), visibilityState: 'visible', activeElement: null, getElementById: () => null, links: [],
      querySelectorAll() { return this.links.filter(link => !link.removed); },
      createElement(tag) {
        return { ...emitter(), tagName: tag.toUpperCase(), sheet: null, getAttribute(key) { return this[key]; }, remove() { this.removed = true; } };
      }, head: { appendChild(link) { doc.links.push(link); } } };
    global.document = doc;
    let sequence = 0; const frames = new Map();
    global.requestAnimationFrame = fn => { const id = ++sequence; frames.set(id, fn); return id; };
    global.cancelAnimationFrame = id => frames.delete(id);
    const frame = async () => { const list = [...frames]; frames.clear(); for (const [, fn] of list) fn(); await flush(); };
    host = await import(pathToFileURL(path.join(tmp, 'game-host.js')).href);
    const ack = [], errors = [], sends = [];
    const api = { ready: value => ack.push(value), loadError: value => errors.push(value), send: value => sends.push(value) };
    const snapshot = (w, value = 1) => ({ instanceId: 'match', w, preparing: true, value });
    const element = () => ({ mounts: 0, disposes: 0, starts: [], mount: deferred(), render: deferred(), assets: {}, querySelectorAll: () => [], getBoundingClientRect() {} });
    console.error = () => {};

    const el = element(); el.assets.one = deferred();
    const first = host.show(el, 'async-view', snapshot('one'), api); let settled = false; first.then(() => { settled = true; });
    await flush(); await flush();
    assert.equal(settled, false, 'async mount cannot report a loaded game'); assert.equal(el.starts.length, 0, 'render waits for mount');
    const latest = host.show(el, 'async-view', snapshot('one', 2), api);
    el.mount.resolve(); await flush(); assert.deepEqual(el.starts, [2], 'snapshots arriving during mount coalesce to the latest');
    host.show(el, 'async-view', snapshot('one', 3), api); await flush();
    assert.deepEqual(el.starts, [2], 'async render hooks never interleave');
    el.render.resolve(); await flush(); assert.deepEqual(el.starts, [2, 3]); assert.equal(el.value, 3);
    assert.equal(ack.length, 0, 'critical scene assets hold readiness');
    el.assets.one.resolve(); await flush(); await frame(); assert.equal(ack.length, 0, 'the pre-paint rAF cannot ACK');
    await frame(); assert.ok(await first); assert.ok(await latest); assert.deepEqual(ack, [{ instanceId: 'match', window: 'one' }]);
    await host.show(el, 'async-view', snapshot('one', 4), api); assert.equal(ack.length, 1, 'repeated preparation snapshots ACK once');
    host.reset(); el.api.send('retired callback'); assert.equal(sends.length, 0, 'retired view callbacks cannot send into a replacement');
    assert.equal(el.disposes, 1); assert.equal(frames.size, 0); assert.equal(doc.count(), 0);

    const font = deferred(); doc.fonts = { ready: font.promise };
    const cssEl = element(), css = host.show(cssEl, 'css-view', snapshot('css'), api); await flush(); await flush();
    assert.equal(ack.length, 1); const link = doc.links.findLast(link => !link.removed);
    link.sheet = {}; doc.emit('load', { type: 'load', target: link }); link.emit('load', {}); await flush();
    assert.equal(frames.size, 0, 'used prompt fonts hold readiness after CSS loads');
    font.resolve(); await flush(); await frame(); await frame(); assert.ok(await css); assert.equal(ack.at(-1).window, 'css');
    host.reset(); assert.equal(link.removed, true, 'host-owned styles are disposed'); delete doc.fonts;

    const reloadFont = deferred(); doc.fonts = { ready: reloadFont.promise };
    const reloadEl = element();
    const reload = host.show(reloadEl, 'css-view', { ...snapshot('reload'), preparing: false }, api);
    await flush(); await flush();
    const reloadLink = doc.links.findLast(link => !link.removed);
    reloadLink.sheet = {}; reloadLink.emit('load', {}); await flush();
    assert.equal(reloadEl.api.isUsable(), false, 'live reload input cannot be usable before fonts');
    assert.equal(reloadEl.api.send('early keyboard'), false, 'unchanged send barrier rejects early input');
    reloadFont.resolve(); await flush(); await frame(); await frame(); await reload;
    assert.equal(reloadEl.api.isUsable(), true, 'live reload becomes usable after original paint barrier');
    assert.deepEqual(reloadEl.usability, [{ window: 'reload', usable: true }]);
    const retainedReloadApi = reloadEl.api;
    await host.show(reloadEl, 'css-view', { ...snapshot('reload', 2), preparing: false }, api);
    assert.equal(reloadEl.usability.length, 1, 'heartbeat does not repeat usability callback');
    host.reset(); assert.equal(retainedReloadApi.isUsable(), false, 'retirement revokes usable contract');
    delete doc.fonts;

    const badEl = element(), bad = host.show(badEl, 'css-view', snapshot('bad'), api); await flush(); await flush();
    const failedLink = doc.links.findLast(link => !link.removed);
    doc.emit('error', { type: 'error', target: failedLink }); failedLink.emit('error', {});
    assert.equal(await bad, null); assert.equal(errors.length, 1); assert.equal(ack.length, 2); assert.equal(badEl.disposes, 1);
    assert.equal(failedLink.count(), 0, 'failed resource listeners are removed');

    let recoverySaw;
    const failEl = element(), failing = host.show(failEl, 'failing-view', snapshot('broken'), {
      ...api, loadError(value) {
        recoverySaw={ id: host.currentId(), disposes: failEl.disposes };
        errors.push(value); failEl.innerHTML='Retry view';
      },
    }); await flush(); await flush();
    failEl.mount.resolve(); assert.equal(await failing, null); assert.equal(failEl.disposes, 1);
    assert.match(errors.at(-1).error, /async mount failed/);
    assert.deepEqual(recoverySaw, { id: null, disposes: 1 }, 'view cleanup finishes before shell recovery renders');
    assert.equal(failEl.innerHTML, 'Retry view', 'view disposal cannot erase shell recovery controls');
    assert.deepEqual(errors.at(-1), { gameId: 'failing-view', instanceId: 'match', window: 'broken', error: 'async mount failed' });

    const phaseEl = element(); phaseEl.mount.resolve(); phaseEl.render.resolve(); phaseEl.assets.old = deferred(); phaseEl.assets.new = deferred();
    const oldPhase = host.show(phaseEl, 'async-view', snapshot('old'), api); await flush(); await flush();
    const newPhase = host.show(phaseEl, 'async-view', snapshot('new'), api); await flush();
    phaseEl.assets.old.resolve(); await flush(); assert.equal(ack.length, 2, 'a replaced phase cannot acknowledge stale readiness');
    phaseEl.assets.new.resolve(); await flush(); await frame(); await frame(); await oldPhase; await newPhase;
    assert.equal(ack.at(-1).window, 'new'); assert.equal(errors.length, 2, 'phase replacement is not a load failure');
    const oldApi = phaseEl.renderApi;
    await host.show(phaseEl, 'async-view', { ...snapshot('running-next'), preparing: false }, api);
    oldApi.send('late old phase'); assert.equal(sends.length, 0, 'a retained phase callback cannot acquire new action tokens');
    phaseEl.renderApi.send('current phase'); assert.deepEqual(sends, ['current phase']);
    host.reset();

    // A progress snapshot may still be rendering when the next keystroke
    // arrives. It belongs to the same action window and must not disappear.
    sends.length = 0;
    const typingEl = element(); typingEl.mount.resolve(); typingEl.render.resolve();
    typingEl.assets.typing = deferred(); typingEl.assets.typing.resolve();
    const typing = host.show(typingEl, 'async-view', { ...snapshot('typing'), preparing: false }, api);
    await flush(); await flush(); await frame(); await frame(); await typing;
    const retainedTypingApi = typingEl.renderApi;
    typingEl.render = deferred();
    const progress = host.show(typingEl, 'async-view', { ...snapshot('typing', 2), preparing: false }, api);
    await flush();
    retainedTypingApi.send('final characters');
    assert.deepEqual(sends, ['final characters'], 'same-window pending progress paint cannot drop the final input');
    typingEl.render = deferred();
    const nextTyping = host.show(typingEl, 'async-view', { ...snapshot('next-typing', 3), preparing: false }, api);
    await flush();
    assert.equal(typingEl.api.send('unpainted new round'), false, 'even mount APIs wait for a new window to render');
    assert.equal(retainedTypingApi.send('old round input'), false, 'old input handlers cannot enter a new window');
    typingEl.render.resolve(); await flush(); await progress; await nextTyping;
    typingEl.renderApi.send('new round input');
    assert.deepEqual(sends, ['final characters', 'new round input'], 'the rendered new window accepts its own input');
    host.reset();

    const retiredEl = element(), retired = host.show(retiredEl, 'css-view', snapshot('retired'), api); await flush(); await flush(); host.reset();
    assert.equal(await retired, null); assert.equal(errors.length, 2, 'intentional exit is not a load error');
    assert.equal(doc.count(), 0); assert.equal(frames.size, 0);

    // Hidden documents do not receive reliable rAF callbacks. They still
    // need every resource and render hook before they may release a turn.
    const visibilityAcks = [], visibilityErrors = [];
    const visibilityApi = { ...api, ready: value => visibilityAcks.push(value), loadError: value => visibilityErrors.push(value) };
    const hide = () => { doc.visibilityState = 'hidden'; doc.emit('visibilitychange', {}); };
    const visible = () => { doc.visibilityState = 'visible'; doc.emit('visibilitychange', {}); };
    const prepared = window => {
      const n = element(); n.mount.resolve(); n.render.resolve(); n.assets[window] = deferred(); n.assets[window].resolve(); return n;
    };
    hide();
    const hiddenFont = deferred(), imageDecode = deferred(), image = { ...emitter(), complete: false, naturalWidth: 0, decode: () => imageDecode.promise };
    doc.fonts = { ready: hiddenFont.promise };
    const hiddenEl = element(); hiddenEl.readyCalls = []; hiddenEl.assets.hidden = deferred(); hiddenEl.querySelectorAll = selector => selector === 'img[data-game-critical]' ? [image] : [];
    const hiddenLoad = host.show(hiddenEl, 'visibility-view', snapshot('hidden', 9), visibilityApi);
    await flush(); await flush();
    const hiddenStyle = doc.links.findLast(link => !link.removed);
    assert.equal(hiddenEl.mounts, 0, 'hidden initial view still waits for its stylesheet');
    assert.equal(visibilityAcks.length, 0); assert.equal(frames.size, 0);
    hiddenStyle.sheet = {}; hiddenStyle.emit('load', {}); await flush();
    assert.equal(hiddenEl.mounts, 1); assert.equal(hiddenEl.starts.length, 0, 'hidden mount completion remains mandatory');
    hiddenEl.mount.resolve(); await flush();
    assert.deepEqual(hiddenEl.starts, [9]); assert.equal(hiddenEl.value, undefined, 'hidden async render remains mandatory');
    hiddenEl.render.resolve(); await flush();
    assert.equal(hiddenEl.value, 9); assert.equal(visibilityAcks.length, 0, 'hidden font loading cannot be skipped');
    hiddenFont.resolve(); await flush();
    assert.equal(visibilityAcks.length, 0, 'hidden critical image loading cannot be skipped');
    image.complete = true; image.naturalWidth = 64; image.emit('load', {}); await flush();
    assert.deepEqual(hiddenEl.readyCalls, [], 'hidden image decode precedes view.ready');
    imageDecode.resolve(); await flush();
    assert.deepEqual(hiddenEl.readyCalls, ['hidden']); assert.equal(visibilityAcks.length, 0, 'hidden view.ready remains mandatory');
    hiddenEl.assets.hidden.resolve(); await flush(); await flush();
    assert.deepEqual(visibilityAcks, [{ instanceId: 'match', window: 'hidden' }], 'loaded/rendered hidden view ACKs without a rAF or timeout');
    assert.equal(frames.size, 0, 'hidden readiness never queues a paint callback'); assert.equal(doc.count('visibilitychange'), 0); assert.ok(await hiddenLoad);
    host.reset(); delete doc.fonts; assert.equal(hiddenStyle.removed, true); assert.equal(image.count(), 0); assert.equal(doc.count(), 0);

    visible(); visibilityAcks.length = 0;
    const visibleEl = prepared('two-paints'), visibleLoad = host.show(visibleEl, 'async-view', snapshot('two-paints'), visibilityApi);
    await flush(); await flush();
    assert.equal(frames.size, 1); assert.equal(visibilityAcks.length, 0, 'visible view requires its first frame');
    await frame(); assert.equal(visibilityAcks.length, 0, 'first visible frame remains pre-paint'); assert.equal(frames.size, 1);
    await frame(); assert.ok(await visibleLoad); assert.deepEqual(visibilityAcks, [{ instanceId: 'match', window: 'two-paints' }]);
    assert.equal(doc.count('visibilitychange'), 0, 'visible completion removes its visibility listener'); host.reset();

    // Hide while the second frame is pending, then deliver the callback
    // despite cancellation after a new action window has arrived.
    visibilityAcks.length = 0;
    const midEl = prepared('mid-hide'), midLoad = host.show(midEl, 'async-view', snapshot('mid-hide'), visibilityApi);
    await flush(); await flush(); await frame();
    const queuedAfterHide = [...frames.values()][0]; assert.equal(typeof queuedAfterHide, 'function');
    hide(); await flush(); await flush();
    assert.deepEqual(visibilityAcks, [{ instanceId: 'match', window: 'mid-hide' }], 'hiding during the second frame releases the loaded current window');
    assert.equal(frames.size, 0, 'hiding cancels the pending frame'); assert.equal(doc.count('visibilitychange'), 0); assert.ok(await midLoad);
    midEl.assets['after-hide'] = deferred();
    const nextHidden = host.show(midEl, 'async-view', snapshot('after-hide'), visibilityApi); await flush();
    queuedAfterHide(); queuedAfterHide(); await flush();
    assert.equal(visibilityAcks.length, 1, 'late cancelled callback cannot ACK or settle the new window');
    midEl.assets['after-hide'].resolve(); await flush(); assert.ok(await nextHidden);
    assert.deepEqual(visibilityAcks.map(n => n.window), ['mid-hide', 'after-hide']); queuedAfterHide(); await flush(); assert.equal(visibilityAcks.length, 2, 'late callback cannot duplicate readiness'); host.reset();

    // A visibility completion queued in the same turn as replacement must
    // not ACK the old token after its microtask resumes.
    visible(); visibilityAcks.length = 0;
    const changedEl = prepared('old-visible'), changedOld = host.show(changedEl, 'async-view', snapshot('old-visible'), visibilityApi);
    await flush(); await flush();
    const retiredFrame = [...frames.values()][0]; hide();
    changedEl.assets['current-hidden'] = deferred();
    const changedCurrent = host.show(changedEl, 'async-view', snapshot('current-hidden'), visibilityApi); await flush(); retiredFrame(); await flush();
    assert.equal(visibilityAcks.length, 0, 'hide plus immediate window replacement cannot ACK the retired token');
    changedEl.assets['current-hidden'].resolve(); await flush(); await changedOld; assert.ok(await changedCurrent);
    assert.deepEqual(visibilityAcks, [{ instanceId: 'match', window: 'current-hidden' }]); assert.equal(frames.size, 0); host.reset();

    visible(); visibilityAcks.length = 0;
    const exitEl = prepared('exit'), exitLoad = host.show(exitEl, 'async-view', snapshot('exit'), visibilityApi); await flush(); await flush();
    const afterExit = [...frames.values()][0]; host.reset(); afterExit(); hide(); await flush();
    assert.equal(await exitLoad, null); assert.equal(visibilityAcks.length, 0, 'retired visible frame cannot ACK after hiding'); assert.equal(frames.size, 0); assert.equal(doc.count(), 0);
    const hiddenExitEl = prepared('hidden-exit'); hiddenExitEl.assets['hidden-exit'] = deferred();
    const hiddenExit = host.show(hiddenExitEl, 'async-view', snapshot('hidden-exit'), visibilityApi); await flush(); await flush(); host.reset(); hiddenExitEl.assets['hidden-exit'].resolve(); await flush();
    assert.equal(await hiddenExit, null); assert.equal(visibilityAcks.length, 0, 'retired hidden resource work cannot ACK'); assert.equal(doc.count(), 0); assert.deepEqual(visibilityErrors, [], 'visibility changes and intentional retirement are not loading failures');
    // Offscreen embedded documents remain visible but may get no usable rAF.
    visible(); visibilityAcks.length = 0; visibilityErrors.length = 0;
    doc.documentElement = {};
    const intersections = [];
    global.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; this.disconnected = false; intersections.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
      emit(isIntersecting) { this.callback([{ target: this.target, isIntersecting }]); }
    };
    const offscreenEl = prepared('offscreen'); offscreenEl.assets.offscreen = deferred();
    const offscreenLoad = host.show(offscreenEl, 'async-view', snapshot('offscreen'), visibilityApi);
    await flush(); await flush(); assert.equal(intersections.length, 0, 'offscreen observation cannot bypass view assets');
    offscreenEl.assets.offscreen.resolve(); await flush(); await flush();
    const initiallyOffscreen = intersections.at(-1); assert.ok(initiallyOffscreen, 'ready offscreen view observes ancestor clipping'); assert.equal(initiallyOffscreen.target, doc.documentElement);
    initiallyOffscreen.emit(false); await flush(); assert.ok(await offscreenLoad);
    assert.deepEqual(visibilityAcks.map(x => x.window), ['offscreen'], 'initial offscreen entry releases only the ready current window');
    assert.ok(initiallyOffscreen.disconnected); assert.equal(frames.size, 0); assert.equal(doc.count('visibilitychange'), 0); host.reset(); assert.equal(doc.count(), 0);

    visibilityAcks.length = 0;
    const intersectingEl = prepared('intersecting'), intersectingLoad = host.show(intersectingEl, 'async-view', snapshot('intersecting'), visibilityApi);
    await flush(); await flush(); const onScreen = intersections.at(-1); onScreen.emit(true); await flush();
    assert.equal(visibilityAcks.length, 0, 'visible intersection never replaces the paint barrier');
    await frame(); assert.equal(visibilityAcks.length, 0); await frame(); assert.ok(await intersectingLoad);
    assert.equal(visibilityAcks.length, 1); assert.ok(onScreen.disconnected); host.reset();

    visibilityAcks.length = 0;
    const movingOffEl = prepared('moving-off'), movingOffLoad = host.show(movingOffEl, 'async-view', snapshot('moving-off'), visibilityApi);
    await flush(); await flush(); const movingObserver = intersections.at(-1); movingObserver.emit(true); await frame();
    const lateOffFrame = [...frames.values()][0]; movingObserver.emit(false); await flush(); assert.ok(await movingOffLoad);
    assert.equal(visibilityAcks.length, 1); assert.equal(frames.size, 0); assert.ok(movingObserver.disconnected);
    lateOffFrame(); movingObserver.emit(false); await flush(); assert.equal(visibilityAcks.length, 1, 'late observer/frame callbacks cannot duplicate readiness'); host.reset();

    visibilityAcks.length = 0;
    const disposedEl = prepared('disposed-off'), disposedLoad = host.show(disposedEl, 'async-view', snapshot('disposed-off'), visibilityApi);
    await flush(); await flush(); const disposedObserver = intersections.at(-1); host.reset(); disposedObserver.emit(false); await flush();
    assert.equal(await disposedLoad, null); assert.equal(visibilityAcks.length, 0); assert.ok(disposedObserver.disconnected); assert.equal(frames.size, 0); assert.equal(doc.count(), 0);

    visibilityAcks.length = 0;
    const replacedEl = prepared('old-off'), replacedLoad = host.show(replacedEl, 'async-view', snapshot('old-off'), visibilityApi);
    await flush(); await flush(); const staleObserver = intersections.at(-1); staleObserver.emit(false);
    replacedEl.assets['new-off'] = deferred();
    const replacingLoad = host.show(replacedEl, 'async-view', snapshot('new-off'), visibilityApi); await flush();
    assert.equal(visibilityAcks.length, 0, 'offscreen completion cannot ACK a synchronously superseded window');
    replacedEl.assets['new-off'].resolve(); await flush(); await flush(); intersections.at(-1).emit(false); await flush();
    await replacedLoad; assert.ok(await replacingLoad); assert.deepEqual(visibilityAcks.map(x => x.window), ['new-off']);
    staleObserver.emit(false); await flush(); assert.equal(visibilityAcks.length, 1); host.reset();

    const timeoutEl = prepared('timeout-off'); let fireTimeout;
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => { if (ms === 10000) fireTimeout = fn; return realTimeout(fn, ms); };
    const timedOutLoad = host.show(timeoutEl, 'async-view', snapshot('timeout-off'), visibilityApi);
    global.setTimeout = realTimeout;
    await flush(); await flush(); const timedOutObserver = intersections.at(-1); fireTimeout(); await flush();
    assert.equal(await timedOutLoad, null); assert.ok(timedOutObserver.disconnected); assert.equal(frames.size, 0);
    assert.equal(visibilityErrors.at(-1).error, 'Game preparation timed out', 'parent abort preserves its actionable preparation reason');
    delete global.IntersectionObserver; delete doc.documentElement;

    // Real legacy views borrow declared CSS without a second request.
    const partyFixtures = require('./party-scenes-browser').FIXTURES;
    const stylesheetGames = [...partyFixtures.map(f => f.id), 'doodle-guess'];
    for (const game of stylesheetGames) {
      fs.copyFileSync(path.join(__dirname, '../public/js/games', game + '.js'), path.join(tmp, 'games', game + '.js'));
    }
    fs.copyFileSync(path.join(__dirname, '../public/js/util.js'), path.join(tmp, 'util.js'));
    fs.copyFileSync(path.join(__dirname, '../public/js/kit.js'), path.join(tmp, 'kit.js'));
    doc.visibilityState = 'hidden';
    doc.getElementById = id => doc.links.find(link => !link.removed && link.id === id) || null;
    const { surface } = require('./party-mobile');
    doc.roots = [];
    for (const game of stylesheetGames) {
      const actualView = (await import(pathToFileURL(path.join(tmp, 'games', game + '.js')).href)).default;
      for (const mode of ['load', 'error', 'retire', 'external']) {
        host.reset(); doc.links = []; ack.length = 0; errors.length = 0;
        const hrefs = actualView.styles;
        if (mode === 'external') for (const href of hrefs) { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = href; doc.head.appendChild(link); }
        const fixture = partyFixtures.find(f => f.id === game);
        const state = fixture ? structuredClone(fixture.frames.at(-1).views.find(v => v.me === 'p1')) : { phase:'done', game, me:'a', players:[{id:'a',name:'A'}], scores:{}, round:1, rounds:1 };
        const el = surface(doc); el.getBoundingClientRect = () => ({});
        const pending = host.show(el, game, { ...state, ...snapshot(mode) }, api);
        for (let i=0; i<10; i++) await flush();
        assert.equal(doc.links.length, hrefs.length, game + ' creates one request/link per declared href');
        assert.equal(ack.length, 0, game + ' waits original CSS');
        assert(doc.links.every(link => !link.id), game + ' never assigns a borrowed legacy ID');
        if (mode === 'retire') host.reset();
        for (const link of doc.links) { link.sheet = mode === 'error' ? null : {}; link.emit(mode === 'error' ? 'error' : 'load'); doc.emit(mode === 'error' ? 'error' : 'load', {target:link}); }
        await pending;
        assert.equal(ack.length, mode === 'error' || mode === 'retire' ? 0 : 1, game + ' CSS error/retirement cannot ACK');
        assert.equal(errors.length, mode === 'error' ? 1 : 0, game + ' only required CSS failure reports a load error');
        host.reset();
        assert.equal(doc.querySelectorAll().length, mode === 'external' ? hrefs.length : 0, game + ' external styles survive, host-owned styles removed');
      }
    }
    const { ensureStylesheet } = await import(pathToFileURL(path.join(tmp, 'util.js')).href);
    doc.links = [];
    const fallback = ensureStylesheet('legacy-css', '/legacy.css');
    assert.equal(fallback.id, 'legacy-css', 'direct render fallback creates its legacy-owned ID');
    assert.equal(ensureStylesheet('legacy-css', '/legacy.css'), fallback, 'legacy ID reuse creates no second request');
    assert.equal(ensureStylesheet('another-id', '/legacy.css'), fallback, 'href reuse never assigns a second ID');
    assert.equal(fallback.id, 'legacy-css');
    const query = doc.querySelectorAll; delete doc.querySelectorAll;
    assert.equal(ensureStylesheet('legacy-css', '/legacy.css'), fallback, 'legacy documents without stylesheet queries still reuse IDs');
    doc.querySelectorAll = query;
    global.document = undefined;
    assert.equal(ensureStylesheet('none', '/none.css'), null, 'server/legacy no-DOM contexts stay safe');
    global.document = doc;
    console.log('VIEW_READINESS_PASS: async resources/render serialization, visible two-frame paint opportunity, hidden/offscreen initial/mid-frame readiness, visible IO, stale callbacks/windows, abort reasons, retirement and cleanup');
  } finally {
    host?.reset();
    console.error = originalError;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
