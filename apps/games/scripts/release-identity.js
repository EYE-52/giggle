'use strict';

// Stamp once, after the build, from a clean reviewed commit. Both hosts ship
// this file; /config.json additionally identifies the actual Railway process.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'public/release.json');
const OMIT = new Set(['public/release.json', 'public/test', 'public/fixtures', 'sdk/dist']);

function buildHash(root = ROOT) {
  const files = [];
  function visit(rel) {
    if (OMIT.has(rel)) return;
    const file = path.join(root, rel);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Symlink in release: ' + rel);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(file).sort()) visit(rel + '/' + child);
    } else if (stat.isFile()) files.push(rel);
  }
  for (const rel of ['server', 'games', 'locales', 'public', 'scripts', 'sdk',
    'package.json', 'package-lock.json', 'railway.json', 'vercel.json']) visit(rel);
  const hash = crypto.createHash('sha256');
  for (const rel of files.sort()) {
    const bytes = fs.readFileSync(path.join(root, rel));
    hash.update(rel + '\0' + bytes.length + '\0');
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function validate(manifest) {
  if (manifest?.schema !== 1 || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit || '') ||
      !/^[0-9a-f]{64}$/.test(manifest.buildSha256 || '') || typeof manifest.version !== 'string') {
    throw Error('Missing or invalid release identity');
  }
  return manifest;
}

function read(root = ROOT) {
  const file = path.join(root, 'public/release.json');
  if (!fs.existsSync(file)) return null; // ordinary unstamped local development
  const manifest = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (manifest.version !== require(path.join(root, 'package.json')).version || manifest.buildSha256 !== buildHash(root)) {
    throw Error('Release bytes differ from the stamped build');
  }
  return manifest;
}

function stamp() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const sourceCommit = git('rev-parse', 'HEAD');
  if (process.env.RELEASE_SOURCE_SHA !== sourceCommit) throw Error('RELEASE_SOURCE_SHA must equal the checked-out commit');
  const gitRoot = git('rev-parse', '--show-toplevel');
  const stampPath = path.relative(gitRoot, MANIFEST).split(path.sep).join('/');
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=normal', '--', '.', ':!' + stampPath], { cwd: gitRoot, encoding: 'utf8' }).trim()) throw Error('Stamp a clean source checkout after building');
  const manifest = { schema: 1, version: require('../package.json').version, sourceCommit, buildSha256: buildHash() };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (require.main === module) {
  try {
    const manifest = process.argv[2] === 'stamp' ? stamp() : read();
    if (!manifest && process.argv[2] !== 'verify-if-stamped') throw Error('Release has not been stamped');
    console.log(manifest ? JSON.stringify(manifest) : 'Unstamped local build');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildHash, validate, read };
