'use strict';
// Isolated listening/decoding fixture; serves the production module and recordings.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const publicRoot = path.resolve(__dirname, '../public');
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const asset = url.pathname.startsWith('/assets/karts/audio/') || url.pathname === '/js/engines/kart-audio.mjs';
  const file = url.pathname === '/' ? path.join(__dirname, 'fixtures/kart-audio/index.html') : asset ? path.resolve(publicRoot, '.' + url.pathname) : '';
  if (request.method !== 'GET' || !file || (asset && !file.startsWith(publicRoot + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end(); return;
  }
  const type = { '.html': 'text/html', '.mjs': 'application/javascript', '.wav': 'audio/wav' }[path.extname(file)] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(response);
});
server.listen(process.env.PORT || 8499, '127.0.0.1', () => console.log('Kart audio listening fixture: http://127.0.0.1:' + (process.env.PORT || 8499)));
