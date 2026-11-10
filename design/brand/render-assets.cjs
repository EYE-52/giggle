#!/usr/bin/env node
/* Raster exports use Chromium's SVG renderer. npm ci in apps/games first.
 * No remote fonts or services. All marks and wordmarks are vector paths. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../apps/games/node_modules/playwright');
const root = path.resolve(__dirname, '../..');
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const kind of ['games', 'after-dark']) {
      const dir = path.join(__dirname, kind);
      const exports = [
        ...[16, 32, 48].map(n => ['favicon.svg', `favicon-${n}.png`, n, n]),
        ['icon.svg', 'apple-touch-icon.png', 180, 180],
        ...[192, 512].map(n => ['icon.svg', `pwa-${n}.png`, n, n]),
        ...[192, 512].map(n => ['maskable.svg', `pwa-maskable-${n}.png`, n, n]),
        ['og.svg', 'og.png', 1200, 630],
      ];
      for (const [source, target, width, height] of exports) {
        let svg = fs.readFileSync(path.join(dir, source), 'utf8');
        // Apple applies its own corner mask to a full-bleed background.
        if (target === 'apple-touch-icon.png') svg = svg.replace('rx="16"', 'rx="0"');
        await page.setViewportSize({ width, height });
        await page.setContent(`<style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
        await page.screenshot({ path: path.join(dir, target), omitBackground: true });
      }
      const pngs = [16, 32, 48].map(n => fs.readFileSync(path.join(dir, `favicon-${n}.png`)));
      const header = Buffer.alloc(6 + 16 * pngs.length);
      header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
      let offset = header.length;
      pngs.forEach((png, i) => {
        const p = 6 + 16*i, size = [16, 32, 48][i];
        header[p] = size; header[p+1] = size;
        header.writeUInt16LE(1, p+4); header.writeUInt16LE(32, p+6);
        header.writeUInt32LE(png.length, p+8); header.writeUInt32LE(offset, p+12);
        offset += png.length;
      });
      fs.writeFileSync(path.join(dir, 'favicon.ico'), Buffer.concat([header, ...pngs]));
    }
    const source = path.join(__dirname, 'games');
    const dest = path.join(root, 'apps/games/public');
    const files = ['icon.svg', 'favicon.svg', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-192.png', 'pwa-maskable-512.png', 'og.png', 'wordmark.svg', 'wordmark-dark.svg'];
    for (const file of files) fs.copyFileSync(path.join(source, file), path.join(dest, file));
    console.log('Rendered both export sets and copied the Games assets into public/.');
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
