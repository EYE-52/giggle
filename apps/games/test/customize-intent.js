/* Deferred customize intent: pure decisions + one-shot pending slot. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/pending-customize.js'), 'utf8');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-')), 'pending-customize.mjs');
  fs.writeFileSync(tmp, src);
  const m = await import(tmp);
  const { decideCustomizeIntent, setPendingCustomize, peekPendingCustomize, takePendingCustomize } = m;

  // Games without schema never route anywhere.
  assert.deepStrictEqual(
    decideCustomizeIntent({ inRoom: false, name: 'Pippa', gameId: 'chess', customizable: false }),
    { action: 'none' });
  assert.deepStrictEqual(
    decideCustomizeIntent({ inRoom: false, name: 'Pippa', gameId: '', customizable: true }),
    { action: 'none' });

  // In a room: open the dialog directly (host/guest gating stays downstream).
  assert.deepStrictEqual(
    decideCustomizeIntent({ inRoom: true, name: '', gameId: 'rapid-polls', customizable: true }),
    { action: 'open', gameId: 'rapid-polls' });

  // On home with no name: focus the ticket field first.
  assert.deepStrictEqual(
    decideCustomizeIntent({ inRoom: false, name: '   ', gameId: 'rapid-polls', customizable: true }),
    { action: 'name-needed', gameId: 'rapid-polls' });

  // On home with a name: create, then open the chosen game (never start).
  const d = decideCustomizeIntent({ inRoom: false, name: '  Pippa ', gameId: 'rapid-polls', customizable: true });
  assert.deepStrictEqual(d, { action: 'create', name: 'Pippa', gameId: 'rapid-polls' });

  // One-shot pending slot: first room snapshot consumes it.
  assert.strictEqual(peekPendingCustomize(), null);
  setPendingCustomize('rapid-polls');
  assert.strictEqual(peekPendingCustomize(), 'rapid-polls');
  assert.strictEqual(takePendingCustomize(), 'rapid-polls');
  assert.strictEqual(takePendingCustomize(), null);

  console.log('CUSTOMIZE-INTENT ok: none/open/name-needed/create + one-shot pending');
})();
