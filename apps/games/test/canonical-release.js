'use strict';
// Exercise the real stamp command in a nested, disposable Git repository.
// No provider calls, credentials or publication are involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-monorepo-stamp-'));
try {
  const component = path.join(scratch, 'apps/games');
  fs.mkdirSync(component, { recursive: true });
  for (const dir of ['server', 'games', 'locales', 'public', 'scripts', 'sdk']) fs.mkdirSync(path.join(component, dir));
  for (const file of ['package-lock.json', 'railway.json', 'vercel.json']) fs.writeFileSync(path.join(component, file), '{}');
  fs.writeFileSync(path.join(component, 'package.json'), JSON.stringify({ version: '0.1.38' }));
  fs.copyFileSync(path.resolve(__dirname, '../scripts/release-identity.js'), path.join(component, 'scripts/release-identity.js'));
  fs.writeFileSync(path.join(scratch, 'meet-source.txt'), 'canonical Meet source\n');
  const git = (...args) => execFileSync('git', args, { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('add', '.');
  git('-c', 'user.name=Local Release Test', '-c', 'user.email=local-test@example.invalid', 'commit', '-qm', 'synthetic fixture');
  const commit = git('rev-parse', 'HEAD');
  const stamp = (sha = commit) => spawnSync(process.execPath, ['scripts/release-identity.js', 'stamp'], { cwd: component, env: { ...process.env, RELEASE_SOURCE_SHA: sha }, encoding: 'utf8' });
  assert.notEqual(stamp('a'.repeat(40)).status, 0, 'wrong root source SHA is rejected');
  const valid = stamp(); assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).sourceCommit, commit, 'nested stamp identifies canonical root commit');
  assert.equal(stamp().status, 0, 'the sole generated nested stamp is allowed');
  fs.writeFileSync(path.join(scratch, 'meet-source.txt'), 'uncommitted newer Meet source\n');
  assert.notEqual(stamp().status, 0, 'dirty tracked sibling source blocks stamp');
  git('checkout', '--', 'meet-source.txt');
  fs.writeFileSync(path.join(scratch, 'unreviewed-source.txt'), 'unreviewed\n');
  assert.notEqual(stamp().status, 0, 'untracked sibling source blocks stamp');
  fs.unlinkSync(path.join(scratch, 'unreviewed-source.txt'));
  fs.writeFileSync(path.join(component, 'server/changed.js'), 'modified runtime\n');
  assert.notEqual(stamp().status, 0, 'dirty component source blocks stamp');
  const verified = spawnSync(process.execPath, ['scripts/release-identity.js', 'verify-if-stamped'], { cwd: component, encoding: 'utf8' });
  assert.notEqual(verified.status, 0, 'runtime tampering fails verification');
  console.log('CANONICAL_RELEASE_PASS: root identity, wrong SHA, sibling dirt, generated stamp, runtime tamper');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
