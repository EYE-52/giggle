'use strict';
/* Phone-touch contracts for the Muse-owned skill games: no unwanted
 * autofocus on mount, phone keyboard attributes on every text input,
 * visible touch controls for required actions (chess tap-to-move +
 * promotion, countdown tile editing). Run: node test/skill-scenes-touch-muse.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gameSrc = (g) => fs.readFileSync(path.join(ROOT, 'public/js/games', `${g}.js`), 'utf8');
const focusCount = (src) => (src.match(/\.focus\(/g) || []).length;

let n = 0;
const ok = (msg) => { n += 1; console.log(`ok ${n} - ${msg}`); };

// 1. No autofocus on mount: these views must never steal focus (and pop the
// phone keyboard) before the player taps. Zero element-focus calls.
for (const g of ['memory-tray', 'word-chain', 'countdown-word', 'typing-race',
  'twenty-questions', 'reaction-tap', 'pose-party', 'show-and-go']) {
  assert.strictEqual(focusCount(gameSrc(g)), 0, `${g} has no .focus() on mount`);
}
ok('mount is focus-free: memory/countdown/word-chain/typing/twenty/reaction/camera');

// 2. Focus only as a direct answer to a player tap: one call each, placed
// after its send/navigate handler (keyboard stays open for the next entry,
// or moves to the next field — never opens uninvited).
for (const [g, anchor] of [['charades', 'const send'], ['number-hunt', 'const send'],
  ['warm-words', 'form.onsubmit'], ['scattergories', 'onkeydown']]) {
  const src = gameSrc(g);
  assert.strictEqual(focusCount(src), 1, `${g} focuses exactly once`);
  assert(src.indexOf('.focus(') > src.indexOf(anchor), `${g} focuses inside its ${anchor} handler`);
}
ok('charades/number-hunt/warm-words/scattergories focus only after a tap');

// 3. Phone keyboard attributes on every owned text input.
const inputs = {
  charades: ['enterkeyhint="send"', 'autocapitalize="off"', 'inputmode="text"', 'autocorrect="off"'],
  'countdown-word': ['enterkeyhint="go"', 'autocapitalize="characters"', 'inputmode="text"', 'autocorrect="off"'],
  'memory-tray': ['enterkeyhint="send"', 'autocapitalize="off"', 'inputmode="text"'],
  'number-hunt': ['type="number"', 'inputmode="numeric"', 'enterkeyhint="go"'],
  scattergories: ['enterkeyhint="${', "'next'", "'done'", 'autocapitalize="words"', 'inputmode="text"'],
  'twenty-questions': ['enterkeyhint="send"', 'autocapitalize="sentences"', 'autocapitalize="off"', 'inputmode="text"'],
  'typing-race': ['enterkeyhint="done"', 'autocapitalize="off"', 'autocorrect="off"', 'inputmode="text"'],
  'warm-words': ['enterkeyhint="go"', 'autocapitalize="off"', 'inputmode="text"'],
  'word-chain': ['enterkeyhint="go"', 'autocapitalize="off"', 'inputmode="text"'],
};
for (const [g, attrs] of Object.entries(inputs)) {
  const src = gameSrc(g);
  for (const a of attrs) assert(src.includes(a), `${g} input carries ${a}`);
}
ok('all 9 text inputs carry enterkeyhint/autocapitalize/inputmode');

// 4. Countdown builds words by touch alone: tiles append without opening the
// keyboard (see focus-free above) and visible buttons edit the draft.
{
  const src = gameSrc('countdown-word');
  assert(src.includes('id="cwBack"'), 'countdown has a touch backspace button');
  assert(src.includes('id="cwClear"'), 'countdown has a touch clear button');
  assert(src.includes('slice(0, -1)'), 'backspace drops the last letter');
  assert(src.includes('data-tile'), 'letter tiles stay tappable buttons');
}
ok('countdown: tappable tiles plus backspace/clear touch editing');

// 5. Chess is fully tappable: piece→legal-target squares, an explicit
// promotion chooser, and 44px pill buttons (never text links) for
// promotion cancel, flip, and resign.
{
  const src = gameSrc('chess');
  assert(src.includes('data-sq'), 'chess renders tappable squares');
  assert(src.includes('data-promo'), 'chess promotion chooser renders');
  assert(src.includes('class="btn ghost" data-promo-x'), 'promotion cancel is a 44px pill');
  assert(src.includes('class="btn ghost" id="ch-flip"'), 'flip is a 44px pill');
  assert(src.includes('class="btn ghost" id="ch-resign"'), 'resign is a 44px pill');
  assert(!src.includes('howto-btn'), 'chess keeps no text-link controls');
}
ok('chess: tap-to-move squares, promotion chooser, 44px flip/resign/cancel');

// 6. Scattergories phone flow: Enter moves through the five fields and the
// last field saves without a keyboard-dependent submit.
{
  const src = gameSrc('scattergories');
  assert(src.includes('next.focus()'), 'Enter advances to the next field');
  assert(src.includes("api.send({ answers: collect() })"), 'last-field Enter saves');
}
ok('scattergories: Enter walks the fields, last Enter saves');


console.log(`TOUCH MUSE PASS: ${n} checks across 13 owned games`);
