const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Compile the real loader with isolated globals. require() records SDK selection
// without importing Agora or contacting any service.
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/web.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness(mode, flag, hostname, protocol = 'http:') {
  const exported = {}, calls = [], stand = { fixture: true }, real = { fixture: false };
  const requireStub = id => { if (id === './types.ts') return {}; calls.push(id); return real; };
  const fixtureGlobal = { __GIGGLE_TEST_RTC__: stand };
  const location = hostname == null ? undefined : { hostname, protocol };
  new Function('exports', 'require', 'process', 'globalThis', 'location', compiled)(
    exported, requireStub, { env: { NODE_ENV: mode, NEXT_PUBLIC_GIGGLE_LOCAL_RTC_FIXTURE: flag } }, fixtureGlobal, location,
  );
  return { ...exported, calls };
}
test('only explicit loopback HTTP development selects the local RTC adapter', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const h = harness('development', '1', host);
    assert.equal(h.localRtcFixtureAllowed(), true);
    await h.preloadVideoSdk();
    assert.deepEqual(h.calls, []);
  }
});
test('production, remote origins, missing opt-in and SSR always select the real SDK', async () => {
  for (const args of [
    ['production', '1', 'localhost'], ['test', '1', 'localhost'],
    ['development', undefined, 'localhost'], ['development', '0', 'localhost'],
    ['development', '1', 'gigglemeet.com'], ['development', '1', 'localhost.evil.test'],
    ['development', '1', '192.168.1.1'], ['development', '1', null],
    ['development', '1', 'localhost', 'https:'],
  ]) {
    const h = harness(...args);
    assert.equal(h.localRtcFixtureAllowed(), false, JSON.stringify(args));
    await h.preloadVideoSdk();
    assert.deepEqual(h.calls, ['agora-rtc-sdk-ng']);
  }
});
