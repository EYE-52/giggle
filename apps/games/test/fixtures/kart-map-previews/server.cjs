'use strict';
// Local, read-only capture fixture. No match authority or production imports.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const game = require('../../../games/pocket-karts/server');
const { MAPS } = require('../../../games/engines/kart-maps');
const { MAP_LABELS } = require('../../../games/engines/kart-elevated-adapter');
const maps = game.manifest.settings.find(s => s.key === 'map').options.map(label => {
  const elevated = Object.hasOwn(MAP_LABELS, label);
  const id = elevated ? MAP_LABELS[label] : Object.keys(MAPS).find(id => MAPS[id].label === label);
  return { key: `${elevated ? 'elevated' : 'legacy'}-${id}`, label, profile: elevated ? 'elevated' : 'legacy', id,
    ...(elevated ? {} : { map: { id, ...MAPS[id], bound: MAPS[id].half - 2 } }) };
});
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/maps') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(maps)); return;
    }
    const relative = pathname === '/' ? 'test/fixtures/kart-map-previews/index.html'
      : pathname.startsWith('/test/') ? pathname.slice(1) : `public/${pathname.slice(1)}`;
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store'); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end(error.message); }
});
server.listen(Number(process.env.KART_PREVIEW_PORT || 8460), '127.0.0.1', () => {
  console.log(`Kart map previews: http://localhost:${server.address().port}/`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
