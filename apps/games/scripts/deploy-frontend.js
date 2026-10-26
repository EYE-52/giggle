'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const { frontendTarget, backend } = require('./release-gate');
const { read } = require('./release-identity');
const ROOT = path.resolve(__dirname, '..');
const SESSION_CLI = 'vercel@65.2.0';

// Vercel 39 reads auth.json, not VERCEL_TOKEN. Keep the existing CI token out
// of argv and the repository; this never creates a token or a persistent grant.
function deployFrontend(env = process.env, run = spawnSync) {
  for (const key of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
    if (!env[key]?.trim()) throw Error('Required deployment credential missing: ' + key);
  }
  frontendTarget(env);
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-vercel-'));
  try {
    fs.chmodSync(config, 0o700);
    fs.writeFileSync(path.join(config, 'auth.json'), JSON.stringify({ token: env.VERCEL_TOKEN }), { mode: 0o600, flag: 'wx' });
    const childEnv = { ...env };
    for (const key of ['VERCEL_TOKEN', 'RAILWAY_TOKEN', 'RAILWAY_API_TOKEN']) delete childEnv[key];
    const result = run('npx', ['--yes', 'vercel@39.4.2', '--global-config', config, 'deploy', '--prod', '--yes'], {
      cwd: path.resolve(__dirname, '..'), env: childEnv, stdio: 'inherit',
    });
    if (result.error || result.status === null) throw Error('Vercel CLI did not complete');
    return result.status;
  } finally {
    fs.rmSync(config, { recursive: true, force: true });
  }
}

// Explicit local-session path. CI=1 is intentional: CLI 65 can otherwise start
// login automatically for an agent even with --non-interactive. Never read or
// copy auth.json ourselves; only the CLI uses its existing ordinary login.
async function deployFrontendSession(files, env = process.env, run = spawnSync, request = fetch) {
  frontendTarget(env);
  assert.equal(files.length, 3, 'Session release requires backend config, deployment list and upload JSON');
  assert(!env.VERCEL_TOKEN?.trim(), 'Session mode must not receive VERCEL_TOKEN');
  const manifest = read();
  assert(manifest, 'Release has not been stamped');
  assert.equal(env.RELEASE_SOURCE_SHA, manifest.sourceCommit, 'Reviewed release source differs');
  const [config, deployments, upload] = files.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  backend(config, manifest, deployments, upload);

  const childEnv = { ...env, CI: '1', NO_UPDATE_NOTIFIER: '1', VERCEL_TELEMETRY_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', GCM_INTERACTIVE: 'Never' };
  for (const key of ['VERCEL_TOKEN', 'RAILWAY_TOKEN', 'RAILWAY_API_TOKEN']) delete childEnv[key];
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const cleanSource = () => {
    assert.equal(git('rev-parse', 'HEAD'), manifest.sourceCommit, 'Checked-out source differs');
    const gitRoot = git('rev-parse', '--show-toplevel');
    const stampPath = path.relative(gitRoot, path.join(ROOT, 'public/release.json')).split(path.sep).join('/');
    assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal', '--', '.', ':!' + stampPath], {
      cwd: gitRoot, env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(), '', 'Release source has uncommitted changes');
  };
  cleanSource();
  assert(['https://github.com/EYE-52/giggle.git', 'https://github.com/EYE-52/giggle', 'git@github.com:EYE-52/giggle.git'].includes(git('remote', 'get-url', 'origin')), 'Canonical source remote differs');

  const inspect = run('npx', ['--yes', SESSION_CLI, 'project', 'inspect', env.VERCEL_PROJECT_ID,
    '--scope', env.VERCEL_ORG_ID, '--non-interactive', '--json'], {
    cwd: ROOT, env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  });
  assert(!inspect.error && inspect.status === 0, 'Vercel project inspection failed; coordinate existing-account sign-in separately');
  let project;
  try { project = JSON.parse(inspect.stdout); } catch { throw Error('Vercel project inspection returned invalid JSON'); }
  assert(project.id === env.VERCEL_PROJECT_ID && project.owner?.slug === 'divyansh24888-5115s-projects', 'Vercel session resolved a different project/owner');
  assert([null, '', '.', './'].includes(project.rootDirectory), 'Games project must use the component upload root');

  const response = await request('https://giggle-play-production.up.railway.app/config.json?release=' + manifest.sourceCommit + '&t=' + Date.now(), {
    headers: { 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, 'Fresh backend configuration unavailable');
  backend(await response.json(), manifest, deployments, upload);
  const main = run('git', ['ls-remote', 'origin', 'refs/heads/main'], {
    cwd: ROOT, env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  });
  assert(!main.error && main.status === 0 && main.stdout.trim() === manifest.sourceCommit + '\trefs/heads/main', 'Reviewed current main could not be verified');
  assert.deepEqual(read(), manifest, 'Release changed during preflight');
  cleanSource();
  const result = run('npx', ['--yes', SESSION_CLI, 'deploy', '--prod', '--yes', '--non-interactive',
    '--scope', env.VERCEL_ORG_ID, '--project', env.VERCEL_PROJECT_ID], {
    cwd: ROOT, env: childEnv, stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error || !Number.isInteger(result.status)) throw Error('Vercel CLI did not complete');
  if (result.status === 0) {
    const frontend = await request('https://play.gigglemeet.com/release.json?release=' + manifest.sourceCommit + '&t=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    assert.equal(frontend.status, 200, 'Frontend release identity unavailable');
    assert.deepEqual(await frontend.json(), manifest, 'Frontend source/build identity differs');
  }
  return result.status;
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.length === 0) process.exitCode = deployFrontend();
    else if (args[0] === '--session' && args.length === 4) process.exitCode = await deployFrontendSession(args.slice(1));
    else throw Error('Usage: deploy-frontend.js [--session backend-config.json backend-deployments.json backend-upload.json]');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { deployFrontend, deployFrontendSession };
