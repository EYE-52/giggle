// Development-only local harness. Never imported by the production app/server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test/fixtures/kart-elevation');
const EVIDENCE = process.env.KART_ELEVATION_EVIDENCE || '/tmp/giggle-kart-elevation-20261007';
const RAP = path.join(ROOT, 'node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs');
const ADAPTER = path.join(ROOT, 'games/engines/kart-physics.js');
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png' };
let serial = 0;
export function createElevationServer() {
  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname === '/evidence' && req.method === 'POST') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1500000) throw new Error('evidence limit'); }
        const data = JSON.parse(raw); fs.mkdirSync(EVIDENCE, { recursive: true });
        const size = data.geometry?.viewport, name = `${String(++serial).padStart(3, '0')}-${size?.width || 'node'}x${size?.height || 'node'}.json`;
        fs.writeFileSync(path.join(EVIDENCE, name), JSON.stringify(data, null, 2)); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ saved: name }));
      }
      if (u.pathname === '/games/engines/kart-physics.js') {
        // Root-approved HARNESS-ONLY CJS→ESM bridge. Exact adapter source;
        // injected imports/config, no duplicated physics or production loader.
        res.setHeader('Content-Type', 'text/javascript'); return res.end(`const module={exports:{}};\n${fs.readFileSync(ADAPTER, 'utf8')}\nexport default module.exports;\n`);
      }
      let file;
      if (u.pathname === '/') file = path.join(FIXTURE, 'index.html');
      else if (u.pathname === '/scene') file = path.join(FIXTURE, 'scene.html');
      else if (u.pathname === '/rapier.mjs') file = RAP;
      else if (u.pathname === '/test/kart-elevation-physics.mjs' || u.pathname.startsWith('/test/fixtures/kart-elevation/') || u.pathname.startsWith('/public/vendor/three/') || u.pathname.startsWith('/public/assets/karts/') || ['/public/js/engines/kart-physics-config.mjs', '/public/js/engines/kart-elevated-maps.mjs'].includes(u.pathname)) file = path.resolve(ROOT, '.' + u.pathname);
      if (!file || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('Not found'); }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
    } catch (e) { res.statusCode = 500; res.end(String(e.message)); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8453); createElevationServer().listen(port, '127.0.0.1', () => console.log(`KART_ELEVATION_PROTOTYPE http://127.0.0.1:${port} (no released combat integration)`));
}
