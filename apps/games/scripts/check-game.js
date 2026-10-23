'use strict';
/* Honest per-game checks: loads, manifest, locale, view smoke, hygiene.
 * Run: npm run check-game -- <id> [--root <dir>]
 * Exit 0 + CHECK_PASS on success; exit 1 + CHECK_FAIL with reasons. */

const fs = require('fs');
const { isBuiltin } = require('module');
const path = require('path');
const { isValidId, validateManifest, manifestPlayers } = require('../games/_validate');

const failures = [];
const warnings = [];
function bad(msg) {
  failures.push(msg);
  console.error('  FAIL', msg);
}
function warn(msg) {
  warnings.push(msg);
  console.log('  WARN', msg);
}
function good(msg) {
  console.log('  ok', msg);
}

function stubCtx(content) {
  const players = [
    { id: 'pa', name: 'Ann' },
    { id: 'pb', name: 'Bob' },
    { id: 'pc', name: 'Cat' },
  ];
  return {
    _players: players,
    players: () => players.slice(),
    allPlayers: () => players.slice(),
    content: () => content,
    settings: () => ({}),
    hostId: () => 'pa',
    broadcast: () => {},
    lobby: () => {},
    later: () => () => {},
    award: () => {},
    now: () => Date.now(),
  };
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  let root = path.join(__dirname, '..');
  let id = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      root = path.resolve(args[++i] || '');
    } else if (!id) {
      id = args[i];
    }
  }
  if (!id) {
    console.error('CHECK_FAIL usage: npm run check-game -- <id>');
    process.exit(1);
  }
  console.log(`check-game: ${id}`);
  if (!isValidId(id)) {
    console.error(`CHECK_FAIL "${id}" is not a safe id.`);
    process.exit(1);
  }

  // 1. Server module loads with the right shape.
  const serverFile = path.join(root, 'games', id, 'server.js');
  if (!fs.existsSync(serverFile)) {
    console.error(`CHECK_FAIL missing ${path.relative(root, serverFile)}`);
    process.exit(1);
  }
  let def;
  try {
    def = require(serverFile);
    good('server module loads');
  } catch (e) {
    console.error(`CHECK_FAIL server module threw: ${e.message}`);
    process.exit(1);
  }
  if (!def || def.id !== id) bad(`module id is ${JSON.stringify(def && def.id)}, want "${id}"`);
  for (const fn of ['create', 'onAction', 'view']) {
    if (typeof def[fn] !== 'function') bad(`missing export ${fn}()`);
  }
  if (def.onTick !== undefined && typeof def.onTick !== 'function') bad('onTick must be a function');
  if (def.dispose !== undefined && typeof def.dispose !== 'function') bad('dispose must be a function');

  // 2. Manifest.
  const mv = validateManifest(def);
  if (!mv.ok) bad('manifest: ' + mv.error);
  else if (!def.manifest) warn('no manifest (legacy registry fallback; new games should add one)');
  else good('manifest valid');
  const { min, max } = manifestPlayers(def);
  good(`players ${min}–${max}`);

  // 3. Locale pack.
  const localeFile = path.join(root, 'locales', 'en', `${id}.json`);
  let locale = {};
  if (!fs.existsSync(localeFile)) {
    warn('no locales/en/' + id + '.json (needed when the game uses content)');
  } else {
    try {
      locale = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
      good('locale JSON valid');
    } catch (e) {
      bad('locale JSON invalid: ' + e.message);
    }
    const packs = (def.manifest && def.manifest.packs) || {};
    for (const k of Object.keys(packs)) {
      const arr = locale[k];
      if (!Array.isArray(arr)) bad(`locale missing "${k}" array declared by manifest.packs`);
      else if (arr.length < (packs[k].minItems || 1)) bad(`locale "${k}" has ${arr.length} items, minItems is ${packs[k].minItems}`);
      else good(`locale "${k}": ${arr.length} items`);
    }
    const total = Object.values(locale).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
    if (total > 0 && total < 20) bad(`content bar: only ${total} locale entries, want ≥20`);
    else if (total >= 20) good(`content bar: ${total} locale entries`);
  }

  // 4. Client view exists + hygiene scan.
  const frame = def.manifest?.runtime?.type === 'frame';
  const clientFile = frame ? path.join(root, 'games', id, 'browser', def.manifest.runtime.entry) : path.join(root, 'public', 'js', 'games', `${id}.js`);
  if (!fs.existsSync(clientFile)) {
    bad('missing browser entry ' + path.relative(root, clientFile));
  } else {
    const src = fs.readFileSync(clientFile, 'utf8');
    if (frame) {
      if (!/<!doctype html/i.test(src)) bad('browser entry must be a complete HTML document');
      else good('game-owned browser document present (any engine, own styles)');
    } else if (!/export\s+default/.test(src)) bad('client has no default export');
    else good('client default export present');
    if (!frame) {
      if (/\beval\s*\(|\bFunction\s*\(/.test(src)) bad('client uses eval/Function');
      const reviewLines = [];
      const STRINGY = /\b(name|text|guess|answer|prompt|word|msg|message|choice|option|title|label|phrase|dare|truth|take|story|sentence|compliment|roast)\b/i;
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        for (const m of line.matchAll(/\$\{([^{}]*)\}/g)) {
          const expr = m[1];
          if (/esc\s*\(|encodeURIComponent/.test(expr)) continue;
          if (STRINGY.test(expr)) reviewLines.push(`${i + 1}: ${expr.trim().slice(0, 60)}`);
        }
      });
      if (reviewLines.length) {
        warn(`${reviewLines.length} client interpolation(s) of string-ish values without esc() — review for XSS (${reviewLines.slice(0, 5).join('; ')}${reviewLines.length > 5 ? '…' : ''})`);
      } else {
        good('client interpolation scan clean');
      }
      // Remote/bare imports: 3D views must use the pinned local vendor copy
      // (or the shared ../renderers helper) — never a CDN or bare specifier.
      if (/from\s+['"]https?:\/\//.test(src) || /import\(\s*['"]https?:\/\//.test(src)) {
        bad('client imports a remote URL (use /vendor/three/* or ../renderers/*)');
      }
      if (/from\s+['"]three['"]/.test(src)) {
        bad("client imports bare 'three' (use /vendor/three/three.module.js served locally)");
      }
    }
    const serverSrc = fs.readFileSync(serverFile, 'utf8');
    const reqs = [...serverSrc.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    /* Approved SHARED dependencies, keyed by DEPENDENCY — not by game id.
     * Any game (chess, a variant board, …) may require a framework-reviewed
     * pinned library; a game can never approve itself (no manifest flag).
     * Anything else is rejected. The pin is enforced against the root
     * package.json (exact version, no ranges).
     *
     * Approved SHARED engine path, keyed by PATH — not by game id: any
     * game may require the framework-reviewed games/engines/* modules
     * (the kart-arena factory and its rule/map modules). Same-game
     * requires (./helper) stay rejected: a game's extra files are not a
     * reviewed surface, so thin games inline their config instead. */
    const SHARED_DEPS = {
      'chess.js': '1.4.0', // pinned rules library, framework-reviewed
    };
    const sharedPinOk = (name) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        return !!pkg && !!pkg.dependencies && pkg.dependencies[name] === SHARED_DEPS[name];
      } catch {
        return false;
      }
    };
    const sharedNames = Object.keys(SHARED_DEPS).join(', ');
    for (const r of reqs) {
      if (r === '../_sdk' || r === '../_validate') continue;
      if (isBuiltin(r)) continue; // documented Node stdlib allowance, honest
      if (SHARED_DEPS[r]) {
        if (sharedPinOk(r)) continue;
        bad(`server requires "${r}" but the root package.json does not pin exactly ${SHARED_DEPS[r]}`);
        continue;
      }
      const eng = r.match(/^\.\.\/engines\/([A-Za-z0-9_.-]+)$/);
      if (eng) {
        // Extensionless requires resolve to .js (Node default).
        const base = path.join(root, 'games', 'engines', eng[1]);
        const target = base.endsWith('.js') ? base : base + '.js';
        if (target.endsWith('.js') && fs.existsSync(target)) continue;
        bad(`server requires "${r}" but that engine file is missing (copy games/engines/*.js alongside)`);
        continue;
      }
      bad(`server requires "${r}" (only ../_sdk, ../_validate, node stdlib, ../engines/*, shared ${sharedNames} allowed)`);
    }
    if (!failures.length) good('dependency scan clean');
  }

  if (def.manifest?.homepage) {
    const home = path.join(root, 'games', id, 'home', 'index.html');
    if (!fs.existsSync(home)) bad('missing game-owned home/index.html');
    else if (!/<!doctype html/i.test(fs.readFileSync(home, 'utf8'))) bad('game home must be a complete HTML document');
    else good('game-owned home present');
  }

  // 5. Lifecycle smoke: create + garbage actions + two-pid views.
  try {
    const ctx = stubCtx(locale);
    const state = def.create(ctx);
    if (!state || typeof state !== 'object') bad('create() did not return a state object');
    else {
      good('create() returns state');
      const pids = ['pa', 'pb'];
      // Same normalization as room.onAction (a || {}): null/undefined
      // arrive as {}. Strings/numbers DO reach games, so they must not throw.
      for (const a of [{}, { vote: 'a' }, { guess: 'x' }, { next: true }, { text: 'hi' }, 'nope', 42, [1]]) {
        for (const pid of pids) def.onAction(state, ctx, pid, a || {});
      }
      good('onAction() survives garbage');
      if (def.onTick) {
        def.onTick(state, ctx);
        good('onTick() runs');
      }
      for (const pid of pids) {
        const v = def.view(state, pid);
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
          bad(`view(state, ${pid}) did not return an object`);
        }
      }
      if (!failures.length) good('view() smoke for two pids');
      if (def.dispose) {
        def.dispose(state);
        good('dispose() runs');
      }
    }
  } catch (e) {
    bad('lifecycle smoke threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
  }

  if (failures.length) {
    console.error(`CHECK_FAIL ${id} (${failures.length} problem${failures.length > 1 ? 's' : ''})`);
    process.exit(1);
  }
  console.log(`CHECK_PASS ${id}${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}`);
}

main();
