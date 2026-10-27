'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { validate } = require('./release-identity');
const BACKEND = 'wss://giggle-play-production.up.railway.app';

function frontendTarget(env) {
  if (env.VERCEL_ORG_ID !== 'team_fn5QKDNaysGA4YaEo1hE1NrB' ||
      env.VERCEL_PROJECT_ID !== 'prj_Nc4Uf5jRAsBuAMLkbwXbHgplv3jF') {
    throw Error('Games frontend target differs from the reviewed Vercel team/project');
  }
}

function credentials(env) {
  const missing = ['RAILWAY_TOKEN', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'].filter(key => !env[key]?.trim());
  if (missing.length) throw Error('Required deployment credentials missing: ' + missing.join(', '));
  frontendTarget(env);
}

function backend(config, manifest, deployments, upload) {
  validate(manifest);
  assert.equal(config.ok, true, 'backend is unhealthy');
  assert.deepEqual(config.release, manifest, 'backend source/build fingerprint differs');
  assert.equal(config.version, manifest.version, 'backend version differs');
  assert.equal(config.bridgeVersion, 'giggle-v1', 'bridge protocol differs');
  assert.match(config.deploymentId || '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/, 'Railway deployment identity missing');
  assert.equal(config.deploymentId, upload?.deploymentId, 'backend is not the exact uploaded deployment');
  assert(Array.isArray(deployments), 'invalid Railway deployment response');
  const deployed = deployments.find(item => item.id === config.deploymentId);
  assert.equal(deployed?.status, 'SUCCESS', 'exact Railway deployment has not succeeded');
  assert.equal(config.giggleEnabled, true, 'Giggle bridge disabled');
  assert.deepEqual(config.giggleAllowedOrigins, ['https://www.gigglemeet.com'], 'Giggle origin differs');
  assert.equal(config.allowHttp, false, 'insecure HTTP origins enabled');
  assert.equal(config.websocketUrl, BACKEND, 'WebSocket endpoint differs');
  assert.equal(config.reportingEnabled, true, 'persistent reporting disabled');
  assert.equal(config.reportingUrl, 'https://giggle-play-production.up.railway.app/api/reports', 'reporting endpoint differs');
  return config.deploymentId;
}

if (require.main === module) {
  try {
    if (process.argv[2] === 'credentials') credentials(process.env);
    else if (process.argv[2] === 'backend') {
      const [config, manifest, deployments, upload] = process.argv.slice(3).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
      console.log(backend(config, manifest, deployments, upload));
    } else if (process.argv[2] === 'frontend') {
      const [observed, expected] = process.argv.slice(3).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
      validate(observed); validate(expected); assert.deepEqual(observed, expected, 'frontend fingerprint differs');
    } else throw Error('Unknown release check');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { credentials, backend, frontendTarget };
