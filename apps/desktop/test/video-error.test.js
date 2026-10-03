const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/videoError.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
new Function('exports', compiled)(exported);
test('device notices explain recovery without exposing SDK error details', () => {
  const describe = exported.describeVideoError;
  assert.match(describe({ code: 'DEVICE_NOT_FOUND', message: 'AgoraRTCError private detail' }), /Connect a device/);
  assert.match(describe({ name: 'NotAllowedError', message: 'Access failed' }), /browser permissions/);
  assert.match(describe({ name: 'NotFoundError', message: 'Capture failed' }), /Connect a device/);
  assert.match(describe({ message: 'NotReadableError: hardware busy' }), /Another app/);
  assert.match(describe({ code: 'AGORA_NOT_CONFIGURED' }), /isn't available/);
  assert.equal(describe(new Error('SDK internals')), "Couldn't connect video. You can still use chat.");
  assert.equal(describe(null), describe(new Error('SDK internals')));
});
