'use strict';
/* Game Kit scaffolder core: renders scripts/templates/* into a target root.
 * Shared by scripts/new-game.js (repo use) and sdk/cli.js (packed-kit use,
 * where kitRoot is the unpacked kit directory). Throws on failure.
 *
 * Writes a game's server, locale and optional module view or owned browser
 * and home exports, plus framework requires into roots outside the kit
 * (never into the kit/repo itself). Refuses overwrites; ids are validated
 * and every destination is verified to stay under the target root. */

const fs = require('fs');
const path = require('path');

const KIT_VERSION = '0.1.38';
const TEMPLATES = ['starter', '3d', 'kart', 'camera', 'frame'];

function titleCase(id) {
  return id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function templateFiles(template) {
  if (template === 'kart') {
    return {
      serverTpl: 'scripts/templates/kart-server.js.tpl',
      clientTpl: 'scripts/templates/kart-client.js.tpl',
      localeTpl: 'scripts/templates/kart-locale.json.tpl',
    };
  }
  if (template === 'camera') {
    return {
      serverTpl: 'scripts/templates/camera-server.js.tpl',
      clientTpl: 'scripts/templates/camera-client.js.tpl',
      localeTpl: 'scripts/templates/camera-locale.json.tpl',
    };
  }
  if (template === '3d') {
    return {
      serverTpl: 'scripts/templates/server-3d.js.tpl',
      clientTpl: 'scripts/templates/client-3d.js.tpl',
      localeTpl: 'scripts/templates/locale.json.tpl',
    };
  }
  return {
    serverTpl: 'scripts/templates/server.js.tpl',
    clientTpl: 'scripts/templates/client.js.tpl',
    localeTpl: 'scripts/templates/locale.json.tpl',
  };
}

function copyIfMissing(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/* Every scaffold destination must resolve inside the target root. Ids are
 * already restricted to [a-z0-9-], so this is defense in depth. */
function safeJoin(root, rel) {
  const dest = path.join(root, rel);
  const back = path.relative(root, dest);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) {
    throw new Error(`refusing to write outside the target root: ${rel}`);
  }
  return dest;
}

function generate(id, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (o.root !== undefined && (typeof o.root !== 'string' || !o.root)) {
    throw new Error('root must be a non-empty path string.');
  }
  const root = o.root ? path.resolve(o.root) : path.join(__dirname, '..');
  const kitRoot = o.kitRoot ? path.resolve(o.kitRoot) : path.join(__dirname, '..');
  const template = o.template || 'starter';
  const { isValidId } = require(path.join(kitRoot, 'games', '_validate'));
  if (!isValidId(id)) throw new Error(`"${id}" is not a safe id (2-40 chars, lowercase letters/digits/dashes).`);
  if (!TEMPLATES.includes(template)) throw new Error(`unknown template "${template}" (want ${TEMPLATES.join('/')}).`);
  const { serverTpl, clientTpl, localeTpl } = templateFiles(template);
  const targets = [
    [serverTpl, `games/${id}/server.js`],
    [clientTpl, `public/js/games/${id}.js`],
    [localeTpl, `locales/en/${id}.json`],
  ];
  if (template === 'frame') {
    targets.splice(1, 1);
    targets.push(
      ['scripts/templates/frame.html.tpl', `games/${id}/browser/index.html`],
      ['scripts/templates/frame-play.js.tpl', `games/${id}/browser/play.js`],
      ['scripts/templates/frame.css.tpl', `games/${id}/browser/play.css`],
      ['scripts/templates/home.html.tpl', `games/${id}/home/index.html`],
      ['scripts/templates/frame.css.tpl', `games/${id}/home/home.css`],
    );
  }
  const dests = targets.map(([, rel]) => safeJoin(root, rel));
  for (const dest of dests) {
    if (fs.existsSync(dest)) {
      throw new Error(`refusing to overwrite existing ${path.relative(root, dest)}`);
    }
  }
  const name = titleCase(id);
  for (let i = 0; i < targets.length; i++) {
    const src = fs.readFileSync(path.join(kitRoot, targets[i][0]), 'utf8');
    const out = src.replace(/{{ID}}/g, id).replace(/{{NAME}}/g, name)
      .replace('__PRESENTATION__', template === 'frame' ? "homepage: true, runtime: { type: 'frame', entry: 'index.html' }, layout: 'immersive'," : '');
    fs.mkdirSync(path.dirname(dests[i]), { recursive: true });
    fs.writeFileSync(dests[i], out);
  }
  if (path.resolve(root) !== path.resolve(kitRoot)) {
    // Outside the kit (tests, consumer projects): copy the framework
    // requires so the scaffold loads standalone. Thin games stay thin —
    // no engine source is copied into the generated game files.
    for (const f of ['_sdk.js', '_validate.js']) {
      copyIfMissing(path.join(kitRoot, 'games', f), path.join(root, 'games', f));
    }
    copyIfMissing(
      path.join(kitRoot, 'public', 'js', 'util.js'),
      path.join(root, 'public', 'js', 'util.js'));
    if (template === 'frame') {
      for (const f of ['game-client.js', 'game-protocol.mjs']) copyIfMissing(
        path.join(kitRoot, 'public', 'js', f), path.join(root, 'public', 'js', f));
    }
    if (template === '3d' || template === 'kart') {
      copyIfMissing(
        path.join(kitRoot, 'public', 'js', 'renderers', 'three-view.js'),
        path.join(root, 'public', 'js', 'renderers', 'three-view.js'));
    }
    if (template === 'kart' || template === 'camera') {
      for (const f of fs.readdirSync(path.join(kitRoot, 'games', 'engines'))) {
        if (f.endsWith('.js')) {
          copyIfMissing(
            path.join(kitRoot, 'games', 'engines', f),
            path.join(root, 'games', 'engines', f));
        }
      }
    }
    if (template === 'kart') {
      for (const f of ['kart-view.js', 'kart-pose.mjs', 'kart-physics-config.mjs']) {
        copyIfMissing(
          path.join(kitRoot, 'public', 'js', 'engines', f),
          path.join(root, 'public', 'js', 'engines', f));
      }
    }
    if (template === 'camera') {
      copyIfMissing(
        path.join(kitRoot, 'public', 'js', 'toolkit', 'camera-party.js'),
        path.join(root, 'public', 'js', 'toolkit', 'camera-party.js'));
      copyIfMissing(
        path.join(kitRoot, 'public', 'css', 'camera-party.css'),
        path.join(root, 'public', 'css', 'camera-party.css'));
    }
  }
  return { id, root, template, files: targets.map(([, rel]) => rel) };
}

module.exports = { KIT_VERSION, TEMPLATES, generate, titleCase, templateFiles };
