/* {{NAME}} view (Game Kit 3D starter): mount/update/dispose lifecycle on
 * the shared three-view helper. RENDER + INPUT live here; the server owns
 * all positions/scores. Sends {input:{steer,throttle}} on change + a slow
 * heartbeat; falls back to a 2D canvas on the SAME snapshots when WebGL
 * cannot start. */
import { esc } from '../util.js';
import { createThreeView } from '../renderers/three-view.js';

const COLORS = [0x8b7bff, 0x2fd08c, 0xff6b5e, 0x57b6ff, 0xffd54a, 0xff7ad9, 0xc6f24e, 0x4fd6c4];

let S = null;
let apiRef = null;
let rootEl = null;
let mountGen = 0;
let handle = null;
let keys = new Set();
let lastSent = '';
let sendTimer = 0;
let bound = [];
let fb = null; // {canvas, raf} in 2D fallback

function on(t, type, fn, opts) {
  if (!t || !t.addEventListener) return;
  t.addEventListener(type, fn, opts);
  bound.push([t, type, fn, opts]);
}

function nameOf(pid) {
  const p = ((S && (S.players || S.participants)) || []).find((q) => q.id === pid);
  return p ? p.name : '???';
}

function sendInput() {
  if (!S || !apiRef || !S.youDrive || S.phase !== 'drive') return;
  const intent = {
    steer: (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0),
    throttle: (keys.has('up') ? 1 : 0) - (keys.has('down') ? 1 : 0),
  };
  const key = intent.steer + ',' + intent.throttle;
  if (key === lastSent) return;
  lastSent = key;
  apiRef.send({ input: intent, t: Date.now() });
}

function keyName(e) {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') return 'left';
  if (e.code === 'ArrowRight' || e.code === 'KeyD') return 'right';
  if (e.code === 'ArrowUp' || e.code === 'KeyW') return 'up';
  if (e.code === 'ArrowDown' || e.code === 'KeyS') return 'down';
  return null;
}

function paintHud() {
  if (!rootEl || !S) return;
  const hud = rootEl.querySelector('.d3-hud');
  if (!hud) return;
  const rows = [...(S.orbs || [])].sort((a, b) => b.dots - a.dots);
  hud.innerHTML = `<span class="pk-chip">${S.phase === 'done' ? 'Finished' : 'Collect the dots'}</span>` +
    rows.map((o) => `<span class="pk-chip${o.pid === S.you ? ' pk-me' : ''}">` +
      `${esc(nameOf(o.pid))} · ${o.dots}</span>`).join('') +
    (S.phase === 'done' && S.result && S.result.winner
      ? `<span class="pk-chip pk-me">${esc(nameOf(S.result.winner))} wins!</span>` : '');
}

async function mount3d() {
  const gen = mountGen;
  const stage = rootEl && rootEl.querySelector('.d3-stage');
  if (!stage) return;
  const h = await createThreeView(stage, { build: buildScene });
  if (gen !== mountGen) {
    if (h && !h.fallback) h.dispose();
    return;
  }
  if (!h || h.fallback) {
    startFallback();
    return;
  }
  handle = h;
}

function buildScene(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(S && S.palette === 'Starlight' ? 0x101a33 : 0xa8d4f5);
  const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
  camera.position.set(0, 26, 20);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333355, 1));
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 44),
    new THREE.MeshStandardMaterial({ color: S && S.palette === 'Starlight' ? 0x1e2c52 : 0xd9e7f7, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const orbs = new Map();
  const dots = new Map();
  const orbGeo = new THREE.SphereGeometry(0.9, 20, 14);
  const dotGeo = new THREE.OctahedronGeometry(0.5);
  const dotMat = new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xcc8a00, emissiveIntensity: 0.8 });
  const frame = () => {
    if (!S) return;
    const live = new Set();
    (S.orbs || []).forEach((o, i) => {
      live.add(o.pid);
      let mesh = orbs.get(o.pid);
      if (!mesh) {
        mesh = new THREE.Mesh(orbGeo, new THREE.MeshStandardMaterial({
          color: COLORS[i % COLORS.length], roughness: 0.4 }));
        scene.add(mesh);
        orbs.set(o.pid, mesh);
      }
      mesh.position.set(o.x, 0.9, o.z); // starter snaps; lerp in real games
    });
    for (const [pid, mesh] of orbs) {
      if (!live.has(pid)) { scene.remove(mesh); orbs.delete(pid); }
    }
    const liveD = new Set();
    for (const d of S.dots || []) {
      liveD.add(d.id);
      if (!dots.get(d.id)) {
        const mesh = new THREE.Mesh(dotGeo, dotMat);
        mesh.position.set(d.x, 0.6, d.z);
        scene.add(mesh);
        dots.set(d.id, mesh);
      }
    }
    for (const [did, mesh] of dots) {
      if (!liveD.has(did)) { scene.remove(mesh); dots.delete(did); }
    }
  };
  return { scene, camera, frame };
}

function startFallback() {
  const stage = rootEl && rootEl.querySelector('.d3-stage');
  if (!stage) return;
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 360;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Top-down starter view.');
  stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let raf = 0;
  const loop = () => {
    if (!S) return;
    ctx.fillStyle = '#14101f';
    ctx.fillRect(0, 0, 480, 360);
    for (const d of S.dots || []) {
      ctx.fillStyle = '#ffd54a';
      ctx.beginPath();
      ctx.arc(240 + d.x * 9, 180 + d.z * 9, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    (S.orbs || []).forEach((o, i) => {
      ctx.fillStyle = '#' + COLORS[i % COLORS.length].toString(16).padStart(6, '0');
      ctx.beginPath();
      ctx.arc(240 + o.x * 9, 180 + o.z * 9, 9, 0, Math.PI * 2);
      ctx.fill();
    });
    raf = requestAnimationFrame(loop);
    if (fb) fb.raf = raf;
  };
  fb = { canvas, raf: requestAnimationFrame(loop) };
}

function disposeAll() {
  mountGen += 1;
  if (sendTimer) { clearInterval(sendTimer); sendTimer = 0; }
  for (const [t, type, fn, opts] of bound) {
    try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
  }
  bound = [];
  if (handle) {
    try { handle.dispose(); } catch { /* noop */ }
    handle = null;
  }
  if (fb) {
    try { cancelAnimationFrame(fb.raf); } catch { /* noop */ }
    try { fb.canvas.remove(); } catch { /* noop */ }
    fb = null;
  }
  S = null;
  apiRef = null;
  rootEl = null;
  keys = new Set();
  lastSent = '';
}

export default {
  mount(el, api) {
    disposeAll();
    mountGen += 1;
    apiRef = api;
    rootEl = el;
    el.innerHTML = '<div class="d3"><div class="d3-stage"></div><div class="d3-hud pk-top"></div></div>';
    on(window, 'keydown', (e) => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      const k = keyName(e);
      if (!k) return;
      e.preventDefault();
      if (!keys.has(k)) { keys.add(k); sendInput(); }
    });
    on(window, 'keyup', (e) => {
      const k = keyName(e);
      if (k && keys.delete(k)) sendInput();
    });
    on(window, 'blur', () => { keys = new Set(); lastSent = ''; sendInput(); });
    sendTimer = setInterval(sendInput, 500);
    mount3d();
  },

  update(el, Snew, api) {
    S = Snew;
    apiRef = api;
    rootEl = el;
    paintHud();
  },

  dispose() {
    disposeAll();
  },
};
