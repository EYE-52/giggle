const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CHARACTER_DEFAULTS, CHARACTER_OPTIONS, encodeCharacter, parseCharacter, validateCharacter } = require('../src/utils/characterConfig');

test('character config round trips all wardrobe combinations without unknown values', () => {
  for (const clothing of CHARACTER_OPTIONS.clothing) for (const headwear of CHARACTER_OPTIONS.headwear) for (const earrings of CHARACTER_OPTIONS.earrings) {
    const config = { ...CHARACTER_DEFAULTS, clothing, headwear, earrings };
    assert.deepEqual(parseCharacter(encodeCharacter(config)), config);
  }
});
test('untrusted character config rejects markup, unsupported versions and invalid controls', () => {
  for (const input of [null, [], { hair: 'unknown' }, { eyeSize: 101 }, { faceWidth: -1 }, { noseSize: NaN }, { mouthWidth: 1.5 }, { skin: 'url(https://example.com)' }, { animated: 'true' }, { dangerouslySetInnerHTML: {} }, { __proto__: null, unknown: true }]) assert.equal(validateCharacter(input), null);
  assert.equal(parseCharacter('giggle:v2:{}'), null);
  assert.equal(parseCharacter('giggle:v1:{broken'), null);
  assert.equal(parseCharacter('giggle:v1:' + ' '.repeat(1500)), null);
  assert.equal(parseCharacter('giggle:v1:{"__proto__":{}}'), null);
  assert.deepEqual(parseCharacter('giggle:v1:{}'), CHARACTER_DEFAULTS);
});
