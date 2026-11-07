'use strict';
// Exercise the real menu renderer with a small DOM and a live media query.
// Browser geometry coverage lives in howto-browser.cjs (optional Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this.text = ''; this.hidden = false; }
  get id() { return this.attrs.id; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = value; if (key === 'hidden') this.hidden = true; if (key === 'value') this.value = value; }
  getAttribute(key) { return this.attrs[key]; }
  get classList() { return { toggle: (name, on) => { const names = new Set(this.className.split(' ').filter(Boolean)); on ? names.add(name) : names.delete(name); this.className = [...names].join(' '); }, contains: name => this.className.split(' ').includes(name) }; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  append(...items) { for (const item of items) { item.remove(); item.parent = this; this.children.push(item); } }
  appendChild(item) { this.append(item); }
  prepend(item) { item.remove(); item.parent = this; this.children.unshift(item); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  replaceChildren(...items) { for (const child of [...this.children]) child.remove(); this.text = ''; this.append(...items); }
  contains(item) { return this === item || this.children.some(c => c.contains(item)); }
  get firstChild() { return this.children[0]; }
  set innerHTML(html) {
    this.replaceChildren();
    const stack = [this];
    for (const match of html.matchAll(/<\/(\w+)>|<(\w+)([^>]*)>|([^<]+)/g)) {
      if (match[1]) { stack.pop(); continue; }
      if (match[4]) { stack.at(-1).text += match[4]; continue; }
      const child = new Element(match[2]);
      for (const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(attr[1], attr[2] ?? '');
      stack.at(-1).append(child);
      if (!['img', 'input', 'path'].includes(match[2]) && !match[3].endsWith('/')) stack.push(child);
    }
  }
  matches(selector) {
    if (selector[0] === '#') return this.id === selector.slice(1);
    if (selector[0] === '.') return this.classList.contains(selector.slice(1));
    const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    return attr ? attr[1] in this.attrs && (attr[2] === undefined || this.attrs[attr[1]] === attr[2]) : this.tagName === selector;
  }
  querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { document.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
const media = { matches: true, listeners: new Set(), addEventListener(_, fn) { this.listeners.add(fn); }, removeEventListener(_, fn) { this.listeners.delete(fn); } };
const document = { body: new Element('body'), activeElement: null, createElement: tag => new Element(tag), contains: item => document.body.contains(item), querySelector: s => document.body.querySelector(s), getElementById: id => document.body.querySelector('#' + id), addEventListener() {}, removeEventListener() {} };
const source = fs.readFileSync(require.resolve('../public/js/howto.js'), 'utf8');
const context = { document, window: { matchMedia: query => { assert.equal(query, '(min-width: 860px)'); return media; } }, closeCustomizer() {} };
vm.runInNewContext(source.replace(/^import .*;\n/m, '').replace(/export /g, '') + '\nglobalThis.api = { openHowto, refreshHowto, closeHowto };', context);
const css = fs.readFileSync(require.resolve('../public/css/howto-menu.css'), 'utf8');
const opener = new Element('button'); document.body.append(opener);
let clicks = 0;
const game = require('../games/registry').list().find(g => g.id === 'pocket-karts');
context.api.openHowto({ game, opener, meta: { seats: '2–32 players', vibe: 'Arcade' }, buildFooter: () => ({
  html: '<label class="howto-name"><input id="howtoName" value="Old name"></label><button id="howtoGo">Create room</button><button id="bKartGarage">Your kart</button><input id="roomCode"><button id="joinRoom">Join room</button><p class="howto-note">Invite friends.</p>',
  wire(foot) { foot.querySelector('#howtoGo').onclick = () => { clicks++; }; foot.querySelector('#joinRoom').onclick = () => { clicks++; }; },
}) });
const dialog = document.querySelector('.howto-dlg');
const main = dialog.querySelector('.howto-main');
const scroll = dialog.querySelector('.howto-seat-scroll');
const foot = dialog.querySelector('[data-howto-foot]');
const actions = dialog.querySelector('.howto-actions');
assert(dialog.classList.contains('howto-two-column'), 'desktop gets the two-column class');
assert.equal(main.parent, dialog.querySelector('.howto-layout'), 'desktop guide is beside the seat');
assert.equal(foot.contains(actions), true, 'CTA stays inside the footer contract');
assert.equal(actions.querySelector('#howtoGo').textContent, 'Create room');
assert.equal(scroll.contains(actions), false, 'primary action is outside the content scroller');
assert.equal(dialog.querySelectorAll('.howto-controls').length, 1);
assert.equal(dialog.getAttribute('data-family'), 'arcade', 'menu uses the game family');
assert.match(css, /\.howto-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--howto-seat-w\)/s, 'desktop CSS gives the guide and seat their own columns');
assert.equal(document.activeElement.id, 'howtoClose', 'opening explicitly focuses Close');

const rules = dialog.querySelector('#howtoRulesTab');
rules.onkeydown({ key: 'End', preventDefault() {} });
assert.equal(rules.getAttribute('aria-selected'), 'true');
assert.equal(dialog.querySelector('#howtoRulesPanel').hidden, false);
media.matches = false; for (const listener of media.listeners) listener();
assert(dialog.classList.contains('howto-sheet'), 'phone gets the sheet class');
assert.equal(main.parent, scroll, 'header, tabs and seat fields share one phone scroller');
assert.equal(document.activeElement, rules, 'resizing preserves focus on the live tab');
assert.equal(rules.getAttribute('aria-selected'), 'true', 'resizing preserves selected tab');
assert.equal(scroll.contains(actions), false, 'phone action bar never scrolls with content');
assert.match(css, /@media \(width < 860px\)/, 'CSS and responsive DOM use the same breakpoint');
assert.match(css, /dialog\.howto-start\s*\{[^}]*position:\s*fixed;[^}]*box-sizing:\s*border-box;[^}]*width:\s*calc\(100dvw - env\(safe-area-inset-left\) - env\(safe-area-inset-right\)\)/s, 'phone sheet is bounded by viewport width including its border');
assert.match(css, /dialog\.howto-start\s*\{[^}]*height:\s*calc\(100dvh[^}]*margin:\s*0;/s, 'phone sheet uses dynamic viewport height without native dialog margins');
assert.match(css, /inset:\s*calc\(var\(--space-24\) \+ env\(safe-area-inset-top\)\) env\(safe-area-inset-right\) auto env\(safe-area-inset-left\)/, 'phone sheet top plus height is bounded by 100dvh');
assert.match(css, /\.howto-dlg \.howto-actions\s*\{[^}]*position:\s*sticky;\s*bottom:\s*0/s, 'phone keeps a sticky bottom action bar');
assert.match(css, /\.howto-start \.howto-panels\s*\{[^}]*overflow:\s*visible/s, 'no nested rules scroll on phone');
assert.match(css, /\.howto-start \.howto-actions::before[^}]*linear-gradient/s, 'phone bar has a soft fade');

const name = foot.querySelector('#howtoName'); name.value = 'Draft name'; name.setSelectionRange(2, 6); name.focus(); scroll.scrollTop = 120;
context.api.refreshHowto();
assert.equal(document.activeElement.id, 'howtoName', 'refresh restores field focus');
assert.equal(document.activeElement.value, 'Draft name', 'refresh keeps the draft');
assert.equal(document.activeElement.selectionStart, 2, 'refresh keeps the text selection');
assert.equal(actions.querySelector('.howto-note').textContent, 'Invite friends.', 'reason stays beside the pinned action');
assert.equal(scroll.scrollTop, 120, 'refresh keeps the scroll position');
assert.equal(dialog.querySelector('.howto-main'), main, 'refresh keeps the live guide mounted');
foot.querySelector('#howtoGo').onclick(); foot.querySelector('#joinRoom').onclick();
assert.equal(clicks, 2, 'primary and join handlers survive layout and refresh');
assert(foot.querySelector('#roomCode') && foot.querySelector('#bKartGarage'), 'optional fields and garage remain in the seat');
foot.querySelector('#howtoGo').focus(); context.api.refreshHowto();
assert.equal(document.activeElement.id, 'howtoGo', 'refresh keeps focus on the pinned primary');
media.matches = true; for (const listener of media.listeners) listener();
assert.equal(main.parent, dialog.querySelector('.howto-layout'), 'returning to desktop restores the guide column');
assert.equal(dialog.querySelectorAll('#howtoPlayTab').length, 1, 'resize never duplicates IDs');
context.api.closeHowto();
assert.equal(media.listeners.size, 0, 'closing removes the responsive listener');
assert.equal(document.activeElement, opener, 'closing returns focus');
console.log('HOWTO_LAYOUT_PASS: desktop columns, phone scroller and sticky actions, live resize, tabs, footer refresh and handlers');
