'use strict';
/* Game entry + server clock/phase integration.
 *
 * Part A (pure, no server): ?game=id&name=...[&wantsetup=1] from the
 * generated /games/id/ pages. Validates against the ACTUAL catalog,
 * name 1..16, one-shot create once WS+catalog ready, never auto-start,
 * invalid never creates, bare visits inert, explicit query overrides
 * remembered pb_room autojoin, query cleared after consumption, embed
 * and /r/ links unaffected, Details hrefs traversal-safe.
 *
 * Part B (real WS): clock roundtrip + snapshot serverNow/phaseStartedAt
 * stability + rematch. Spawns the real server on a scratch port.
 * Fails before the integration lands (no clock responder, no snapshot
 * fields); passes after. No browser, no credentials, no deploy.
 *
 * Run: node test/game-entry.js
 * Run pure only: node test/game-entry.js --pure (before server lands)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PURE_ONLY = process.argv.includes('--pure');

async function loadEntry() {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/game-entry.js'), 'utf8');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ge-')), 'game-entry.mjs');
  fs.writeFileSync(tmp, src);
  return import(tmp);
}

function catalogFixture() {
  return [
    { id: 'chess', customizable: true },
    { id: 'trivia', customizable: false },
    { id: 'castle-clash', customizable: true },
  ];
}

async function partA(m) {
  const {
    parseGameEntry, validateGameEntry, shouldHandleGameEntry,
    entryOverridesAutojoin, stripGameEntryParams,
    decideGameEntryCreate, decideGameEntryShow, detailsHref,
    setPendingGameEntry, peekPendingGameEntry, takePendingGameEntry,
    MAX_ENTRY_NAME,
  } = m;

  assert.equal(MAX_ENTRY_NAME, 16, 'name cap is 16');

  // parse: bare visits have no effects
  assert.equal(parseGameEntry(''), null, 'empty query -> null');
  assert.equal(parseGameEntry('?'), null, 'bare ? -> null');
  assert.equal(parseGameEntry('?name=Pippa'), null, 'name alone -> null');
  assert.equal(parseGameEntry('?game='), null, 'empty game -> null');
  assert.equal(parseGameEntry('?embed=1&parentOrigin=https%3A%2F%2Fx.test'), null, 'embed query alone -> null');

  // parse: explicit form submission shape
  assert.deepEqual(
    parseGameEntry('?game=chess&name=Pippa'),
    { gameId: 'chess', name: 'Pippa', wantSetup: false },
    'plain create parses');
  assert.deepEqual(
    parseGameEntry('?game=chess&name=%20Pippa%20&wantsetup=1'),
    { gameId: 'chess', name: ' Pippa ', wantSetup: true },
    'wantsetup + encoded name parses');
  assert.deepEqual(
    parseGameEntry('?game=trivia&name=Bo&wantsetup=1&embed=1'),
    { gameId: 'trivia', name: 'Bo', wantSetup: true },
    'extra keys preserved in parse (handled downstream)');

  // validate: actual catalog, never hardcoded
  const catalog = catalogFixture();
  assert.deepEqual(
    validateGameEntry(parseGameEntry('?game=chess&name=Pippa'), catalog),
    { ok: true, gameId: 'chess', name: 'Pippa', wantSetup: false, customizable: true },
    'valid chess entry');
  assert.deepEqual(
    validateGameEntry(parseGameEntry('?game=chess&name=%20%20Pippa%20%20&wantsetup=1'), catalog),
    { ok: true, gameId: 'chess', name: 'Pippa', wantSetup: true, customizable: true },
    'name trimmed, wantsetup kept when supported');

  // wantsetup on a game without schema degrades, still valid
  const triviaSetup = validateGameEntry(parseGameEntry('?game=trivia&name=Bo&wantsetup=1'), catalog);
  assert.equal(triviaSetup.ok, true, 'trivia+wantsetup still ok');
  assert.equal(triviaSetup.wantSetup, false, 'unsupported wantsetup degrades to plain');

  // invalid id/name never auto-creates
  for (const q of ['?game=nope&name=Pippa', '?game=../x&name=Pippa', '?game=CHESS&name=Pippa', '?game=a&name=Pippa']) {
    const v = validateGameEntry(parseGameEntry(q), catalog);
    assert.equal(v.ok, false, `${q} invalid id`);
    assert.equal(v.reason, 'unknown-game', `${q} reason`);
  }
  for (const q of ['?game=chess&name=', '?game=chess&name=%20%20', '?game=chess&name=12345678901234567']) {
    const v = validateGameEntry(parseGameEntry(q), catalog);
    assert.equal(v.ok, false, `${q} invalid name`);
    assert.equal(v.reason, 'bad-name', `${q} reason`);
  }
  // exactly 16 chars is valid
  const v16 = validateGameEntry(parseGameEntry('?game=chess&name=1234567890123456'), catalog);
  assert.equal(v16.ok, true, '16-char name valid');

  // empty catalog means WAIT, not invalid
  const pending = validateGameEntry(parseGameEntry('?game=chess&name=Pippa'), []);
  assert.deepEqual(pending, { ok: false, reason: 'catalog-pending' }, 'empty catalog pends');

  // string-list catalogs (registry ids only) still validate membership
  const strOk = validateGameEntry(parseGameEntry('?game=chess&name=Pippa'), ['chess', 'trivia']);
  assert.equal(strOk.ok, true, 'string catalog validates membership');
  const strBad = validateGameEntry(parseGameEntry('?game=nope&name=Pippa'), ['chess']);
  assert.equal(strBad.reason, 'unknown-game', 'string catalog rejects unknown');

  // scope: home standalone only; embed and /r/ unaffected
  assert.equal(
    shouldHandleGameEntry({ parsed: parseGameEntry('?game=chess&name=P'), pathname: '/', embedEnabled: false }),
    true, 'home standalone handles');
  assert.equal(
    shouldHandleGameEntry({ parsed: parseGameEntry('?game=chess&name=P'), pathname: '/index.html', embedEnabled: false }),
    true, '/index.html handles');
  assert.equal(
    shouldHandleGameEntry({ parsed: parseGameEntry('?game=chess&name=P'), pathname: '/', embedEnabled: true }),
    false, 'embed unaffected');
  assert.equal(
    shouldHandleGameEntry({ parsed: parseGameEntry('?game=chess&name=P'), pathname: '/r/ABCD', embedEnabled: false }),
    false, '/r/ link unaffected');
  assert.equal(
    shouldHandleGameEntry({ parsed: null, pathname: '/', embedEnabled: false }),
    false, 'no parsed entry -> no handling');

  // explicit valid query overrides remembered autojoin
  assert.equal(entryOverridesAutojoin({ ok: true, gameId: 'chess' }), true, 'valid overrides autojoin');
  assert.equal(entryOverridesAutojoin({ ok: false }), false, 'invalid never overrides');
  assert.equal(entryOverridesAutojoin(null), false, 'missing never overrides');

  // consumption clears entry keys, preserves the rest
  assert.equal(stripGameEntryParams('?game=chess&name=Pippa&wantsetup=1'), '', 'full entry stripped');
  assert.equal(
    stripGameEntryParams('?game=chess&name=P&embed=1&parentOrigin=https%3A%2F%2Fx.test'),
    '?embed=1&parentOrigin=https%3A%2F%2Fx.test',
    'embed keys preserved');
  assert.equal(stripGameEntryParams(''), '', 'empty stays empty');

  // decide create: ONE room once WS+catalog ready, never auto-start
  const good = { ok: true, gameId: 'chess', name: 'Pippa', wantSetup: false };
  assert.deepEqual(
    decideGameEntryCreate({ validated: good, wsReady: true, catalogReady: true, inRoom: false, consumed: false }),
    { action: 'create', name: 'Pippa', gameId: 'chess', wantSetup: false },
    'ready -> single create');
  assert.deepEqual(
    decideGameEntryCreate({ validated: good, wsReady: false, catalogReady: true, inRoom: false, consumed: false }),
    { action: 'wait' }, 'socket down -> wait, not create');
  assert.deepEqual(
    decideGameEntryCreate({ validated: good, wsReady: true, catalogReady: false, inRoom: false, consumed: false }),
    { action: 'wait' }, 'catalog pending -> wait, not create');
  assert.deepEqual(
    decideGameEntryCreate({ validated: good, wsReady: true, catalogReady: true, inRoom: false, consumed: true }),
    { action: 'none' }, 'consumed -> never again (refresh safe)');
  assert.deepEqual(
    decideGameEntryCreate({ validated: good, wsReady: true, catalogReady: true, inRoom: true, consumed: false }),
    { action: 'none' }, 'already in room -> no second create');
  assert.deepEqual(
    decideGameEntryCreate({ validated: { ok: false }, wsReady: true, catalogReady: true, inRoom: false, consumed: false }),
    { action: 'none' }, 'invalid -> never creates');
  // decide never emits a start action
  for (const c of [true, false]) {
    const d = decideGameEntryCreate({ validated: good, wsReady: c, catalogReady: c, inRoom: false, consumed: false });
    assert.ok(d.action === 'create' || d.action === 'wait', 'no auto-start action');
  }

  // decide show: lobby selects the game; customizer only when supported
  assert.deepEqual(
    decideGameEntryShow({ pending: { gameId: 'chess', wantSetup: true }, inLobby: true, catalog }),
    { action: 'show', gameId: 'chess', open: 'customizer' },
    'wantsetup + supported -> customizer');
  assert.deepEqual(
    decideGameEntryShow({ pending: { gameId: 'chess', wantSetup: false }, inLobby: true, catalog }),
    { action: 'show', gameId: 'chess', open: 'howto' },
    'plain -> howto');
  assert.deepEqual(
    decideGameEntryShow({ pending: { gameId: 'trivia', wantSetup: true }, inLobby: true, catalog }),
    { action: 'show', gameId: 'trivia', open: 'howto' },
    'wantsetup + unsupported -> howto fallback');
  assert.deepEqual(
    decideGameEntryShow({ pending: { gameId: 'nope', wantSetup: true }, inLobby: true, catalog }),
    { action: 'none' }, 'unknown game -> nothing');
  assert.deepEqual(
    decideGameEntryShow({ pending: { gameId: 'chess' }, inLobby: false, catalog }),
    { action: 'none' }, 'not in lobby -> nothing');

  // one-shot slot
  assert.equal(peekPendingGameEntry(), null, 'slot starts empty');
  setPendingGameEntry(good);
  assert.deepEqual(peekPendingGameEntry(), good, 'slot holds');
  assert.deepEqual(takePendingGameEntry(), good, 'take consumes');
  assert.equal(takePendingGameEntry(), null, 'second take empty');

  // Details hrefs: native links, traversal-safe
  assert.equal(detailsHref('chess'), '/games/chess/', 'good id links');
  assert.equal(detailsHref('castle-clash'), '/games/castle-clash/', 'dashed id links');
  for (const bad of ['../x', '..', '/abs', 'A B', 'a"b', 'x', 'a'.repeat(41), '', null, 42]) {
    assert.equal(detailsHref(bad), null, `unsafe id ${JSON.stringify(bad)} has no link`);
  }

  console.log('GAME-ENTRY pure ok: parse/validate/scope/override/strip/decide/slot/details');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function partB() {
  const WebSocket = require('ws');
  const PORT = 18377;
  const srv = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  const fail = (msg) => {
    console.error('GAME-ENTRY-WS-FAIL', msg, '\n--- server log ---\n' + out);
    try { srv.kill(); } catch { /* noop */ }
    process.exit(1);
  };
  try {
    for (let i = 0; i < 50 && !out.includes('PartyBox on'); i++) await sleep(100);
    if (!out.includes('PartyBox on')) return fail('server did not boot');

    // Also verify the static game-page route while the server is up:
    // /games/<id>/ resolves to its index, traversal-safe, unknown 404.
    const http = require('node:http');
    const get = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    const page = await get('/games/chess/');
    if (page.status !== 200 || !page.body.includes('<form class="gp-cta" method="GET" action="/">')) {
      return fail(`GET /games/chess/ want 200 + CTA form, saw ${page.status}`);
    }
    const unknown = await get('/games/does-not-exist-xyz/');
    if (unknown.status !== 404) return fail(`unknown slug want 404, saw ${unknown.status}`);
    const traversal = await get('/games/../server.js');
    if (traversal.status !== 400 && traversal.status !== 404) {
      return fail(`traversal want 400/404, saw ${traversal.status}`);
    }
    // The form posts GET /?game=&name= — the shell owns creation, the page none.
    if (!page.body.includes('name="game" value="chess"') || !page.body.includes('name="name"')) {
      return fail('game page CTA missing game/name fields');
    }

    const mk = () => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      ws.msgs = [];
      ws.on('message', (d) => { try { ws.msgs.push(JSON.parse(d)); } catch { /* ignore */ } });
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
    const a = await mk();
    const b = await mk();
    const send = (ws, o) => ws.send(JSON.stringify(o));
    const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);
    const count = (ws, t) => ws.msgs.filter((m) => m.t === t).length;

    // Clock: bounded string id in, same id + serverNow out.
    const before = Date.now();
    send(a, { t: 'clock', id: 'c1' });
    await sleep(200);
    const clk = last(a, 'clock');
    if (!clk || clk.id !== 'c1') return fail(`clock echo missing (saw ${JSON.stringify(clk)})`);
    if (!Number.isFinite(clk.serverNow) || clk.serverNow < before - 1000 || clk.serverNow > Date.now() + 1000) {
      return fail(`clock serverNow not Date.now-anchored (saw ${JSON.stringify(clk)})`);
    }
    // Bounded ids only: missing/non-string/empty/huge ids get no answer.
    const n0 = count(a, 'clock');
    send(a, { t: 'clock' });
    send(a, { t: 'clock', id: 42 });
    send(a, { t: 'clock', id: '' });
    send(a, { t: 'clock', id: 'x'.repeat(200) });
    await sleep(200);
    if (count(a, 'clock') !== n0) return fail('clock answered an unbounded id');
    // Second valid id still answered (no stuck state).
    send(a, { t: 'clock', id: 'c2' });
    await sleep(200);
    if (last(a, 'clock').id !== 'c2') return fail('second clock id not echoed');

    // Room + game snapshots carry serverNow + stable phaseStartedAt.
    send(a, { t: 'create', name: 'Ann' });
    await sleep(200);
    const room = last(a, 'room');
    if (!room) return fail('no room after create');
    const code = room.room.code;
    send(b, { t: 'join', name: 'Bob', code });
    await sleep(200);
    send(a, { t: 'start', game: 'trivia' });
    await sleep(300);
    let st = last(a, 'state');
    if (!st || st.game !== 'trivia') return fail(`no trivia state (saw ${JSON.stringify(last(a, 'error'))})`);
    if (!Number.isFinite(st.serverNow)) return fail('snapshot missing numeric serverNow');
    if (!Number.isFinite(st.phaseStartedAt) || st.phaseStartedAt <= 0) {
      return fail(`snapshot missing numeric phaseStartedAt (saw ${JSON.stringify(st.phaseStartedAt)})`);
    }
    if (!st.instanceId || typeof st.w !== 'string') return fail('race tokens missing (instanceId/w)');
    const firstPhaseStart = st.phaseStartedAt;
    const firstW = st.w;
    const firstInstance = st.instanceId;
    const totalsBefore = JSON.stringify(st.totals);

    // Same-window actions keep ONE phaseStartedAt (late joiners share it).
    for (const ws of [a, b]) ws.msgs = [];
    send(a, { t: 'action', a: { vote: 'a' }, i: firstInstance, w: firstW });
    await sleep(200);
    st = last(a, 'state');
    if (!st) return fail('no state after same-window action');
    if (st.phaseStartedAt !== firstPhaseStart) return fail('phaseStartedAt churned within one window');
    if (st.w !== firstW) return fail('w token churned on input-only action');
    // Late joiner shares the bar: same phaseStartedAt, fresh serverNow.
    const c = await mk();
    send(c, { t: 'join', name: 'Cat', code });
    await sleep(300);
    const late = last(c, 'state');
    if (!late) return fail('late joiner saw no state');
    if (late.phaseStartedAt !== firstPhaseStart) return fail('late joiner phaseStartedAt differs');
    if (!Number.isFinite(late.serverNow)) return fail('late joiner missing serverNow');
    if (late.instanceId !== firstInstance) return fail('late joiner instanceId differs');

    // Concurrent same-window votes both count (no global revision gate).
    for (const ws of [a, b]) ws.msgs = [];
    send(a, { t: 'action', a: { answer: 0 }, i: firstInstance, w: firstW });
    send(b, { t: 'action', a: { answer: 1 }, i: firstInstance, w: firstW });
    await sleep(300);
    st = last(a, 'state');
    if (!st || st.phaseStartedAt !== firstPhaseStart) return fail('concurrent votes broke window stability');

    // Rematch: new instanceId, new phaseStartedAt, fresh serverNow.
    send(a, { t: 'start', game: 'trivia' });
    await sleep(300);
    const re = last(a, 'state');
    if (!re || re.game !== 'trivia') return fail('no state after rematch start');
    if (re.instanceId === firstInstance) return fail('rematch kept the old instanceId');
    if (!Number.isFinite(re.phaseStartedAt)) return fail('rematch missing phaseStartedAt');
    if (re.phaseStartedAt < firstPhaseStart) return fail('rematch phaseStartedAt went backwards');
    if (!Number.isFinite(re.serverNow)) return fail('rematch missing serverNow');
    // Stale-instance actions are dropped (race preserved), totals untouched by clock.
    for (const ws of [a, b]) ws.msgs = [];
    send(a, { t: 'action', a: { answer: 2 }, i: firstInstance, w: firstW });
    await sleep(200);
    const afterStale = last(a, 'state');
    if (afterStale && afterStale.instanceId !== re.instanceId) return fail('stale instance contaminated rematch');
    if (afterStale) return fail('stale instance caused a broadcast in the new round');
    if (JSON.stringify(last(a, 'state')?.totals || re.totals || {}) !== JSON.stringify(re.totals || {})) return fail('stale action changed rematch totals');

    for (const ws of [a, b, c]) { try { ws.close(); } catch { /* noop */ } }
    srv.kill();
    console.log('GAME-ENTRY-WS ok: /games route + clock echo/bounds + serverNow/phaseStart stability + late-join share + rematch');
  } catch (e) {
    fail(String(e && e.stack || e));
  }
}

(async () => {
  const m = await loadEntry();
  await partA(m);
  if (PURE_ONLY) {
    console.log('GAME-ENTRY-PASS (pure only)');
    return;
  }
  await partB();
  console.log('GAME-ENTRY-PASS: validation + WS clock/phaseStart/rematch');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
