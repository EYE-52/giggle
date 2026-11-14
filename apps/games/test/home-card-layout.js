'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const howto = fs.readFileSync(require.resolve('../public/js/howto.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../public/css/home-polish.css'), 'utf8');
const baseCss = fs.readFileSync(require.resolve('../public/css/style.css'), 'utf8');
const declaration = (source, name) => {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' exists');
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const context = { playedIds: () => [], uiIcon: () => '<svg></svg>', esc: value => String(value).replace(/[&<>"']/g, '_'), catLabel: value => value, seatsLine: g => g.players,
  artImg: (g, cls) => `<img class="${cls}" data-art="${g.id}">` };
vm.createContext(context);
vm.runInContext([declaration(howto, 'controlFamily'), declaration(app, 'gameChoiceHtml'), declaration(app, 'pickHtml'), declaration(app, 'catalogRowHtml'), declaration(app, 'cardHtml'),
  app.match(/const PRACTICE_TILE = `[\s\S]*?`;/)[0], 'globalThis.practice = PRACTICE_TILE;'].join('\n'), context);

// Parse the rendered wrappers, not a second copy of the card templates.
function tree(html) {
  const root = { children: [] }, stack = [root];
  for (const match of html.matchAll(/<\/(\w+)>|<(\w+)([^>]*)>/g)) {
    if (match[1]) { stack.pop(); continue; }
    const attrs = Object.fromEntries([...match[3].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    const node = { tag: match[2], attrs, children: [] };
    stack.at(-1).children.push(node);
    if (match[2] !== 'img') stack.push(node);
  }
  return root.children[0];
}
const hasClass = (node, name) => node.attrs.class?.split(' ').includes(name);
for (const game of require('../games/registry').list()) {
  for (const [variant, html] of [['featured', context.pickHtml(game, 0)], ['pick', context.pickHtml(game, 1)], ['catalogue', context.catalogRowHtml(game)], ['room', context.cardHtml(game)]]) {
    const card = tree(html), [art, copy] = card.children;
    assert.equal(card.tag, 'button', variant + ' stays one button');
    assert.equal(card.attrs['data-how'], game.id, 'game handler ID is unchanged');
    assert.equal(card.attrs['aria-haspopup'], 'dialog');
    assert(hasClass(card, 'card-open') && hasClass(card, 'home-game-card'));
    assert(hasClass(art, 'home-card-art') && hasClass(copy, 'home-card-copy'), game.id + ' shares art and copy wrappers');
    assert.equal(art.children[0].attrs['data-art'], game.id);
    assert.equal(art.children.length, 1, 'art is unobstructed');
    const copyClasses = ['t', 'd', 'p'];
    if (game.communication === 'voice' || game.communication === 'video') {
      copyClasses.push('communication-hint');
      const label = game.communication === 'video' ? 'Video' : 'Voice';
      assert(html.includes(`${label} call needed for online play`), 'required call type is clear');
    }
    assert.deepEqual(copy.children.map(node => node.attrs.class), copyClasses, 'game details and call requirements stay together');
    assert.equal(card.children.length, 2, 'no loose badge or action can form an extra grid row');
  }
}
const practice = tree(context.practice);
assert.equal(practice.tag, 'a'); assert.equal(practice.attrs.href, '/practice/');
assert(hasClass(practice.children[0], 'home-card-art') && hasClass(practice.children[1], 'home-card-copy'), 'practice shares the same layout');
assert.deepEqual(practice.children[1].children.map(node => node.attrs.class), ['t', 'd']);
assert.doesNotMatch(css, /grid-template-rows:\s*auto auto 1fr auto/, 'old stretched card rows are removed');
assert.match(baseCss, /\.catbar select\.picker-native\s*\{[^}]*width:\s*1px;[^}]*min-width:\s*0/s, 'hidden native filters cannot expand the phone viewport');
console.log('HOME_CARD_LAYOUT_PASS: all catalogue variants, unobstructed artwork, compact text, unchanged card handlers and practice link');
