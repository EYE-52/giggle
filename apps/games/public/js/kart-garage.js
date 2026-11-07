/* Pocket Karts garage: each player picks their kart paint and animal
 * driver before a match. The look is remembered on this device, sent to
 * the room ({ t: 'kart', look }) and drawn by every arena view. The
 * preview is a small Three.js turntable; driver cards get portraits
 * rendered from the same scene. Without WebGL the cards keep their emoji
 * and the stage shows a flat paint badge, and picking still works. */
import { esc, store } from './util.js';
import { confetti, reducedMotion, sound } from './fx.js';
import { KART_LOOK_DRIVERS, KART_PAINTS, cleanKartLook, kartPaintHex } from './engines/kart-looks.mjs';

const KEY = 'pb_kart';
let state = null;

export function loadKartLook() {
  try { return cleanKartLook(JSON.parse(store.get(KEY) || 'null')); } catch { return null; }
}

export function saveKartLook(look) {
  const clean = cleanKartLook(look);
  if (clean) store.set(KEY, JSON.stringify(clean));
  return clean;
}

const hex = n => '#' + n.toString(16).padStart(6, '0');
const driverOf = id => KART_LOOK_DRIVERS.find(d => d.id === id) || KART_LOOK_DRIVERS[0];
const paintOf = id => KART_PAINTS.find(p => p.id === id) || KART_PAINTS[0];

/* A small paint dot with the driver's face, for roster seats. */
export function kartLookBadgeHtml(look) {
  const clean = cleanKartLook(look);
  if (!clean) return '';
  const d = clean.driver ? driverOf(clean.driver) : null, p = clean.paint ? paintOf(clean.paint) : null;
  const label = [d?.name, p && `${p.name} kart`].filter(Boolean).join(' · ');
  return `<span class="kart-badge" style="--kart-paint:${p ? hex(p.hex) : 'var(--well)'}" title="${esc(label)}" aria-label="${esc(label)}">${d ? d.emoji : ''}</span>`;
}

/* The "Your kart" card for menus: a tappable summary that opens the garage. */
export function kartGarageCardHtml(look, id = 'bKartGarage') {
  const clean = cleanKartLook(look) || {};
  const d = driverOf(clean.driver), p = paintOf(clean.paint);
  const chosen = !!(clean.driver || clean.paint);
  return `<button type="button" class="garage-card" id="${id}" style="--kart-paint:${hex(p.hex)}">
    <span class="garage-card-face" aria-hidden="true">${chosen ? d.emoji : '🏎️'}</span>
    <span class="garage-card-text"><b>Your kart</b><span>${chosen ? `${esc(d.name)} · ${esc(p.name)}` : 'Pick a driver and paint'}</span></span>
    <span class="garage-card-go" aria-hidden="true">›</span></button>`;
}

export function isKartGarageOpen() { return !!state; }

export function closeKartGarage({ returnFocus = true } = {}) {
  if (!state) return;
  const s = state;
  state = null;
  cancelAnimationFrame(s.raf);
  clearTimeout(s.readyTimer);
  s.stage?.dispose();
  s.el.close?.();
  s.el.remove();
  if (returnFocus && s.opener && s.opener.isConnected) {
    try { s.opener.focus({ preventScroll: true }); } catch { s.opener.focus(); }
  }
}

/* onReady(look) sends the look; it returns false when offline, and the
 * garage then keeps the choice on this device and says so. */
export function openKartGarage({ look, name = '', opener, onReady } = {}) {
  closeKartGarage({ returnFocus: false });
  const start = cleanKartLook(look) || {};
  const pick = {
    driver: start.driver || KART_LOOK_DRIVERS[0].id,
    paint: start.paint || KART_PAINTS[0].id,
  };
  const el = document.createElement('dialog');
  el.className = 'garage-dlg';
  el.setAttribute('aria-labelledby', 'garageTitle');
  el.innerHTML = `
    <div class="garage-head">
      <div><p class="garage-kicker">Pocket Karts garage</p><h2 id="garageTitle">Your kart</h2></div>
      <button type="button" class="garage-x" id="garageClose" aria-label="Close garage"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></button>
    </div>
    <div class="garage-stage" id="garageStage">
      <canvas id="garageCanvas" width="640" height="360" aria-hidden="true"></canvas>
      <div class="garage-flat" aria-hidden="true"><span id="garageFlatFace"></span></div>
      <p class="garage-plate"><b id="garagePlateName">${esc(name || 'You')}</b><span id="garagePlateLook"></span></p>
      <p class="garage-stamp" id="garageStamp" aria-hidden="true">Ready!</p>
    </div>
    <section class="garage-sec" aria-labelledby="garageDriverH">
      <h3 id="garageDriverH">Driver</h3>
      <div class="garage-drivers" role="radiogroup" aria-labelledby="garageDriverH">
        ${KART_LOOK_DRIVERS.map(d => `<button type="button" class="garage-driver" role="radio" data-driver="${d.id}" aria-label="${esc(d.name)}: ${esc(d.blurb)}">
          <span class="garage-portrait"><img alt="" hidden><span class="garage-emoji" aria-hidden="true">${d.emoji}</span></span>
          <b>${esc(d.name)}</b><span class="garage-blurb">${esc(d.blurb)}</span></button>`).join('')}
      </div>
    </section>
    <section class="garage-sec" aria-labelledby="garagePaintH">
      <h3 id="garagePaintH">Paint</h3>
      <div class="garage-paints" role="radiogroup" aria-labelledby="garagePaintH">
        ${KART_PAINTS.map(p => `<button type="button" class="garage-paint" role="radio" data-paint="${p.id}" aria-label="${esc(p.name)}" title="${esc(p.name)}" style="--kart-paint:${hex(p.hex)}"></button>`).join('')}
      </div>
    </section>
    <div class="garage-foot"><p class="garage-note" id="garageNote" role="status"></p><button type="button" class="btn big garage-ready" id="garageReady">Ready!</button></div>`;
  document.body.append(el);
  state = { el, opener: opener || null, pick, raf: 0, readyTimer: 0, stage: null, onReady };

  const paint = () => {
    const d = driverOf(pick.driver), p = paintOf(pick.paint);
    for (const b of el.querySelectorAll('[data-driver]')) {
      const on = b.dataset.driver === pick.driver;
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
    }
    for (const b of el.querySelectorAll('[data-paint]')) {
      const on = b.dataset.paint === pick.paint;
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
    }
    el.style.setProperty('--kart-paint', hex(p.hex));
    el.querySelector('#garagePlateLook').textContent = `${d.name} · ${p.name}`;
    el.querySelector('#garageFlatFace').textContent = d.emoji;
    state?.stage?.show(pick.driver, p.hex);
  };
  const choose = (key, value) => {
    if (pick[key] === value) return;
    pick[key] = value;
    paint();
    const stage = el.querySelector('#garageStage');
    stage.classList.remove('is-swap'); void stage.offsetWidth; stage.classList.add('is-swap');
  };
  for (const group of el.querySelectorAll('[role="radiogroup"]')) {
    group.addEventListener('click', (e) => {
      const b = e.target.closest('[role="radio"]');
      if (!b) return;
      if (b.dataset.driver) choose('driver', b.dataset.driver);
      else choose('paint', b.dataset.paint);
    });
    group.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const items = [...group.querySelectorAll('[role="radio"]')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[n].click(); items[n].focus({ preventScroll: true });
    });
  }
  el.querySelector('#garageClose').onclick = () => closeKartGarage();
  el.addEventListener('click', (e) => { if (e.target === el) closeKartGarage(); });
  el.addEventListener('cancel', (e) => { e.preventDefault(); closeKartGarage(); });
  // Escape closes only the garage, never the setup sheet underneath it.
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
  el.querySelector('#garageReady').onclick = () => {
    if (el.classList.contains('is-ready')) return;
    const look = saveKartLook(pick);
    const sent = state.onReady ? state.onReady(look) !== false : false;
    el.querySelector('#garageNote').textContent = sent ? `${driverOf(look.driver).name} is ready to race.` : 'Saved on this device. It joins the room when you reconnect.';
    el.classList.add('is-ready');
    sound.unlock(); sound.cue('correct');
    if (!reducedMotion()) confetti(el.querySelector('#garageStage'), 28);
    state.readyTimer = setTimeout(() => closeKartGarage(), reducedMotion() ? 700 : 1500);
  };
  paint();
  el.showModal();
  const first = el.querySelector('[data-driver][aria-checked="true"]');
  try { first.focus({ preventScroll: true }); } catch { first.focus(); }
  startStage(state).then(stage => {
    if (!stage) { el.classList.add('is-flat'); return; }
    if (!state || state.el !== el) { stage.dispose(); return; }
    state.stage = stage;
    el.classList.add('is-live');
    stage.show(pick.driver, kartPaintHex(pick.paint));
    stage.portraits(el);
  });
}

/* The turntable. Resolves null without WebGL or assets. */
async function startStage(s) {
  const canvas = s.el.querySelector('#garageCanvas');
  let THREE, renderer;
  try {
    THREE = await import('/vendor/three/three.module.js');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch { return null; }
  try {
    const [{ GLTFLoader }, { mergeGeometries }, assetsMod, modelMod] = await Promise.all([
      import('/vendor/three/loaders/GLTFLoader.js'),
      import('/vendor/three/utils/BufferGeometryUtils.js'),
      import('./engines/kart-assets.mjs'),
      import('./engines/kart-model.mjs'),
    ]);
    await assetsMod.MeshoptDecoder.ready;
    const loader = new GLTFLoader().setMeshoptDecoder(assetsMod.MeshoptDecoder);
    const [kart, drivers] = await Promise.all([
      loader.loadAsync('/assets/karts/giggle-kart.meshopt.glb?v=kart-20261007').then(g => g.scene),
      assetsMod.loadKartDrivers(loader),
    ]);
    const variants = assetsMod.buildKartDriverVariants(THREE, kart, drivers, mergeGeometries);
    if (!variants.length) throw new Error('No drivers loaded');
    const assets = { kart, kartVariants: variants };

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x8a6f9e, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.16, 48),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
    podium.position.y = -0.08;
    scene.add(podium);
    const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 50);
    const turntable = new THREE.Group();
    scene.add(turntable);
    let model = null, angle = -0.6, last = performance.now(), hop = 0;
    const size = () => {
      const w = canvas.clientWidth || 320, h = canvas.clientHeight || 180;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Phones get a closer, taller framing so the driver reads.
      const near = camera.aspect < 1.4;
      camera.position.set(0, near ? 1.6 : 1.45, near ? 5.2 : 5.2);
      camera.lookAt(0, near ? 0.45 : 0.6, 0);
      camera.updateProjectionMatrix();
    };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
    ro?.observe(canvas);
    size();
    const night = () => document.documentElement.dataset.theme === 'night';
    const frame = (now) => {
      if (state !== s) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      podium.material.color.setHex(night() ? 0x3a2a44 : 0xffffff);
      if (!reducedMotion()) angle += dt * 0.6;
      turntable.rotation.y = angle;
      if (s.el.classList.contains('is-ready') && !reducedMotion()) hop = Math.min(1, hop + dt * 2.4);
      turntable.position.y = Math.sin(hop * Math.PI) * 0.22;
      if (model) modelMod.animateKartModel(model, { speed: s.el.classList.contains('is-ready') ? 6 : 0, dt, reducedMotion: reducedMotion() });
      renderer.render(scene, camera);
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
    const build = (driver, color) => modelMod.createKartModel(THREE, { assets, color, driver });
    return {
      show(driver, color) {
        if (model) { turntable.remove(model); }
        model = build(driver, color);
        turntable.add(model);
      },
      // One still per driver in the current paint, from a three-quarter view.
      portraits(el) {
        const shot = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
        shot.position.set(1.1, 1.55, 2.1);
        shot.lookAt(0, 0.95, -0.2);
        const keep = { model, rot: turntable.rotation.y, y: turntable.position.y };
        const w = canvas.width, h = canvas.height;
        renderer.setSize(256, 256, false);
        turntable.rotation.y = 0.5; turntable.position.y = 0;
        podium.visible = false;
        for (const b of el.querySelectorAll('[data-driver]')) {
          const m = build(b.dataset.driver, kartPaintHex(s.pick.paint));
          if (keep.model) turntable.remove(keep.model);
          turntable.add(m);
          renderer.render(scene, shot);
          const img = b.querySelector('img');
          img.src = canvas.toDataURL('image/png');
          img.hidden = false;
          b.classList.add('has-portrait');
          turntable.remove(m);
        }
        podium.visible = true;
        if (keep.model) turntable.add(keep.model);
        turntable.rotation.y = keep.rot; turntable.position.y = keep.y;
        canvas.width = w; canvas.height = h;
        size();
      },
      dispose() {
        ro?.disconnect();
        scene.traverse(o => { o.geometry?.dispose?.(); });
        renderer.dispose();
      },
    };
  } catch (e) {
    console.warn('Kart garage preview unavailable', e);
    renderer.dispose();
    return null;
  }
}
