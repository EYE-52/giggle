const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getExactRoutes } = require('expo-router/build/getRoutes');

function routeFiles(directory, base = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute, base);
    if (!/\.[jt]sx?$/.test(entry.name)) return [];
    return [`./${path.relative(base, absolute).split(path.sep).join('/')}`];
  });
}

function appRoutes() {
  const files = routeFiles(path.join(__dirname, '../app'));
  const context = Object.assign(() => ({ default: () => null }), {
    keys: () => files,
    resolve: (key) => key,
    id: 'giggle-mobile-routes',
  });
  return getExactRoutes(context, { internal_stripLoadRoute: true });
}

test('Expo resolves protected deep links through the adult gate while public routes stay direct', () => {
  const root = appRoutes();
  assert.ok(root);
  assert.equal(root.contextKey, './_layout.tsx');

  const protectedLayout = root.children.find((route) => route.contextKey === './(app)/_layout.tsx');
  assert.ok(protectedLayout, 'protected route-group layout is registered');

  for (const name of ['home', 'discover', 'profile', 'premium', 'matchmaking', 'match', 'lobby', 'encounter']) {
    const route = protectedLayout.children.find((child) => child.route === name);
    assert.ok(route, `/${name} resolves inside the protected group`);
    assert.deepEqual(route.entryPoints.slice(0, 2), ['./_layout.tsx', './(app)/_layout.tsx']);
    assert.equal(root.children.some((child) => child.route === name), false, `/${name} cannot bypass the gate`);
  }

  for (const contextKey of ['./index.tsx', './auth/callback.tsx']) {
    const route = root.children.find((child) => child.contextKey === contextKey);
    assert.ok(route, `${contextKey} remains public`);
    assert.equal(route.entryPoints.includes('./(app)/_layout.tsx'), false);
  }
});
