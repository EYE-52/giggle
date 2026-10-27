'use strict';
// Mounted-client/asset contract only. Actual geometry is separately measured in
// the native shipping-client packet; this DOM stub does not apply CSS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDocument, surface } = require('./party-mobile');
const root = path.resolve(__dirname, '..');
const moduleUrl = src => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
(async () => {
  const util = moduleUrl(fs.readFileSync(path.join(root, 'public/js/util.js'), 'utf8'));
  const ui = (await import(moduleUrl(fs.readFileSync(path.join(root, 'public/js/games/pick-one.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
  assert.deepEqual(ui.styles, ['/css/party-scenes.css', '/css/pick-one.css'], 'host readiness waits for the game override after shared styles');
  for (const asset of ui.styles) assert(fs.statSync(path.join(root, 'public', asset)).isFile());
  const oldDoc = global.document;
  global.document = makeDocument();
  try {
    const long = 'A full supported label <not markup> '.repeat(12);
    for (const role of ['open', 'locked', 'watch']) {
      ui.dispose();
      const el = surface(global.document);
      const sent = [];
      ui.render(el, {phase:'vote', instanceId:'compact', round:1, rounds:3, players:[{id:'p1',name:'One'},{id:'p2',name:'Two'},{id:'p3',name:'Three'}], me:role==='watch'?'watch':'p1', spectator:role==='watch', myVote:role==='locked'?'a':null, voted:[], prompt:{a:long,b:'Other label'}, endsAt:10000}, {send:a=>sent.push(a)});
      assert(el.innerHTML.includes('data-state="'+role+'"'));
      assert(el.textContent.includes(long.trim()), 'full label retained without truncation');
      assert(!el.querySelector('not'), 'label cannot create markup');
      const buttons = el.querySelectorAll('[data-v]');
      assert.equal(buttons.length, 2);
      assert.equal(buttons[0].disabled, role !== 'open');
      if (role === 'open') { buttons[0].onclick(); assert.deepEqual(sent,[{vote:'a'}]); }
    }
    console.log('Pick One compact asset and mounted-client contract passed');
  } finally { ui.dispose(); global.document = oldDoc; }
})().catch(e => { console.error(e); process.exitCode=1; });
