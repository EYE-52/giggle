'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { frontendTarget } = require('./release-gate');

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

if (require.main === module) {
  try { process.exitCode = deployFrontend(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { deployFrontend };
