'use strict';
/* Custom-games mobile regressions: Chain Reaction, Pocket Karts, Castle Clash.
 * Static contracts over game-owned CSS/JS plus geometry budgets derived from
 * the declared constants. No browser needed. Run with:
 *   node test/custom-mobile.js
 * Fails before the 2026-10-07 bounded mobile fixes, passes after. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function run() {
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const chainRenderer = read('public/js/games/chain-reaction.js');
const chainFrameCss = read('games/chain-reaction/browser/play.css');
const kartCss = read('public/css/kart-arena.css');
const kartView = read('public/js/engines/kart-view.js');
const kartShared = read('public/css/style.css'); // read-only evidence, never edited here
const castleInline = read('public/js/games/castle-clash.js');
const castleImmersive = read('public/css/castle-immersive.css');

/* ---- Chain Reaction: real Canvas well geometry, logical touch indices. */
{
  const { layoutBoard } = await import('../public/js/renderers/chain-scene.mjs');
  for (const [width, height] of [[320, 640], [390, 844], [568, 320], [844, 390]]) {
    for (const [cols, rows] of [[5, 6], [6, 8]]) {
      const landscape = width >= 560 && height <= 500;
      const transposed = landscape && cols === 6 && rows === 8;
      const visualCols = transposed ? rows : cols, visualRows = transposed ? cols : rows;
      const availableWidth = width - (landscape ? 152 : 20);
      const fieldWidth = Math.min(availableWidth, (height - (landscape ? 16 : 150)) * visualCols / visualRows);
      const fieldHeight = fieldWidth * visualRows / visualCols;
      const layout = layoutBoard(cols, rows, fieldWidth, fieldHeight, { transpose: landscape });
      assert(layout.cell >= 44, `touch well at ${width}×${height} is below 44px`);
      assert.equal(layout.centers.length, cols * rows, 'transpose preserves every logical cell');
      assert(layout.centers.every(p => p.x >= 0 && p.x <= fieldWidth && p.y >= 0 && p.y <= fieldHeight), 'all Canvas wells remain inside the field');
    }
  }
  assert(chainRenderer.includes('touch-action:manipulation'), 'semantic wells accept taps without swallowing all page gestures');
  assert(chainFrameCss.includes('env(safe-area-inset-top'), 'frame clears the phone inset');
  console.log('CUSTOM chain: portrait/landscape Canvas geometry, 44px targets and logical indices verified');
}

/* ---- Pocket Karts: edge HUD must clear safe-area top/sides, not just bottom.
 * The folded board now lives inside the safe-area-aware status strip rather
 * than being positioned as a second independent panel. Result/Garage
 * scroll comes from shared .pk-result overflow:auto (read-only evidence). */
{
  const strip = (kartCss.match(/\.pk \.pk-racestrip \{[^}]*\}/) || [])[0] || '';
  assert(strip.includes('env(safe-area-inset-top'), 'kart strip base clears the top inset');
  assert(strip.includes('env(safe-area-inset-right'), 'kart strip base clears the right inset');
  for (const rule of kartCss.matchAll(/\.pk \.pk-racestrip \{([^}]*)\}/g)) {
    if (rule[1].includes('left:')) assert(rule[1].includes('env(safe-area-inset-left'), 'every kart strip offset follows the left notch and Room launcher');
  }
  const board = (kartCss.match(/\.pk \.pk-board \{[^}]*\}/) || [])[0] || '';
  assert(board.includes('position:static'), 'folded board follows its status parent');
  assert(/class="pk-top pk-racestrip"[\s\S]*?class="pk-status"[\s\S]*?class="pk-board"/.test(kartView),
    'board is nested inside the inset-aware status strip');
  assert(!/\.pk \.pk-status\s*\{\s*right:/.test(kartCss),
    'dead .pk-status right rule is gone (flex child, never positioned)');
  // Every media override that re-anchors the strip/board must stay inset-aware.
  const blocks = kartCss.split('@media');
  for (const b of blocks.slice(1)) {
    if (/\.pk \.pk-racestrip\s*\{[^}]*\btop:/.test(b)) {
      assert(b.includes('env(safe-area-inset-top'), `media "${b.slice(0, 60).trim()}…" strip top stays inset-aware`);
    }
    if (/\.pk \.pk-board\s*\{[^}]*\btop:/.test(b)) {
      assert(b.includes('env(safe-area-inset-top'), `media "${b.slice(0, 60).trim()}…" board top follows the strip`);
    }
  }
  // Read-only evidence: the scroll path for result/Garage lives in shared CSS.
  const sharedResult = (kartShared.match(/\.pk-result \{[^}]*\}/) || [])[0] || '';
  assert(sharedResult.includes('overflow: auto') || sharedResult.includes('overflow:auto'),
    'shared .pk-result keeps overflow:auto so Garage scrolls in short landscape');
  assert(!/\.pk \.pk-result\s*\{[^}]*overflow\s*:\s*(hidden|visible|clip)/.test(kartCss),
    'kart-arena never overrides result overflow to a non-scrolling value');
  // Touch targets stay >=44px at the smallest declared sizes.
  assert(/#pk-tg,\.pk #pk-td \{[^}]*width:44px/.test(kartCss), 'gas/brake keep 44px at 320px height');
  const shortStick = kartCss.slice(kartCss.indexOf('@media (max-height:360px)'))
    .match(/\.pk \.pk-stick \{[^}]*width:(\d+)px/);
  assert(shortStick && Number(shortStick[1]) >= 88, 'stick keeps at least 88px at 320px height');
  assert(kartCss.includes('.pk .pk-upgrade button') && kartCss.includes('min-height:44px'),
    'garage upgrade buttons keep 44px targets');
  assert(kartCss.includes('100dvh - var(--pk-result-top) - 104px - env(safe-area-inset-bottom,0px)'),
    'short-landscape results reserve the Rematch bar, bottom inset and a gap');
  assert(kartCss.includes('.pk .pk-helpbody { left:108px; max-height:calc(100dvh - 212px'),
    'short-landscape help clears the Room target and has a bounded scroll area');
  const rematchHeight = 66, bottom = 28, gap = 10;
  for (const [height, topInset, bottomInset] of [[320, 0, 0], [390, 0, 21], [320, 47, 21]]) {
    const resultTop = Math.max(60, 52 + topInset), resultHeight = height - resultTop - 104 - bottomInset;
    assert(resultHeight > 44, 'garage keeps room for a tappable row on a short screen');
    assert(resultTop + resultHeight <= height - bottom - bottomInset - rematchHeight - gap,
      'garage and Rematch do not overlap, including notch insets');
  }
  console.log('CUSTOM karts: safe-area strip/board, result scroll path, >=44px targets verified');
}

/* ---- Castle block siege: game-owned cards and bounded overlays. */
{
  assert(/\.bs-hand\{[^}]*overflow-x:auto/.test(castleImmersive), 'finite card hand scrolls horizontally');
  assert(/\.bs-game button,\.bs-game summary\{[^}]*min-height:44px[^}]*min-width:44px/.test(castleImmersive), 'all Castle actions keep 44px targets');
  assert(/\.bs-result>div\{[^}]*max-height:[^}]*overflow:auto/.test(castleImmersive), 'results fit and scroll inside short landscape');
  assert(castleImmersive.includes('env(safe-area-inset-top') && castleImmersive.includes('env(safe-area-inset-bottom'), 'top and card hand clear phone insets');
  assert(castleImmersive.includes('.bs-help>div') && castleImmersive.includes('overflow:auto'), 'help has a bounded scroll path');
  assert(castleInline.includes('readInputCapabilities') && castleInline.includes('!S.spectator'), 'keyboard/touch capability and spectator guard remain explicit');
  console.log('CUSTOM castle: finite card hand, 44px controls, bounded help/results and phone insets verified');
}

console.log('CUSTOM_MOBILE_PASS');

}
run().catch(error => { console.error(error); process.exitCode = 1; });
