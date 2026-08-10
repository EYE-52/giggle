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
  const shellFunction = gate.indexOf('\nfunction Shell');
  const dob = gate.slice(gate.lastIndexOf('\n  return (', shellFunction), shellFunction);

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
  assert.match(dob, /<AgeHelp onPress=\{\(\) => void openSupport\(\)\} \/>/);
  assert.match(dob, /label="Sign out"/);
});

test('native protected screens do not mount before live adult access succeeds', () => {
  const root = read('app/_layout.tsx');
  const layout = read('app/(app)/_layout.tsx');
  const protectedBoundary = layout.indexOf('if (!authReady)');
  const ageBoundary = layout.indexOf('if (!hasAdultAccess)');
  const stack = layout.indexOf('<Stack');

  assert.match(layout, /await session\.syncAgeFromServer\(\)/);
  assert.match(layout, /setHasAdultAccess\(session\.hasAdultAccess\)/);
  assert.ok(protectedBoundary >= 0 && protectedBoundary < stack);
  assert.ok(ageBoundary >= 0 && ageBoundary < stack);
  assert.match(layout, /if \(!hasAdultAccess\)[\s\S]*<AgeGate[\s\S]*onManageAccount=\{\(\) => router\.push\('\/profile'\)\}/);
  assert.match(root, /<Stack\.Screen name="\(app\)"/);
  assert.doesNotMatch(root, /AgeGate|router\.replace|useRouter/);
});

test('native keeps unavailable accounts on an identity-only profile surface', () => {
  const layout = read('app/(app)/_layout.tsx');
  const gate = read('components/AgeGate.tsx');

  assert.match(layout, /const identityOnlyAccess = authReady && session\.hasIdentityOnlyAccess/);
  assert.match(layout, /identityOnlyAccess && session\.accountStatus !== 'active' && pathname !== '\/profile'/);
  assert.match(layout, /<Redirect href="\/profile" \/>/);
  assert.match(layout, /identityOnlyAccess && pathname === '\/profile'/);
  assert.match(layout, /<IdentityOnlyAccount[\s\S]*onReturnToVerification/);
  assert.match(gate, /onManageAccount\?: \(\) => void/);
  assert.match(gate, /label="Account & data"/);
  assert.ok(layout.indexOf("if (identityRouteBlocked)") < layout.indexOf('if (!hasAdultAccess)'));
});
