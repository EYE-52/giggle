const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (relativePath) => readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('native age gate completes only after provider verification and a live sync', () => {
  const gate = read('components/AgeGate.tsx');

  assert.match(gate, /api\.startAgeVerification\(\)/);
  assert.match(gate, /api\.getAgeVerificationStatus\(\)/);
  assert.match(gate, /await session\.syncAgeFromServer\(\)[\s\S]*session\.hasAdultAccess[\s\S]*onDone\(\)/);
  assert.equal((gate.match(/onDone\(\)/g) || []).length, 1);
  assert.match(gate, /Giggle is for verified adults 18\+/);
  assert.doesNotMatch(gate, /adult content/i);
});

test('native age verification opens only the exact hosted Yoti origin', () => {
  const gate = read('components/AgeGate.tsx');
  const start = gate.slice(gate.indexOf('async function startVerification'), gate.indexOf('function signOut'));

  assert.match(gate, /import[\s\S]*Linking[\s\S]*from 'react-native'/);
  assert.match(start, /new URL\(result\.url\)/);
  assert.match(start, /providerUrl\.protocol !== 'https:'/);
  assert.match(start, /providerUrl\.hostname !== 'age\.yoti\.com'/);
  assert.match(start, /providerUrl\.port !== ''/);
  assert.match(start, /providerUrl\.username !== ''/);
  assert.match(start, /providerUrl\.password !== ''/);
  assert.match(start, /await Linking\.openURL\(providerUrl\.toString\(\)\)/);
  assert.doesNotMatch(start, /Linking\.openURL\(result\.url\)/);
  assert.doesNotMatch(gate, /WebView/);
});

test('native verification return is bounded, coalesced, and ignores stale work', () => {
  const gate = read('components/AgeGate.tsx');
  const start = gate.slice(gate.indexOf('async function startVerification'), gate.indexOf('function signOut'));

  assert.match(gate, /const MAX_STATUS_POLLS = 4/);
  assert.match(gate, /const mounted = useRef\(true\)/);
  assert.match(gate, /const operationGeneration = useRef\(0\)/);
  assert.match(gate, /const reconcileInFlight = useRef<Promise<void> \| null>\(null\)/);
  assert.match(gate, /if \(reconcileInFlight\.current\) return reconcileInFlight\.current/);
  assert.match(gate, /AppState\.addEventListener\('change', onAppStateChange\)/);
  assert.match(gate, /if \(nextState === 'active'\) void reconcile\(\)/);
  assert.match(start, /const operation = \+\+operationGeneration\.current/);
  assert.match(start, /await api\.startAgeVerification\(\)[\s\S]*!mounted\.current[\s\S]*operation !== operationGeneration\.current/);
  assert.match(gate, /subscription\.remove\(\)/);
});

test('native blocked states retain retry, support, and sign-out exits', () => {
  const gate = read('components/AgeGate.tsx');

  for (const state of ['pending', 'rejected', 'unavailable', 'restricted']) {
    assert.match(gate, new RegExp(`'${state}'`));
  }
  assert.match(gate, /mailto:support@gigglemeet\.com\?subject=Age%20verification%20help/);
  assert.match(gate, /Linking\.openURL\(SUPPORT_URL\)/);
  assert.match(gate, /session\.signOut\(\)/);
  assert.match(gate, /router\.replace\('\/'\)/);
  assert.match(gate, /label="Continue with Yoti"/);
  assert.match(gate, /label="Check again"/);
  assert.match(gate, /label="Try verification again"/);
});

test('native protected screens do not mount before live adult access succeeds', () => {
  const layout = read('app/_layout.tsx');
  const protectedBoundary = layout.indexOf("if (!isPublicRoute && !authReady)");
  const ageBoundary = layout.indexOf("if (!isPublicRoute && !hasAdultAccess)");
  const stack = layout.indexOf('<Stack');

  assert.match(layout, /await session\.syncAgeFromServer\(\)/);
  assert.match(layout, /setHasAdultAccess\(session\.hasAdultAccess\)/);
  assert.ok(protectedBoundary >= 0 && protectedBoundary < stack);
  assert.ok(ageBoundary >= 0 && ageBoundary < stack);
  assert.match(layout, /if \(!isPublicRoute && !hasAdultAccess\) \{\s*return <AgeGate onDone=\{\(\) => setHasAdultAccess\(true\)\} \/>;\s*\}/);
  assert.doesNotMatch(layout, /<Stack[\s\S]*<AgeGate/);
});
