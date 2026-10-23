import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { sealEnvironment, openEnvironment, selectEnvironment, environmentText } from '../scripts/contributor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-contributor-'));
const password = 'test-only-not-a-real-passphrase';
const env = { NODE_ENV: 'production', PUBLIC_GAME_URL: 'https://play.example.test', GAME_BRIDGE_SECRET: 'test-only-bridge-value-'.repeat(3), GIGGLE_ALLOWED_ORIGINS: 'https://meet.example.test' };
try {
  const sealed = sealEnvironment(env, password);
  assert(!sealed.includes(env.GAME_BRIDGE_SECRET), 'no plaintext bridge secret');
  assert(!sealed.includes(env.PUBLIC_GAME_URL), 'no plaintext env payload');
  assert.deepEqual(openEnvironment(sealed, password), env);
  assert.deepEqual(parseEnv(environmentText(env)), env, 'actual Node env parser reads transferred values');
  assert.notEqual(sealEnvironment(env, password), sealed, 'fresh salt and nonce for each export');
  assert.throws(() => openEnvironment(sealed, 'incorrect-test-only-password'), /Cannot open bundle/);
  for (const field of ['salt', 'iv', 'tag', 'ciphertext']) {
    const tampered = JSON.parse(sealed);
    const bytes = Buffer.from(tampered[field], 'base64'); bytes[0] ^= 1; tampered[field] = bytes.toString('base64');
    assert.throws(() => openEnvironment(JSON.stringify(tampered), password), /Cannot open bundle/, `authenticated ${field}`);
  }
  assert.throws(() => openEnvironment('x'.repeat(128 * 1024 + 1), password), /too large/);
  assert.throws(() => sealEnvironment(env, 'short'), /16 characters/);
  assert.throws(() => selectEnvironment({ ...env, VERCEL_OIDC_TOKEN: 'test-only-personal-token' }), /allowlist/);
  assert.deepEqual(selectEnvironment({ ...env, VERCEL_OIDC_TOKEN: 'test-only-personal-token', RAILWAY_SERVICE_ID: 'test-only-metadata' }, false), env, 'hosting metadata and personal sessions excluded');
  assert.throws(() => selectEnvironment({ GAME_BRIDGE_SECRET: null }), /sealed/);
  assert.throws(() => selectEnvironment({ GAME_BRIDGE_SECRET: 'short' }), /32 characters/);
  assert.throws(() => selectEnvironment({ HOST: 'localhost\nUNEXPECTED=value' }), /Unsupported/);
  assert.throws(() => environmentText({ HOST: "can'not-serialize" }), /Single quotes/);

  const checkout = path.join(temp, 'checkout'); fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
  const script = path.join(checkout, 'scripts/contributor.mjs');
  fs.copyFileSync(path.join(root, 'scripts/contributor.mjs'), script);
  const call = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  let result = call(['setup', '--skip-install', '--bridge']);
  assert.equal(result.status, 0, result.stderr);
  const localPath = path.join(checkout, '.env'), localText = fs.readFileSync(localPath, 'utf8'), local = parseEnv(localText);
  assert.equal(local.HOST, '127.0.0.1'); assert.equal(local.PORT, '8123');
  assert.equal(local.PUBLIC_GAME_URL, ''); assert.equal(local.PUBLIC_WEBSOCKET_URL, '');
  assert(local.GAME_BRIDGE_SECRET.length >= 32);
  assert.equal(local.GIGGLE_ALLOWED_ORIGINS, 'http://localhost:3000,http://127.0.0.1:3000');
  assert(!result.stdout.includes(local.GAME_BRIDGE_SECRET), 'setup never prints generated secret');
  result = call(['setup', '--skip-install']); assert.equal(result.status, 0); assert.equal(fs.readFileSync(localPath, 'utf8'), localText, 'setup preserves local edits');
  const passfile = path.join(temp, 'test.passphrase'); fs.writeFileSync(passfile, password + '\n', { mode: 0o600 });
  const source = path.join(temp, '.env.production'); fs.writeFileSync(source, environmentText(env), { mode: 0o600 });
  const bundle = path.join(temp, 'game.gghandover');
  result = call(['export', '--from', source, '--out', bundle, '--passphrase-file', passfile]); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(openEnvironment(fs.readFileSync(bundle, 'utf8'), password), env);
  result = call(['setup', '--skip-install', '--bundle', bundle, '--passphrase-file', passfile]); assert.equal(result.status, 0, result.stderr);
  const restored = path.join(checkout, '.env.production');
  assert.deepEqual(parseEnv(fs.readFileSync(restored, 'utf8')), env);
  assert.equal(fs.readFileSync(localPath, 'utf8'), localText, 'import never switches local development to production');
  for (const file of [localPath, restored, bundle]) if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'private output file');
  result = call(['import', '--bundle', bundle, '--passphrase-file', passfile]); assert.notEqual(result.status, 0, 'refuse to overwrite credentials');
  result = call(['export', '--from', source, '--out', path.join(checkout, 'private.gghandover'), '--passphrase-file', passfile]); assert.notEqual(result.status, 0, 'reject repo output');
  fs.symlinkSync(checkout, path.join(temp, 'linked-checkout'));
  result = call(['export', '--from', source, '--out', path.join(temp, 'linked-checkout/leak.gghandover'), '--passphrase-file', passfile]); assert.notEqual(result.status, 0, 'reject symlinked repo output');
  assert(!fs.existsSync(path.join(checkout, 'leak.gghandover')));
  if (process.platform !== 'win32') {
    fs.chmodSync(passfile, 0o644);
    result = call(['export', '--from', source, '--out', path.join(temp, 'insecure.gghandover'), '--passphrase-file', passfile]); assert.notEqual(result.status, 0, 'reject exposed passphrase file');
  }
  for (const output of [result.stdout, result.stderr]) {
    assert(!output.includes(env.GAME_BRIDGE_SECRET)); assert(!output.includes(password));
  }
  const wrongScope = path.join(temp, 'personal.env'); fs.writeFileSync(wrongScope, 'VERCEL_OIDC_TOKEN=test-only-personal-token\n');
  result = call(['export', '--from', wrongScope, '--out', path.join(temp, 'bad.gghandover'), '--passphrase-file', passfile]);
  assert.notEqual(result.status, 0); assert(!fs.existsSync(path.join(temp, 'bad.gghandover')));
  console.log('CONTRIBUTOR_PASS: real CLI setup/import/export, isolated local env, authenticated encryption/tamper rejection, scoped variables, private outputs, no overwrite or repo export.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
