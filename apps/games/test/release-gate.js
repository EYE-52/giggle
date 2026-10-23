'use strict';
// Release regressions: never accept stale health, skipped/failed provider jobs,
// modified artifacts, incomplete credentials or a public production QA table.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { backend, credentials } = require('../scripts/release-gate');
const { buildHash, read } = require('../scripts/release-identity');
const { deployFrontend } = require('../scripts/deploy-frontend');
const manifest = { schema: 1, version: '0.1.38', sourceCommit: 'a'.repeat(40), buildSha256: 'b'.repeat(64) };
const id = '11111111-2222-3333-4444-555555555555';
const config = { ok: true, release: manifest, version: manifest.version, deploymentId: id,
  bridgeVersion: 'giggle-v1', reportingUrl: 'https://giggle-play-production.up.railway.app/api/reports',
  giggleEnabled: true, giggleAllowedOrigins: ['https://www.gigglemeet.com'], allowHttp: false,
  websocketUrl: 'wss://giggle-play-production.up.railway.app', reportingEnabled: true };
const success = [{ id, status: 'SUCCESS' }];
const upload = { deploymentId: id, logsUrl: 'https://railway.com/project/test' };
assert.equal(backend(config, manifest, success, upload), id);
assert.throws(() => credentials({}), /Required deployment credentials missing/);
const creds = Object.fromEntries(['RAILWAY_TOKEN', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'].map(key => [key, 'test-only']));
credentials(creds);
for (const key of Object.keys(creds)) assert.throws(() => credentials({ ...creds, [key]: '  ' }));
for (const status of ['SKIPPED', 'FAILED', 'CRASHED', 'BUILDING', 'DEPLOYING', 'QUEUED', 'NEEDS_APPROVAL', undefined]) {
  assert.throws(() => backend(config, manifest, [{ id, status }], upload));
}
for (const patch of [{ ok: false }, { release: undefined }, { release: { ...manifest, sourceCommit: 'c'.repeat(40) } },
  { release: { ...manifest, buildSha256: 'c'.repeat(64) } }, { version: '0.1.37' }, { deploymentId: '' },
  { deploymentId: '66666666-2222-3333-4444-555555555555' }, { giggleEnabled: false },
  { giggleAllowedOrigins: ['https://evil.example'] }, { allowHttp: true }, { websocketUrl: '' }, { reportingEnabled: false },
  { bridgeVersion: 'giggle-v0' }, { reportingUrl: '' }]) {
  assert.throws(() => backend({ ...config, ...patch }, manifest, success, upload));
}
assert.throws(() => backend(config, manifest, success, { deploymentId: '66666666-2222-3333-4444-555555555555' }), /exact uploaded deployment/);
assert.throws(() => backend(config, manifest, success, {}));
assert.throws(() => backend(config, manifest, [], upload));
assert.throws(() => backend('nonempty stale health', manifest, success, upload));

// Only a fake CLI sees this synthetic credential. No provider call is made.
const frontendEnv = { VERCEL_TOKEN: 'synthetic-test-only-token', VERCEL_ORG_ID: 'test-org',
  VERCEL_PROJECT_ID: 'test-project', RAILWAY_TOKEN: 'synthetic-railway', RAILWAY_API_TOKEN: 'synthetic-api' };
let privateConfig;
function fakeFrontend(command, args, options) {
  assert.equal(command, 'npx');
  assert(args.includes('vercel@39.4.2'), 'exact reviewed CLI version');
  assert(!args.some(arg => arg.includes(frontendEnv.VERCEL_TOKEN) || arg === '--token'), 'token stays out of argv');
  for (const key of ['VERCEL_TOKEN', 'RAILWAY_TOKEN', 'RAILWAY_API_TOKEN']) assert.equal(options.env[key], undefined);
  assert.equal(options.env.VERCEL_ORG_ID, frontendEnv.VERCEL_ORG_ID);
  assert.equal(options.env.VERCEL_PROJECT_ID, frontendEnv.VERCEL_PROJECT_ID);
  privateConfig = args[args.indexOf('--global-config') + 1];
  assert(!privateConfig.startsWith(path.resolve(__dirname, '..') + path.sep), 'auth stays outside the checkout');
  const auth = path.join(privateConfig, 'auth.json');
  assert.equal(fs.statSync(privateConfig).mode & 0o777, 0o700);
  assert.equal(fs.statSync(auth).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(auth, 'utf8')), { token: frontendEnv.VERCEL_TOKEN });
  return { status: 0 };
}
assert.equal(deployFrontend(frontendEnv, fakeFrontend), 0);
assert(!fs.existsSync(privateConfig), 'success removes temporary auth');
assert.equal(deployFrontend(frontendEnv, (...args) => { fakeFrontend(...args); return { status: 7 }; }), 7);
assert(!fs.existsSync(privateConfig), 'CLI failure removes temporary auth');
for (const result of [{ status: null }, { status: null, error: Error('synthetic spawn failure') }]) {
  assert.throws(() => deployFrontend(frontendEnv, (...args) => { fakeFrontend(...args); return result; }), /did not complete/);
  assert(!fs.existsSync(privateConfig), 'spawn or signal failure removes temporary auth');
}
assert.throws(() => deployFrontend(frontendEnv, (...args) => { fakeFrontend(...args); throw Error('synthetic throw'); }), /synthetic throw/);
assert(!fs.existsSync(privateConfig), 'exception removes temporary auth');
for (const key of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
  assert.throws(() => deployFrontend({ ...frontendEnv, [key]: '' }, () => assert.fail('missing credentials must not invoke CLI')), /missing/);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-release-gate-'));
async function main() {
  for (const dir of ['server', 'games', 'locales', 'public', 'scripts', 'sdk']) fs.mkdirSync(path.join(scratch, dir));
  for (const file of ['package-lock.json', 'railway.json', 'vercel.json']) fs.writeFileSync(path.join(scratch, file), '{}');
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ version: '0.1.38' }));
  assert.equal(read(scratch), null, 'unstamped development is explicit');
  const stamped = { ...manifest, buildSha256: buildHash(scratch) };
  fs.writeFileSync(path.join(scratch, 'public/release.json'), JSON.stringify(stamped));
  assert.deepEqual(read(scratch), stamped);
  fs.writeFileSync(path.join(scratch, 'server/changed.js'), 'changed');
  assert.throws(() => read(scratch), /bytes differ/);

  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const freePort = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const server = spawn(process.execPath, ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(freePort), NODE_ENV: 'production',
      GAME_REPORT_DB: path.join(scratch, 'reports.sqlite'), RAILWAY_DEPLOYMENT_ID: id },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
  try {
    let port;
    for (let n = 0; n < 100; n++) {
      port = log.match(/PartyBox on http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
      if (port) break;
      if (server.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(port, 'scratch production server did not boot: ' + log);
    const base = 'http://127.0.0.1:' + port;
    const response = await fetch(base + '/config.json', { signal: AbortSignal.timeout(3000) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const observed = await response.json();
    assert.equal(observed.deploymentId, id);
    assert(observed.release === null || /^[0-9a-f]{40}$/.test(observed.release.sourceCommit));
    const icon = await fetch(base + '/favicon.ico', { signal: AbortSignal.timeout(3000) });
    assert.equal(icon.status, 200, 'implicit browser favicon request resolves');
    assert.equal(icon.headers.get('content-type'), 'image/x-icon');
    const ico = Buffer.from(await icon.arrayBuffer());
    assert.equal(ico.readUInt16LE(0), 0, 'ICO reserved field');
    assert.equal(ico.readUInt16LE(2), 1, 'ICO image type');
    assert.equal(ico.readUInt16LE(4), 2, '16px and 32px icon images');
    for (let n = 0; n < 2; n++) {
      const entry = 6 + n * 16, size = [16, 32][n];
      assert.equal(ico[entry], size); assert.equal(ico[entry + 1], size);
      const start = ico.readUInt32LE(entry + 12), length = ico.readUInt32LE(entry + 8);
      assert(start + length <= ico.length, 'icon image stays within the asset');
      assert.equal(ico.subarray(start, start + 8).toString('hex'), '89504e470d0a1a0a', 'PNG image in ICO');
    }
    for (const route of ['/test/', '/test/index.html', '/%74est/index.html', '/fixtures/', '/%ZZ']) {
      const r = await fetch(base + route, { signal: AbortSignal.timeout(3000) });
      assert.equal(r.status, route === '/%ZZ' ? 400 : 404, route);
    }
    for (const route of ['/test', '/.%2ftest/index.html', '/x/%2e%2e/test/index.html', '/.%2ffixtures/index.html']) {
      const status = await new Promise((resolve, reject) => {
        const request = http.get({ hostname: '127.0.0.1', port, path: route }, response => { response.resume(); resolve(response.statusCode); });
        request.setTimeout(3000, () => request.destroy(Error('HTTP timeout')));
        request.on('error', reject);
      });
      assert.equal(status, 404, route);
    }
  } finally {
    server.kill();
    if (server.exitCode === null && server.signalCode === null) await once(server, 'exit');
  }
  console.log('RELEASE_GATE_PASS: credentials, source/build/deployment identity, provider SUCCESS, artifact tamper, no-cache config, production QA/malformed routes');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(scratch, { recursive: true, force: true }));
