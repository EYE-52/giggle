// Invoked by the hosted build command before compilation/promotion. Ordinary
// local `pnpm build` remains independent of production services.
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const API = 'https://giggle-server-production.up.railway.app';
const GAMES = 'https://play.gigglemeet.com';
const GAME_API = 'https://giggle-play-production.up.railway.app';
const uuid = value => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value || '');

async function verifyReleaseDependencies(env = process.env, request = fetch) {
  assert.equal(env.VERCEL_ENV, 'production', 'Hosted release requires explicit production metadata');
  assert.equal(env.VERCEL_GIT_COMMIT_REF, 'main', 'Hosted release requires reviewed main');
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  assert(/^[0-9a-f]{40}$/.test(sha || ''), 'Hosted release source identity is missing');
  assert(env.NEXT_PUBLIC_BACKEND_URL === API, 'Meet API target differs');
  assert(env.NEXT_PUBLIC_GAMES_URL === GAMES, 'Games target differs');
  const get = async url => {
    const response = await request(`${url}?release=${sha}&t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, 'Release dependency is unavailable or protected');
    return response.json();
  };
  const [health, frontend, backend] = await Promise.all([
    get(`${API}/health`), get(`${GAMES}/release.json`), get(`${GAME_API}/config.json`),
  ]);
  assert.equal(health.ok, true, 'Meet API is unhealthy');
  assert.equal(health.services?.database, 'connected', 'Meet database is unavailable');
  assert.equal(health.services?.redis, 'connected', 'Meet Redis is unavailable');
  assert.equal(health.release?.sourceCommit, sha, 'Meet API has not deployed this release');
  assert(uuid(health.release?.deploymentId), 'Meet API deployment identity is missing');
  assert.equal(frontend.schema, 1, 'Games frontend identity is missing');
  assert.equal(frontend.sourceCommit, sha, 'Games frontend has not deployed this release');
  assert(/^[0-9a-f]{64}$/.test(frontend.buildSha256 || ''), 'Games build identity is missing');
  assert(typeof frontend.version === 'string' && frontend.version.length > 0, 'Games version is missing');
  assert.equal(backend.ok, true, 'Games backend is unhealthy');
  assert(isDeepStrictEqual(backend.release, frontend), 'Games frontend/backend identity differs');
  assert(uuid(backend.deploymentId), 'Games backend deployment identity is missing');
  assert.equal(backend.giggleEnabled, true, 'Games bridge is disabled');
  return { sourceCommit: sha, apiDeploymentId: health.release.deploymentId, gamesDeploymentId: backend.deploymentId };
}
if (require.main === module) verifyReleaseDependencies().then(() => {
  console.log('RELEASE_DEPENDENCIES_PASS: matching healthy API and Games release');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verifyReleaseDependencies };
