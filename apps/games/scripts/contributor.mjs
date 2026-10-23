#!/usr/bin/env node
// Contributor setup and an authenticated, encrypted transfer of app env only.
// Personal CLI sessions and unrelated service credentials are never exported.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = 'giggle-games-env-v1';
const MAX_BYTES = 128 * 1024;
function publicError(message) { return Object.assign(new Error(message), { userFacing: true }); }
export const ENV_KEYS = [
  'NODE_ENV', 'HOST', 'PORT', 'PUBLIC_GAME_URL', 'PUBLIC_WEBSOCKET_URL',
  'STANDALONE_ALLOWED_ORIGINS', 'GAME_BRIDGE_SECRET', 'GIGGLE_ALLOWED_ORIGINS',
];
const RAILWAY = {
  project: '2e301782-c882-4553-94e4-61b898d98f1f',
  service: '163cf83c-20a2-40f1-8795-d503a9c7840b',
  environment: 'bd367c27-b9f2-4715-a40c-842f19a1f66c',
};

function keyFor(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) throw publicError('Use a passphrase of at least 16 characters.');
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export function selectEnvironment(values, strict = true) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw publicError('Invalid environment configuration.');
  if (strict && Object.keys(values).some(k => !ENV_KEYS.includes(k))) {
    throw publicError('The source contains variables outside the game service allowlist. Personal tokens are not transferable.');
  }
  const selected = {};
  for (const key of ENV_KEYS) {
    if (values[key] === null) throw publicError('A selected variable is sealed; obtain it privately from the service owner.');
    if (values[key] !== undefined) {
      if (typeof values[key] !== 'string' || /[\r\n\0]/.test(values[key])) throw publicError('Unsupported environment value.');
      selected[key] = values[key];
    }
  }
  if (!Object.keys(selected).length) throw publicError('No game service variables found.');
  if (selected.GAME_BRIDGE_SECRET && selected.GAME_BRIDGE_SECRET.length < 32) throw publicError('The bridge secret must have at least 32 characters.');
  return selected;
}
export function sealEnvironment(values, passphrase) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = keyFor(passphrase, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(FORMAT));
    const plain = Buffer.from(JSON.stringify({ environment: selectEnvironment(values), createdAt: new Date().toISOString() }));
    if (plain.length > MAX_BYTES / 2) throw publicError('Environment is too large.');
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    plain.fill(0);
    return JSON.stringify({ format: FORMAT, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }) + '\n';
  } finally { key.fill(0); }
}
export function openEnvironment(text, passphrase) {
  if (Buffer.byteLength(text) > MAX_BYTES) throw publicError('Bundle is too large.');
  let key;
  try {
    const bundle = JSON.parse(text);
    if (bundle.format !== FORMAT) throw publicError();
    const [salt, iv, tag, ciphertext] = ['salt', 'iv', 'tag', 'ciphertext'].map(k => {
      if (typeof bundle[k] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(bundle[k])) throw publicError();
      return Buffer.from(bundle[k], 'base64');
    });
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw publicError();
    key = keyFor(passphrase, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(FORMAT));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    try { return selectEnvironment(JSON.parse(plain.toString('utf8')).environment); }
    finally { plain.fill(0); }
  } catch { throw publicError('Cannot open bundle: incorrect passphrase or damaged file.'); }
  finally { key?.fill(0); }
}
export function environmentText(values) {
  // Double-quoted dotenv escapes are intentionally avoided: Node preserves
  // literal backslashes. Single quotes are simplest for these service values.
  return ENV_KEYS.filter(k => values[k] !== undefined).map(k => {
    const value = values[k];
    if (value.includes("'")) throw publicError('Single quotes are not supported in exported service values.');
    return `${k}='${value}'`;
  }).join('\n') + '\n';
}
function readBounded(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw publicError('Expected a regular file smaller than 128 KiB.');
  return fs.readFileSync(file, 'utf8');
}
function writePrivate(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' });
}
async function hiddenPassphrase(label) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw publicError('Use an interactive terminal or --passphrase-file with a private file.');
  process.stdout.write(label);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let text = '';
    const finish = error => {
      process.stdin.removeListener('keypress', handler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(text);
    };
    const handler = (str, key) => {
      if (key.ctrl && key.name === 'c') return finish(publicError('Cancelled.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') text = [...text].slice(0, -1).join('');
      else if (str && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(str)) text += str;
    };
    process.stdin.on('keypress', handler);
  });
}
async function passphraseFor(options, confirm = false) {
  if (options['passphrase-file']) {
    const file = path.resolve(options['passphrase-file']);
    const stat = fs.lstatSync(file);
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw publicError('Passphrase file must be private: chmod 600 <file>.');
    return readBounded(file).replace(/\r?\n$/, '');
  }
  const passphrase = await hiddenPassphrase('Bundle passphrase (hidden): ');
  if (confirm && passphrase !== await hiddenPassphrase('Confirm passphrase (hidden): ')) throw publicError('Passphrases do not match.');
  return passphrase;
}
function npm(args) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}
async function restoreBundle(options) {
  const env = openEnvironment(readBounded(path.resolve(options.bundle)), await passphraseFor(options));
  writePrivate(path.join(ROOT, '.env.production'), '# Private maintainer configuration. Not used by local development.\n' + environmentText(env));
  console.log('Restored .env.production privately. Local development still uses .env.');
}
export async function main(argv = process.argv.slice(2)) {
  const { values: options, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    from: { type: 'string' }, out: { type: 'string' }, bundle: { type: 'string' },
    'passphrase-file': { type: 'string' }, railway: { type: 'boolean' }, bridge: { type: 'boolean' },
    'skip-install': { type: 'boolean' }, check: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  const command = positionals[0];
  if (options.help || !command) {
    console.log('Contributor: node scripts/contributor.mjs setup [--bridge] [--bundle <file>] [--check]\nMaintainer:  node scripts/contributor.mjs export (--railway | --from <env-file>) --out <private-file>\nRestore:     node scripts/contributor.mjs import --bundle <file>\nBundle passphrases are entered privately; automation may use --passphrase-file <600-mode file>.');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) !== 24) throw publicError('Install Node.js 24 LTS for this project.');
  if (command === 'setup') {
    if (options.from || options.railway || options.out) throw publicError('Export flags cannot be used during setup.');
    const local = path.join(ROOT, '.env');
    if (!fs.existsSync(local)) {
      const env = { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '8123', PUBLIC_GAME_URL: '', PUBLIC_WEBSOCKET_URL: '', STANDALONE_ALLOWED_ORIGINS: '', GAME_BRIDGE_SECRET: options.bridge ? randomBytes(32).toString('hex') : '', GIGGLE_ALLOWED_ORIGINS: options.bridge ? 'http://localhost:3000,http://127.0.0.1:3000' : '' };
      writePrivate(local, '# Contributor local environment. Never commit this file.\n' + environmentText(env));
      console.log('Created .env for isolated local games' + (options.bridge ? ' and the local Giggle bridge.' : '.'));
    } else {
      console.log('Kept the existing .env unchanged.');
      if (options.bridge) console.log('To enable the local bridge, configure your existing .env as described in CONTRIBUTING.md.');
    }
    if (options.bundle) await restoreBundle(options);
    if (!options['skip-install']) { npm(['ci']); npm(['run', 'build']); }
    if (options.check) npm(['run', 'test:smoke']);
    console.log('Ready: npm run dev:local, then open http://127.0.0.1:8123.');
  } else if (command === 'import') {
    if (!options.bundle) throw publicError('Specify --bundle <file>.');
    await restoreBundle(options);
  } else if (command === 'export') {
    if (!options.out || !!options.from === !!options.railway) throw publicError('Specify --out and exactly one of --from or --railway.');
    const destination = path.resolve(options.out);
    const realParent = fs.realpathSync(path.dirname(destination));
    const relative = path.relative(fs.realpathSync(ROOT), realParent);
    if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw publicError('Save credential bundles outside the repository.');
    let env;
    if (options.railway) {
      try {
        const raw = execFileSync('railway', ['variable', 'list', '--project', RAILWAY.project, '--service', RAILWAY.service, '--environment', RAILWAY.environment, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BYTES });
        env = selectEnvironment(JSON.parse(raw), false);
      } catch { throw publicError('Cannot read the game service configuration. Sign into Railway with your own authorized account.'); }
    } else { env = selectEnvironment(parseEnv(readBounded(path.resolve(options.from)))); }
    writePrivate(path.join(realParent, path.basename(destination)), sealEnvironment(env, await passphraseFor(options, true)));
    console.log('Encrypted game-service environment saved privately. Share its passphrase separately with an authorized maintainer.');
  } else { throw publicError('Unknown command. Use --help.'); }
}
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // No raw child-process error, dotenv values, decrypted payload, or
    // credential-bearing argument is ever printed by this command.
    console.error(error.userFacing ? error.message : 'Handover failed. Check Node 24, npm, private file permissions, existing destination files, and service access. Use --help or CONTRIBUTING.md.');
    process.exitCode = 1;
  });
}
