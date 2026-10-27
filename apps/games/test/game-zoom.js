'use strict';
/* Game size control helpers (public/js/zoom.js): steps, auto default for
 * small frames, stored choice wins, which games zoom, control markup. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
(async () => {
  const z = await import(data(fs.readFileSync(path.join(__dirname, '../public/js/zoom.js'), 'utf8')));
  eq(z.ZOOM_STEPS, [0.8, 0.9, 1, 1.15, 1.3], 'steps');
  eq([z.autoZoom(980, 820), z.autoZoom(600, 500), z.autoZoom(390, 780), z.autoZoom(380, 560), z.autoZoom(900, 440)], [1, 0.8, 0.9, 0.8, 0.8], 'small frames start smaller');
  eq([z.stepZoom(1, 1), z.stepZoom(1, -1), z.stepZoom(1.3, 1), z.stepZoom(0.8, -1), z.stepZoom(1.12, 1)], [1.15, 0.9, 1.3, 0.8, 1.3], 'steps stop at the ends');
  const store = (v) => ({ get: () => v });
  eq(z.currentZoom(store('1.15'), 390, 780), 1.15, 'stored choice wins over auto');
  eq(z.currentZoom(store(''), 390, 780), 0.9, 'auto without a choice');
  eq(z.currentZoom(store('7'), 980, 820), 1, 'invalid stored value ignored');
  eq(z.percent(1.15), '115%', 'percent label');
  eq([z.zoomable({ layout: 'standard', renderer: 'dom' }), z.zoomable({ layout: 'standard', renderer: 'canvas' }), z.zoomable({ layout: 'immersive', renderer: 'svg' }),
    z.zoomable({ layout: 'immersive', renderer: 'dom', runtime: { type: 'frame' } }), z.zoomable({ layout: 'standard', renderer: '3d' }), z.zoomable(null)],
    [true, true, false, false, false, false], 'only the standard playfield zooms');
  const html = z.zoomControlHtml(1.3);
  eq([html.includes('aria-label="Make game smaller"'), html.includes('aria-label="Make game bigger" disabled'), html.includes('>130%<')], [true, true, true], 'markup: labels, end disabled, value');
  const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  eq(/addEventListener\('keydown'[^\n]*(\+|=|-)[^\n]*zoom/i.test(app), false, 'no keyboard shortcuts hijacked');
  console.log(`GAME_ZOOM_PASS: ${checks} checks`);
})().catch((e) => { console.error(e); process.exit(1); });
