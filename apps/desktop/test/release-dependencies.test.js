const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyReleaseDependencies } = require('../scripts/verify-release-dependencies.cjs');
const sha = 'a'.repeat(40), id = '11111111-2222-3333-4444-555555555555';
const env = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: sha,
  NEXT_PUBLIC_BACKEND_URL: 'https://giggle-server-production.up.railway.app', NEXT_PUBLIC_GAMES_URL: 'https://play.gigglemeet.com' };
function harness(patch = {}) {
  const manifest = { schema: 1, sourceCommit: sha, buildSha256: 'b'.repeat(64), version: '0.1.38' };
  const values = {
    '/health': { ok: true, services: { database: 'connected', redis: 'connected' }, release: { sourceCommit: sha, deploymentId: id } },
    '/release.json': manifest,
    '/config.json': { ok: true, release: manifest, deploymentId: id, giggleEnabled: true }, ...patch,
  };
  const calls = [];
  return { calls, values, request: async (url, options) => { calls.push({ url, options }); return { status: 200, json: async () => values[new URL(url).pathname] }; } };
}
test('hosted promotion waits for the same healthy API and both Games hosts', async () => {
  const h = harness(); const result = await verifyReleaseDependencies(env, h.request);
  assert.equal(result.sourceCommit, sha); assert.equal(h.calls.length, 3);
  for (const { url, options } of h.calls) { assert.equal(options.redirect, 'error'); assert.equal(options.headers['Cache-Control'], 'no-cache'); assert.equal(new URL(url).searchParams.get('release'), sha); }
});
test('the post-build check reads again and rejects a dependency changed during compilation', async () => {
  const h = harness(); await verifyReleaseDependencies(env, h.request);
  h.values['/health'] = { ...h.values['/health'], release: { sourceCommit: 'c'.repeat(40), deploymentId: id } };
  await assert.rejects(verifyReleaseDependencies(env, h.request), /has not deployed this release/);
  assert.equal(h.calls.length, 6, 'second check performs fresh dependency requests');
});
test('missing metadata, wrong targets and non-main builds stop before network access', async () => {
  for (const patch of [{ VERCEL_ENV: undefined }, { VERCEL_ENV: 'preview' }, { VERCEL_GIT_COMMIT_REF: 'dev' }, { VERCEL_GIT_COMMIT_SHA: '' }, { NEXT_PUBLIC_BACKEND_URL: 'https://wrong.invalid' }, { NEXT_PUBLIC_GAMES_URL: '' }]) {
    const h = harness(); await assert.rejects(verifyReleaseDependencies({ ...env, ...patch }, h.request)); assert.equal(h.calls.length, 0);
  }
});
test('stale, missing, mismatched and unhealthy dependencies cannot promote Meet', async () => {
  const h = harness();
  for (const patch of [
    { '/health': { ...h.values['/health'], ok: false } },
    { '/health': { ...h.values['/health'], services: { database: 'disconnected', redis: 'connected' } } },
    { '/health': { ...h.values['/health'], release: { sourceCommit: 'c'.repeat(40), deploymentId: id } } },
    { '/health': { ...h.values['/health'], release: { sourceCommit: sha } } },
    { '/release.json': { ...h.values['/release.json'], sourceCommit: 'c'.repeat(40) } },
    { '/release.json': { ...h.values['/release.json'], buildSha256: '' } },
    { '/config.json': { ...h.values['/config.json'], release: { ...h.values['/release.json'], buildSha256: 'c'.repeat(64) } } },
    { '/config.json': { ...h.values['/config.json'], deploymentId: '' } },
    { '/config.json': { ...h.values['/config.json'], giggleEnabled: false } },
  ]) await assert.rejects(verifyReleaseDependencies(env, harness(patch).request));
  await assert.rejects(verifyReleaseDependencies(env, async () => ({ status: 403 })), /unavailable or protected/);
  await assert.rejects(verifyReleaseDependencies(env, async () => { throw Error('timeout'); }), /timeout/);
});
