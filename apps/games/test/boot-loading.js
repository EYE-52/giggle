'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/boot-status.js'), 'utf8');

function fixture({ connected = true, pending = true } = {}) {
  const attributes = new Map(pending ? [['data-app-boot', ''], ['role', 'status'], ['aria-busy', 'true']] : []);
  const title = { textContent: 'Getting the games ready…' }, description = { textContent: 'Opening the game shelf.' }, mark = { hidden: false };
  const boot = {
    isConnected: connected,
    hasAttribute: key => attributes.has(key),
    removeAttribute: key => attributes.delete(key),
    setAttribute: (key, value) => attributes.set(key, value),
    querySelector: selector => ({ '[data-boot-title]': title, '[data-boot-description]': description, '.loading-mark': mark }[selector]),
  };
  let callback, delay;
  vm.runInNewContext(source, { document: { querySelector: () => boot }, setTimeout: (fn, ms) => { callback = fn; delay = ms; } });
  return { attributes, title, description, mark, callback, delay };
}
{
  const f = fixture();
  assert.equal(f.delay, 12000, 'watchdog deadline remains bounded at12 seconds');
  assert.equal(f.attributes.get('aria-busy'), 'true');
  assert.equal(f.mark.hidden, false);
  f.callback();
  assert.equal(f.attributes.has('data-app-boot'), false);
  assert.equal(f.attributes.get('data-boot-state'), 'error');
  assert.equal(f.attributes.get('role'), 'alert');
  assert.equal(f.attributes.get('aria-busy'), 'false');
  assert.equal(f.title.textContent, 'Taking longer than expected');
  assert.match(f.description.textContent, /reload/);
  assert.equal(f.mark.hidden, true, 'failed work stops the decorative animation');
}
for (const options of [{ connected: false }, { pending: false }]) {
  const f = fixture(options), before = [...f.attributes];
  f.callback();
  assert.deepEqual([...f.attributes], before, 'settled/replaced content must never be overwritten by the old timer');
  assert.equal(f.title.textContent, 'Getting the games ready…');
  assert.equal(f.mark.hidden, false);
}
console.log('BOOT_LOADING_PASS: pending,12s failure,stopped artwork,settled/replaced guard;no readiness delay');
