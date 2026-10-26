'use strict';
// Synthetic Git source, provider evidence and CLI. No credentials or provider
// requests are used, and no auth file is created by the session adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-session-release-')));
const repo = path.join(scratch, 'source'), root = path.join(repo, 'apps/games');
const passed = [];
async function check(name, fn) { await fn(); passed.push(name); }

async function main() {
  fs.mkdirSync(root, { recursive: true });
  for (const dir of ['public', 'scripts', 'server', 'games', 'sdk', 'locales']) fs.mkdirSync(path.join(root, dir));
  for (const file of ['package-lock.json', 'railway.json', 'vercel.json']) fs.writeFileSync(path.join(root, file), '{}');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.38' }));
  fs.writeFileSync(path.join(repo, 'meet.txt'), 'original');
  for (const file of ['deploy-frontend.js', 'release-gate.js', 'release-identity.js']) {
    fs.copyFileSync(path.resolve(__dirname, '../scripts', file), path.join(root, 'scripts', file));
  }
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main'); git('add', '.');
  git('-c', 'user.name=Release Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic source');
  git('remote', 'add', 'origin', 'https://github.com/EYE-52/giggle.git');
  const sha = git('rev-parse', 'HEAD');
  const { buildHash } = require(path.join(root, 'scripts/release-identity'));
  const { deployFrontendSession } = require(path.join(root, 'scripts/deploy-frontend'));
  const manifest = { schema: 1, version: '0.1.38', sourceCommit: sha, buildSha256: buildHash(root) };
  const stamp = path.join(root, 'public/release.json');
  const writeStamp = () => fs.writeFileSync(stamp, JSON.stringify(manifest));
  writeStamp();
  const id = '11111111-2222-3333-4444-555555555555';
  const config = { ok: true, release: manifest, version: manifest.version, deploymentId: id,
    bridgeVersion: 'giggle-v1', giggleEnabled: true, giggleAllowedOrigins: ['https://www.gigglemeet.com'],
    allowHttp: false, websocketUrl: 'wss://giggle-play-production.up.railway.app', reportingEnabled: true,
    reportingUrl: 'https://giggle-play-production.up.railway.app/api/reports' };
  const files = ['config.json', 'deployments.json', 'upload.json'].map(file => path.join(scratch, file));
  const writeEvidence = (patch = {}) => {
    fs.writeFileSync(files[0], JSON.stringify(patch.config || config));
    fs.writeFileSync(files[1], JSON.stringify(patch.deployments || [{ id, status: 'SUCCESS' }]));
    fs.writeFileSync(files[2], JSON.stringify(patch.upload || { deploymentId: id }));
  };
  writeEvidence();
  const env = { ...process.env, RELEASE_SOURCE_SHA: sha, CI: '0',
    VERCEL_ORG_ID: 'team_fn5QKDNaysGA4YaEo1hE1NrB', VERCEL_PROJECT_ID: 'prj_Nc4Uf5jRAsBuAMLkbwXbHgplv3jF',
    RAILWAY_TOKEN: 'synthetic-not-a-credential', RAILWAY_API_TOKEN: 'synthetic-not-a-credential' };
  delete env.VERCEL_TOKEN;
  const project = { id: env.VERCEL_PROJECT_ID, owner: { slug: 'divyansh24888-5115s-projects' }, rootDirectory: null };
  let calls, requests, inspectResult, mainResult, deployResult, liveConfig, liveFrontend, afterInspect, afterRequest;
  const reset = () => {
    calls = []; requests = []; inspectResult = { status: 0, stdout: JSON.stringify(project) };
    mainResult = { status: 0, stdout: sha + '\trefs/heads/main\n' }; deployResult = { status: 0 };
    liveConfig = config; liveFrontend = manifest; afterInspect = afterRequest = () => {}; writeEvidence(); writeStamp();
  };
  const run = (command, args, options) => {
    calls.push({ command, args });
    assert.equal(options.cwd, root);
    assert.equal(options.env.CI, '1', 'missing auth cannot trigger agent login');
    assert.equal(options.env.NO_UPDATE_NOTIFIER, '1');
    assert.equal(options.env.VERCEL_TELEMETRY_DISABLED, '1');
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(options.env.GIT_SSH_COMMAND, 'ssh -o BatchMode=yes');
    assert.equal(options.env.GCM_INTERACTIVE, 'Never');
    for (const key of ['VERCEL_TOKEN', 'RAILWAY_TOKEN', 'RAILWAY_API_TOKEN']) assert.equal(options.env[key], undefined);
    assert(!args.some(arg => /synthetic|--token|--global-config|--temporary|--create-if-missing/.test(arg)));
    assert.equal(options.stdio[0], 'ignore', 'CLI cannot prompt for input');
    if (command === 'git') {
      assert.deepEqual(args, ['ls-remote', 'origin', 'refs/heads/main']);
      return mainResult;
    }
    assert.equal(command, 'npx');
    if (args.includes('inspect')) {
      assert.deepEqual(args, ['--yes', 'vercel@65.2.0', 'project', 'inspect', env.VERCEL_PROJECT_ID,
        '--scope', env.VERCEL_ORG_ID, '--non-interactive', '--json']);
      afterInspect(); return inspectResult;
    }
    assert.deepEqual(args, ['--yes', 'vercel@65.2.0', 'deploy', '--prod', '--yes', '--non-interactive',
      '--scope', env.VERCEL_ORG_ID, '--project', env.VERCEL_PROJECT_ID]);
    return deployResult;
  };
  const request = async (url, options) => {
    requests.push(url);
    const frontend = url.startsWith('https://play.gigglemeet.com/release.json?release=' + sha + '&t=');
    assert(frontend || url.startsWith('https://giggle-play-production.up.railway.app/config.json?release=' + sha + '&t='));
    assert.equal(options.redirect, 'error'); assert.equal(options.headers['Cache-Control'], 'no-cache');
    assert(options.signal instanceof AbortSignal);
    afterRequest(); return { status: 200, json: async () => frontend ? liveFrontend : liveConfig };
  };
  const release = (overrides = {}, fetcher = request) => deployFrontendSession(files, { ...env, ...overrides }, run, fetcher);
  const noUpload = () => assert(!calls.some(call => call.args.includes('deploy')));
  // Fixture creation is complete: session mode must never make temporary auth storage.
  const mkdir = fs.mkdtempSync;
  fs.mkdtempSync = () => assert.fail('session mode must not create auth storage');
  try {
    await check('existing-session invocation preserves scope, project, source, fresh backend and flags', async () => {
      reset(); assert.equal(await release(), 0); assert.equal(requests.length, 2);
      assert.deepEqual(calls.map(call => call.command + ':' + (call.args.includes('inspect') ? 'inspect' : call.args.includes('deploy') ? 'deploy' : 'main')), ['npx:inspect', 'git:main', 'npx:deploy']);
    });
    await check('wrong target rejected before any CLI', async () => {
      for (const key of ['VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
        reset(); await assert.rejects(release({ [key]: 'wrong' }), /reviewed Vercel team\/project/); assert.equal(calls.length, 0);
      }
    });
    await check('explicit token cannot silently change session authentication', async () => {
      reset(); await assert.rejects(release({ VERCEL_TOKEN: 'synthetic' }), /must not receive/); assert.equal(calls.length, 0);
    });
    await check('reviewed SHA and actual Git HEAD must match', async () => {
      reset(); await assert.rejects(release({ RELEASE_SOURCE_SHA: 'a'.repeat(40) }), /Reviewed release source/); assert.equal(calls.length, 0);
      const otherManifest = { ...manifest, sourceCommit: 'a'.repeat(40) };
      fs.writeFileSync(stamp, JSON.stringify(otherManifest));
      writeEvidence({ config: { ...config, release: otherManifest } });
      await assert.rejects(release({ RELEASE_SOURCE_SHA: 'a'.repeat(40) }), /Checked-out source differs/); assert.equal(calls.length, 0);
    });
    await check('missing stamp and changed runtime fail closed', async () => {
      reset(); fs.unlinkSync(stamp); await assert.rejects(release(), /not been stamped/); assert.equal(calls.length, 0);
      writeStamp(); const file = path.join(root, 'server/tampered.js'); fs.writeFileSync(file, 'tampered');
      try { await assert.rejects(release(), /bytes differ/); assert.equal(calls.length, 0); } finally { fs.unlinkSync(file); }
    });
    await check('sibling edits and noncanonical origin fail before CLI', async () => {
      reset(); fs.writeFileSync(path.join(repo, 'meet.txt'), 'dirty');
      try { await assert.rejects(release(), /uncommitted changes/); assert.equal(calls.length, 0); } finally { fs.writeFileSync(path.join(repo, 'meet.txt'), 'original'); }
      git('remote', 'set-url', 'origin', 'https://example.invalid/unreviewed');
      try { await assert.rejects(release(), /Canonical source remote/); assert.equal(calls.length, 0); } finally { git('remote', 'set-url', 'origin', 'https://github.com/EYE-52/giggle.git'); }
    });
    await check('unsuccessful or mismatched exact upload evidence blocks CLI', async () => {
      for (const patch of [{ deployments: [{ id, status: 'SKIPPED' }] }, { upload: { deploymentId: 'other' } }, { config: { ...config, release: { ...manifest, buildSha256: 'b'.repeat(64) } } }]) {
        reset(); writeEvidence(patch); await assert.rejects(release()); assert.equal(calls.length, 0);
      }
    });
    await check('missing/failed session inspection cannot open login or deploy', async () => {
      for (const result of [{ status: 1, stdout: 'login required; do not follow', stderr: 'synthetic-private-error' }, { status: null }, { error: Error('spawn'), status: null }]) {
        reset(); inspectResult = result; await assert.rejects(release(), /inspection failed/); assert.equal(calls.length, 1); noUpload(); assert.equal(requests.length, 0);
      }
    });
    await check('project/owner/root mismatch or malformed inspection fails closed', async () => {
      for (const value of [{ ...project, id: 'other' }, { ...project, owner: { slug: 'other' } }, { ...project, rootDirectory: 'apps/games' }]) {
        reset(); inspectResult.stdout = JSON.stringify(value); await assert.rejects(release()); noUpload(); assert.equal(requests.length, 0);
      }
      reset(); inspectResult.stdout = 'not JSON'; await assert.rejects(release(), /invalid JSON/); noUpload();
    });
    await check('fresh backend failure, redirect or identity change prevents upload', async () => {
      reset(); liveConfig = { ...config, deploymentId: '66666666-2222-3333-4444-555555555555' }; await assert.rejects(release(), /exact uploaded/); noUpload();
      reset(); await assert.rejects(release({}, async () => ({ status: 302 })), /unavailable/); noUpload();
      reset(); await assert.rejects(release({}, async () => { throw Error('synthetic timeout'); }), /timeout/); noUpload();
    });
    await check('moved or unreadable current main prevents upload', async () => {
      for (const value of [{ status: 0, stdout: 'a'.repeat(40) + '\trefs/heads/main' }, { status: 1 }, { status: null }, { status: 0, stdout: sha + '\trefs/heads/develop' }]) {
        reset(); mainResult = value; await assert.rejects(release(), /current main/); noUpload();
      }
    });
    await check('changes during inspection are rechecked immediately before upload', async () => {
      reset(); afterInspect = () => fs.writeFileSync(path.join(repo, 'meet.txt'), 'changed during preflight');
      try { await assert.rejects(release(), /uncommitted changes/); noUpload(); } finally { fs.writeFileSync(path.join(repo, 'meet.txt'), 'original'); }
      reset(); const file = path.join(root, 'server/late.js'); afterRequest = () => fs.writeFileSync(file, 'tampered');
      try { await assert.rejects(release(), /bytes differ/); noUpload(); } finally { fs.unlinkSync(file); }
    });
    await check('deployment failure/termination is never reported as success', async () => {
      reset(); deployResult = { status: 7 }; assert.equal(await release(), 7);
      reset(); deployResult = { status: null }; await assert.rejects(release(), /did not complete/);
      reset(); deployResult = {}; await assert.rejects(release(), /did not complete/);
    });
    await check('frontend own static identity is required after CLI success', async () => {
      reset(); liveFrontend = { ...manifest, buildSha256: 'f'.repeat(64) };
      await assert.rejects(release(), /Frontend source\/build/);
      assert.equal(calls.filter(call => call.args.includes('deploy')).length, 1, 'no automatic redeploy or rollback');
    });
    await check('incomplete or unknown CLI usage exits before provider work', async () => {
      for (const args of [['--session'], ['--unknown']]) {
        const result = spawnSync(process.execPath, [path.join(root, 'scripts/deploy-frontend.js'), ...args], { cwd: root, env, encoding: 'utf8' });
        assert.equal(result.status, 1); assert.match(result.stderr, /Usage:/);
      }
    });
  } finally { fs.mkdtempSync = mkdir; }
  console.log('DEPLOY_FRONTEND_SESSION_PASS: ' + passed.length + ' contract groups; no real auth, provider calls or uploads');
  console.log(JSON.stringify({ passed }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(scratch, { recursive: true, force: true }));
