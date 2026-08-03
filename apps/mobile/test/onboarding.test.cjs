const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) => readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("onboarding social auth is not a placeholder on web", () => {
  const page = read("app/index.tsx");

  assert.equal(page.includes("TODO: expo-auth-session"), false);
  assert.equal(page.includes("BACKEND_URL"), true);
  assert.equal(page.includes("handleOAuthPress(provider: 'google' | 'apple')"), true);
  assert.equal(page.includes("window.location.href = `${BACKEND_URL}/api/auth/${provider}`;"), true);
});

test("production onboarding email uses referral-aware magic links instead of browser auth exchange", () => {
  const page = read("app/index.tsx");
  const submitBlock = page.slice(page.indexOf("async function handleSubmit()"), page.indexOf("function handleOAuthPress"));

  assert.equal(page.includes("api.startEmailMagicLink"), false);
  assert.equal(submitBlock.includes("if (isProduction)"), true);
  assert.equal(submitBlock.includes("await session.startEmailSignIn(trimmedEmail);"), true);
  assert.equal(submitBlock.indexOf("session.startEmailSignIn") < submitBlock.indexOf("session.signIn"), true);
});

test("mobile web has an auth callback route that stores backend JWTs", () => {
  const callbackPath = path.join(__dirname, "../app/auth/callback.tsx");
  assert.equal(existsSync(callbackPath), true);

  const page = read("app/auth/callback.tsx");
  assert.equal(page.includes("session.setTokenFromOAuth(token)"), true);
  assert.equal(page.includes("router.replace('/home')"), true);
});

test("mobile auth callback recovery is an accessible button", () => {
  const page = read("app/auth/callback.tsx");

  assert.equal(page.includes('accessibilityRole="button"'), true);
  assert.equal(page.includes('accessibilityLabel="Back to sign in"'), true);
});

test("mobile auth callback uses a trustworthy page title", () => {
  const layout = read("app/_layout.tsx");

  assert.equal(layout.includes("'/auth/callback': 'Sign-in status | Giggle'"), true);
  assert.equal(layout.includes("'/auth/callback': 'Giggle'"), false);
});

test("mobile layout only mounts document metadata on web", () => {
  const layout = read("app/_layout.tsx");

  assert.equal(layout.includes("import { Platform } from 'react-native';"), true);
  assert.match(layout, /\{Platform\.OS === 'web' && \(\s*<Head>/);
});

test("dev account skip is hidden and inert in production", () => {
  const page = read("app/index.tsx");
  const skipBlock = page.slice(page.indexOf("async function handleDevSkip()"), page.indexOf("return ("));

  assert.match(page, /const showDevSkip = process\.env\.NODE_ENV !== 'production';/);
  assert.match(page, /if \(!showDevSkip\) return;/);
  assert.match(page, /\{showDevSkip && \(\s*<TouchableOpacity[\s\S]*onPress=\{handleDevSkip\}/);
  assert.equal(skipBlock.includes("await session.devSignIn();\n      router.replace('/home');"), true);
  assert.equal(skipBlock.includes("catch (e: any)"), true);
  assert.equal(skipBlock.includes("catch {}"), false);
});

test("onboarding custom touch targets expose button semantics", () => {
  const page = read("app/index.tsx");

  assert.equal(page.includes('accessibilityRole="button"'), true);
  assert.equal(page.includes("accessibilityLabel={mode === 'create' ? 'Create account' : 'Sign in'}"), true);
  assert.equal(page.includes("? 'Already have an account? Sign in'"), true);
  assert.equal(page.includes(": 'No account yet? Create one'"), true);
  assert.equal(page.includes('accessibilityLabel="Skip with a dev account"'), true);
});

test("onboarding avoids the old oversized blocky auth layout", () => {
  const page = read("app/index.tsx");

  assert.equal(page.includes("Math.round(height * 0.82)"), false);
  assert.equal(page.includes("heroH = isWide ? Math.min(height - 72, 720) : Math.round(height * 0.56)"), true);
  assert.equal(page.includes("authStage"), true);
  assert.equal(page.includes("panelSurface"), true);
  assert.equal(page.includes("Continue with Google"), true);
  assert.equal(page.includes("Continue with Apple"), true);
  assert.equal(page.includes("styles.oauthRowStack"), false);
});

test("mobile layout redirects unauthenticated production users away from app routes", () => {
  const layout = read("app/_layout.tsx");

  assert.equal(layout.includes("PUBLIC_ROUTES"), true);
  assert.equal(layout.includes("session.isAuthed()"), true);
  assert.equal(layout.includes("process.env.NODE_ENV !== 'production'"), true);
  assert.equal(layout.includes("router.replace('/')"), true);
  assert.equal(layout.includes("<Stack.Screen name=\"auth/callback\""), true);
});

test("mobile protected routes wait for shared verified-adult access", () => {
  const gatePath = path.join(__dirname, "../components/AgeGate.tsx");
  assert.equal(existsSync(gatePath), true);

  const layout = read("app/_layout.tsx");
  const gate = read("components/AgeGate.tsx");

  assert.equal(layout.includes("import { AgeGate } from '../components/AgeGate';"), true);
  assert.equal(layout.includes("await session.syncAgeFromServer()"), true);
  assert.equal(layout.includes("if (!isPublicRoute && !authReady)"), true);
  assert.equal(layout.includes("if (!isPublicRoute && !hasAdultAccess)"), true);
  assert.equal(layout.includes("<AgeGate onDone={() => setHasAdultAccess(true)} />"), true);
  assert.equal(gate.includes("await session.setAge(birthDate);"), true);
  assert.equal(gate.includes('keyboardType="number-pad"'), true);
  assert.equal(gate.includes("Giggle is for verified adults 18+"), true);
});

test("mobile home actions do not create dev sessions from protected routes", () => {
  const page = read("app/home.tsx");

  assert.equal(page.includes("await session.devSignIn();"), false);
  assert.equal(page.includes("router.replace('/')"), true);
  assert.equal(page.includes("Sign in to continue"), true);
});

test("mobile discover uses live squad discovery instead of static venue fixtures", () => {
  const page = read("app/discover.tsx");

  assert.equal(page.includes("api.discoverSquads()"), true);
  assert.equal(page.includes("api.joinSquadById("), true);
  assert.equal(page.includes('status === "requested"'), true);
  assert.equal(page.includes("const VENUES = ["), false);
});

test("mobile discover actions fail closed when the user is unauthenticated", () => {
  const page = read("app/discover.tsx");

  assert.equal(page.includes("function ensureAuthed()"), true);
  assert.equal(page.includes("if (session.isAuthed()) return true;"), true);
  assert.equal(page.includes("router.replace('/')"), true);
  assert.equal(page.includes("if (!ensureAuthed()) return;"), true);
});
