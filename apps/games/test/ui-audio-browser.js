'use strict';
// Standalone native-audio fixture: production fx/recordings, no game clocks or state.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), publicRoot = path.join(root, 'public');
const output = process.env.UI_AUDIO_REPORT_DIR || '/tmp/giggle-ui-audio-reports';
fs.mkdirSync(output, { recursive: true });
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'POST' && url.pathname === '/__qa/report') {
    let body = '';
    request.on('data', data => { body += data; if (body.length > 32000) request.destroy(); });
    request.on('end', () => {
      try {
        const report = JSON.parse(body), browser = /Chrome\//.test(report.userAgent) ? 'chrome' : /Safari\//.test(report.userAgent) ? 'safari' : 'other';
        fs.writeFileSync(path.join(output, browser + '.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ browser, pass: report.pass, checks: report.checks.length }));
        response.writeHead(200).end('Saved');
      } catch { response.writeHead(400).end('Invalid report'); }
    });
    return;
  }
  const permitted = url.pathname.startsWith('/assets/game-audio/') || ['/js/fx.js', '/js/util.js'].includes(url.pathname);
  const file = url.pathname === '/' ? path.join(__dirname, 'fixtures/ui-audio/index.html') : permitted ? path.resolve(publicRoot, '.' + url.pathname) : '';
  if (!file || (permitted && !file.startsWith(publicRoot + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'application/javascript', '.wav': 'audio/wav', '.json': 'application/json' })[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(response);
}).listen(process.env.PORT || 8487, '127.0.0.1', () => console.log('Native gameplay audio fixture: http://127.0.0.1:' + (process.env.PORT || 8487)));
