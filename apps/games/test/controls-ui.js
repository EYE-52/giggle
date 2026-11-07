'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const howto = fs.readFileSync(require.resolve('../public/js/howto.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../public/css/howto-menu.css'), 'utf8');

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.attrs = {}; this.open = false; this.className = ''; this.textContent = ''; }
  set innerHTML(value) { this.html = value; this.title = new Element('p'); this.button = new Element('button'); }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.append(item); item.parent = this; }
  contains(item) { return this.children.includes(item); }
  remove() { this.removed = true; }
  close() { this.open = false; }
  showModal() { this.open = true; }
  focus() { document.activeElement = this; }
  querySelector(s) { return s === '.howto-tag' ? this.title : s === '#howtoClose' ? this.button : null; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
const docEvents = {};
const document = { body: new Element('body'), fullscreenElement: null, activeElement: null, createElement: tag => new Element(tag), contains: el => !el.removed,
  addEventListener: (type, fn) => { docEvents[type] = fn; }, removeEventListener: type => { delete docEvents[type]; }, dispatchEvent: e => { document.dispatched = e.type; }, querySelector: () => null };
const context = { document, Event, closeCustomizer() {} };
vm.createContext(context);
vm.runInContext(howto.replace(/^import .*?;\n/m, '').replace(/export /g, '') + '\nglobalThis.api = { openControls, closeHowto, isHowtoOpen, refreshHowto };', context);
const game = { id: 'karts', name: 'Karts', guide: { goal: 'Win.', controls: [{ keys: ['Shift'], touch: 'Drift', does: 'Drift safely' }] } };
const opener = new Element('button');
const fullscreen = new Element('main'); document.fullscreenElement = fullscreen;
context.api.openControls({ game, opener });
let sheet = fullscreen.children.at(-1);
assert.equal(sheet.open, true, 'sheet opens inside fullscreen element');
assert.equal(document.dispatched, 'game-screenchange', 'opening releases game input');
assert.equal(sheet.children[0].children[1].children[0].children[2].textContent, 'Drift safely', 'sheet renders manifest controls');
assert.equal(document.activeElement, sheet.button, 'close button receives focus');
context.api.refreshHowto();
let stopped = false; sheet.listeners.keydown({ stopPropagation() { stopped = true; } }); assert(stopped, 'modal keys do not reach the game');
sheet.listeners.cancel({ preventDefault() {} });
assert.equal(context.api.isHowtoOpen(), false); assert.equal(document.activeElement, opener, 'Escape returns focus');
context.api.openControls({ game, opener }); sheet = fullscreen.children.at(-1); sheet.listeners.click({ target: sheet });
assert.equal(document.activeElement, opener, 'scrim returns focus'); assert.equal(context.api.isHowtoOpen(), false);
context.api.openControls({ game, opener }); sheet = fullscreen.children.at(-1); sheet.button.onclick();
assert.equal(document.activeElement, opener, 'close button returns focus');
const html = new Element('html'); html.append(document.body); document.fullscreenElement = html;
context.api.openControls({ game, opener });
assert.equal(document.body.children.at(-1).open, true, 'document fullscreen keeps the sheet inside the themed body');
context.api.closeHowto();

const start = app.indexOf("document.addEventListener('keydown', (e) => {\n  const menu = document.getElementById('roomMenu');");
const end = app.indexOf('\n});', start);
assert(start >= 0 && end > start);
let handler, clicks = 0;
const menu = { open: false };
const shortcutContext = { document: { addEventListener: (_, fn) => { handler = fn; }, getElementById: id => id === 'roomMenu' ? menu : { click: () => clicks++ }, querySelector: () => null }, gameId: 'karts', lastState: {}, isCustomizerOpen: () => false, isHowtoOpen: () => false, isReportOpen: () => false };
vm.runInNewContext(app.slice(start, end + 4), shortcutContext);
const press = (overrides = {}) => handler({ key: '?', target: { closest: () => null }, preventDefault() {}, ...overrides });
press(); assert.equal(clicks, 1); assert(menu.open, 'shortcut opens menu before sheet');
press({ target: { closest: () => ({}) } }); press({ ctrlKey: true }); press({ repeat: true }); press({ isComposing: true });
assert.equal(clicks, 1, 'shortcut ignores text input, modified keys, repeats and composition');
assert(app.includes('id="bControls"')); assert(app.includes('!isHowtoOpen() && !menu.contains(e.target)'));
assert.match(css, /overflow-y:\s*auto;\s*overscroll-behavior:\s*contain/);
assert.match(css, /#howtoPlayPanel, \.howto-body\)\s*\{[^}]*overflow:\s*visible/s);
console.log('CONTROLS_UI_PASS: manifest sheet, fullscreen, focus and dismissals, shortcut and single scroll');
