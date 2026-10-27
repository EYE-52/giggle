import { esc } from '../util.js';
import { readInputCapabilities } from '../toolkit/input-capabilities.mjs';
import { createSoundBank } from '../toolkit/audio.js';
import { SEAT_COLORS, SEAT_GLYPHS } from '../engines/block-siege-art.js';
const CARD_KEYS = ['cube', 'beam', 'slab', 'pillar', 'parapet'], WEAPON_KEYS = ['ballista', 'mortar', 'rocket'];
const LABELS = { cube: 'Cube', beam: 'Beam', slab: 'Slab', pillar: 'Pillar', parapet: 'Parapet', ballista: 'Ballista', mortar: 'Mortar', rocket: 'Rocket' };
const GUIDE_KEY = 'castle-block-guide-v1';
let host = null, api = null, S = null, ui = {}, scene = null, sound = null, generation = 0, timer = 0, bound = [], disposed = true;
let card = 'cube', weapon = 'ballista', rotation = 0, draft = null, pendingPlacement = null, target = null, aim = null, removeMode = false, currentInstance = '', currentRound = 0, feedbackId = 0, toastUntil = 0, seq = 0, images = {}, resultReady = '', thumbKey = '', guideDismissed = false, viewUnavailable = false;
let loader = () => import('../engines/block-siege-scene.js');
const now = () => typeof api?.now === 'function' ? api.now() : Date.now();
const mine = () => S?.castles.find(c => c.pid === S.mine?.pid);
const snap = n => Math.round(n * 2) / 2;
const setText = (el, value) => { const text = String(value ?? ''); if (el && el.textContent !== text) el.textContent = text; };
function on(el, type, fn, opts) { el?.addEventListener(type, fn, opts); bound.push([el, type, fn, opts]); }
function nonce() { return 'bs-' + Date.now().toString(36) + '-' + (++seq).toString(36); }
function toast(text) { setText(ui.toast, text); ui.toast.hidden = false; toastUntil = Date.now() + 2300; }
function send(type, data = {}) { if (disposed || !S || !api || !canAct()) return; api.send({ [type]: { ...data, nonce: nonce() } }); }
function blocked() { return !!document.querySelector('details.room-menu[open], .room-menu[aria-expanded="true"], .bs-help[open], .bs-view[open]') || !ui.guide?.hidden || document.hidden; }
function canAct() { return !!(S?.mine && !S.spectator && mine()?.alive && !blocked() && ((S.phase === 'build' || S.phase === 'siege') && now() < S.endsAt)); }
function areaUnion(rects) {
  const xs = [...new Set(rects.flatMap(r => [r.x0, r.x1]))].sort((a, b) => a - b); let area = 0;
  for (let i = 1; i < xs.length; i++) { const x = (xs[i - 1] + xs[i]) / 2, zs = rects.filter(r => r.x0 <= x && r.x1 >= x).map(r => [r.z0, r.z1]).sort((a, b) => a[0] - b[0]); let length = 0, end = -Infinity; for (const [a, b] of zs) { length += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); } area += (xs[i] - xs[i - 1]) * length; } return area;
}
function validateDraft() {
  const c = mine(), p = S?.cards[card]; if (!c || !draft || !p) return 'Tap your island to place a block.';
  const w = rotation % 2 ? p.d : p.w, d = rotation % 2 ? p.w : p.d, b = { x0: draft.x - w / 2, x1: draft.x + w / 2, z0: draft.z - d / 2, z1: draft.z + d / 2, y0: draft.y, y1: draft.y + p.h };
  if (Math.min(b.x0, b.z0) < -6 || Math.max(b.x1, b.z1) > 6 || b.y0 < 0 || b.y1 > 12) return 'Whole block must fit inside your island.';
  const occupied = [...c.pieces, c.crown].some(q => b.x0 < q.x + q.w / 2 - .000001 && b.x1 > q.x - q.w / 2 + .000001 && b.z0 < q.z + q.d / 2 - .000001 && b.z1 > q.z - q.d / 2 + .000001 && b.y0 < q.y + q.h - .000001 && b.y1 > q.y + .000001);
  if (occupied) return 'Space occupied.';
  if (draft.y > 0) {
    const rects = c.pieces.filter(q => Math.abs(q.y + q.h - draft.y) < .000001).map(q => ({ x0: Math.max(b.x0, q.x - q.w / 2), x1: Math.min(b.x1, q.x + q.w / 2), z0: Math.max(b.z0, q.z - q.d / 2), z1: Math.min(b.z1, q.z + q.d / 2) })).filter(r => r.x1 > r.x0 && r.z1 > r.z0);
    if (!rects.some(r => draft.x >= r.x0 && draft.x <= r.x1 && draft.z >= r.z0 && draft.z <= r.z1) || areaUnion(rects) < w * d * .3 - .000001) return 'Needs 30% support under its center.';
  }
  if (!(S.mine.hand[card] > 0)) return 'That block card is empty.';
  if (c.pieces.length >= S.arena.maxPieces) return '64-block castle limit reached.';
  return '';
}
function pushScene() { if (scene && S) scene.update(S, { card, weapon, target, aim, draft: S.phase === 'build' && draft ? { ...draft, rotation, valid: !validateDraft() } : null }); }
const draftKey = () => draft ? `${card}:${rotation}:${draft.x}:${draft.y}:${draft.z}` : '';
function place() {
  if (!canAct()) return;
  const reason = validateDraft(); if (reason) return toast(reason);
  const key = draftKey(); if (pendingPlacement?.key === key) return;
  pendingPlacement = { key, card, rotation, ...draft, ids: new Set(mine().pieces.map(p => p.id)) };
  send('place', { card, ...draft, rotation });
}
function confirmPlacement() {
  if (!pendingPlacement) return;
  const p = pendingPlacement;
  const placed = mine()?.pieces.some(q => !p.ids.has(q.id) && q.card === p.card && q.x === p.x && q.y === p.y && q.z === p.z && q.rotation === p.rotation);
  if (!placed) return;
  // Clear only the accepted ghost; a newer cursor/keyboard draft stays intact.
  if (draftKey() === p.key) draft = null;
  pendingPlacement = null;
  toast(`${LABELS[p.card]} placed`);
}
function fire() { if (!aim || !target) return toast('Choose a rival and tap an aim point.'); if (!S.castles.some(c => c.pid === target && c.alive)) return toast('That Crown fell. Choose a living rival.'); if ((S?.mine?.cooldowns[weapon] || 0) > now()) return toast('Weapon is reloading.'); if (!(S?.mine?.ammo[weapon] > 0)) return toast(weapon === 'ballista' ? 'Next bolt refills in a few seconds.' : 'No ammunition left for this weapon.'); send('fire', { weapon, target, ...aim }); }
function onPick(hit) {
  if (!hit || disposed || !S) return;
  if (hit.flag && hit.pid !== S.mine?.pid) { chooseTarget(hit.pid); return; }
  if (!canAct()) return;
  if (S.phase === 'build') {
    if (hit.pid !== S.mine.pid) return toast('Build on your own island.');
    if (removeMode) { if (!hit.piece || hit.crown) return toast('Tap one of your placed blocks to remove it.'); send('remove', { piece: hit.piece }); return; }
    const p = mine().pieces.find(p => p.id === hit.piece);
    draft = { x: snap(hit.point.x), y: p && hit.normal.y > .5 ? p.y + p.h : 0, z: snap(hit.point.z) }; pushScene(); patch(); place();
  } else if (S.phase === 'siege') {
    if (hit.pid === S.mine.pid) return toast('Aim at a rival castle.');
    target = hit.pid; aim = { x: hit.point.x, y: Math.min(12, hit.point.y), z: hit.point.z }; pushScene(); patch();
  }
}
function onHover(hit) {
  if (disposed || S?.phase !== 'build' || !canAct() || removeMode || !hit || hit.pid !== S.mine?.pid || hit.flag || hit.crown) return;
  const p = mine().pieces.find(p => p.id === hit.piece); draft = { x: snap(hit.point.x), y: p && hit.normal.y > .5 ? p.y + p.h : 0, z: snap(hit.point.z) }; pushScene(); patch();
}
function chooseTarget(pid) {
  const c = S?.castles.find(c => c.pid === pid && c.pid !== S.mine?.pid); if (!c) return;
  if (target !== c.pid) aim = null; target = c.pid; scene?.focus(target); pushScene(); patch();
}
function select(id) { if (CARD_KEYS.includes(id)) { card = id; removeMode = false; } else weapon = id; pushScene(); patch(); ui.cards.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
function dismissGuide() { guideDismissed = true; ui.guide.hidden = true; try { localStorage.setItem(GUIDE_KEY, '1'); } catch {} scene?.setEnabled(!blocked() && !viewUnavailable); patch(); }
function neutralize() { scene?.cancel(); scene?.setEnabled(!blocked() && !viewUnavailable); }
function keydown(e) {
  if (disposed || !S || e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.target?.isContentEditable) return;
  if (e.key === 'Escape') { draft = null; aim = null; removeMode = false; ui.help.open = false; ui.view.open = false; if (!ui.guide.hidden) dismissGuide(); neutralize(); pushScene(); patch(); return; }
  if (blocked()) return;
  const keys = S.phase === 'build' ? CARD_KEYS : WEAPON_KEYS, number = Number(e.key);
  if (number >= 1 && number <= keys.length) { e.preventDefault(); select(keys[number - 1]); return; }
  if (e.key.toLowerCase() === 'r' && S.phase === 'build') { e.preventDefault(); rotation = (rotation + 1) % 4; pushScene(); patch(); return; }
  if (e.key.toLowerCase() === 'o') { scene?.focus(null); return; }
  if (e.key.toLowerCase() === 'h') { scene?.focus(S.mine?.pid); return; }
  if (e.key === '+' || e.key === '=') { scene?.zoom(1); return; } if (e.key === '-') { scene?.zoom(-1); return; }
  if (e.shiftKey && e.key.startsWith('Arrow')) { e.preventDefault(); scene?.orbit(e.key === 'ArrowLeft' ? -.15 : e.key === 'ArrowRight' ? .15 : 0, e.key === 'ArrowUp' ? .1 : e.key === 'ArrowDown' ? -.1 : 0); return; }
  if (e.key.startsWith('Arrow') || e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault(); if (!canAct()) return;
    const p = S.phase === 'build' ? (draft ||= { x: 2, y: .5, z: 0 }) : (aim ||= { x: 0, y: .95, z: 0 });
    if (e.key === 'ArrowLeft') p.x -= .5; if (e.key === 'ArrowRight') p.x += .5; if (e.key === 'ArrowUp') p.z -= .5; if (e.key === 'ArrowDown') p.z += .5; if (e.key === 'PageUp') p.y += .5; if (e.key === 'PageDown') p.y -= .5;
    p.x = Math.max(-6, Math.min(6, p.x)); p.z = Math.max(-6, Math.min(6, p.z)); p.y = Math.max(0, Math.min(12, p.y)); pushScene(); patch(); return;
  }
  if (e.key === 'Enter' || e.code === 'Space') { if (e.repeat) return; if (e.target?.tagName === 'BUTTON' || e.target?.tagName === 'SUMMARY') return; e.preventDefault(); if (S.phase === 'build') place(); else fire(); }
}
function cardMarkup(id, index) { return `<button class="bs-card" data-card="${id}" aria-label="${LABELS[id]} card, keyboard ${index + 1}"><img alt="" class="bs-art" hidden><span class="bs-card-name">${LABELS[id]}</span><b class="bs-qty"></b><span class="bs-cool"><i></i></span><svg class="bs-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"/><circle class="bs-progress" cx="18" cy="18" r="15"/></svg></button>`; }
function skeleton(el) {
  el.innerHTML = `<div class="bs-game" data-phase="build"><div class="bs-world" role="img" aria-label="Castle islands in a sunset alpine arena"></div><div class="bs-unavailable" hidden></div>
  <div class="bs-phase"><span class="bs-round"></span><b class="bs-phase-name">Construction</b><strong class="bs-clock"></strong></div>
  <div class="bs-own"><b></b><span></span><div class="bs-hp"><i></i></div></div><div class="bs-rivals" aria-label="Rival castles"></div>
  <details class="bs-view"><summary aria-label="Camera controls">View</summary><div><button data-focus="overview">Overview · O</button><button data-focus="own">My castle · H</button><button data-focus="target">Rival castle</button><button data-zoom="1">Zoom in · +</button><button data-zoom="-1">Zoom out · −</button></div></details>
  <details class="bs-help"><summary>Help</summary><div><h3>Defend your Crown</h3><p>Choose a block, tap your island or a top surface to stack. Rotate before placing. A block needs 30% support under its center.</p><p>When a support breaks, the blocks above collapse. Stone has 65 health, timber 35, iron 95.</p><p>In siege, choose a rival, tap a point to aim, then Fire. Defenses catch the first hit. Mortar and rockets damage nearby unshielded blocks. Ballista refills one bolt every 5 seconds.</p><p>Last Crown standing wins. At the clock: Crown health, standing height, then damage decide. Most round wins takes the match.</p><p>Drag to orbit. Pinch or scroll to zoom. Keys 1–5 select cards, R rotates, arrows move the draft, Page Up/Down changes height, Enter places or fires. Shift + arrows orbits.</p><button data-guide>Show guide</button></div></details>
  <div class="bs-bottom"><div class="bs-context" role="status"></div><div class="bs-actions"><button data-action="rotate">Rotate <span>R</span></button><button data-action="undo">Undo</button><button data-action="remove" aria-pressed="false">Remove</button><button data-action="confirm" class="bs-primary">Place</button><button data-action="ready">Ready</button></div>
  <div class="bs-hand bs-blocks">${CARD_KEYS.map(cardMarkup).join('')}</div><div class="bs-hand bs-weapons" hidden>${WEAPON_KEYS.map(cardMarkup).join('')}</div></div>
  <div class="bs-toast" role="status" hidden></div><div class="bs-guide" role="dialog" aria-label="Castle Clash quick guide" hidden><h2>Build. Stack. Siege.</h2><div><img data-guide-block alt="Stone block"><p><b>1. Choose a block</b><br>Your cards are a finite hand.</p></div><div><img data-guide-stack alt="Pillar block"><p><b>2. Tap to stack</b><br>Top faces support your next piece.</p></div><div><img data-guide-weapon alt="Rocket"><p><b>3. Aim, then Fire</b><br>Break defenses to reach a rival Crown.</p></div><button data-dismiss class="bs-primary">Let's build</button></div>
  <div class="bs-result" hidden><div><span class="bs-result-kicker"></span><h2></h2><p class="bs-result-reason"></p><ol></ol><div class="bs-result-actions"><button data-rematch class="bs-primary">Rematch</button><button data-change>Change game</button></div><p class="bs-host-wait"></p></div></div></div>`;
  const q = sel => el.querySelector(sel); ui = { root: q('.bs-game'), world: q('.bs-world'), unavailable: q('.bs-unavailable'), phase: q('.bs-phase'), round: q('.bs-round'), phaseName: q('.bs-phase-name'), clock: q('.bs-clock'), own: q('.bs-own'), rivals: q('.bs-rivals'), view: q('.bs-view'), help: q('.bs-help'), bottom: q('.bs-bottom'), context: q('.bs-context'), actions: q('.bs-actions'), blocks: q('.bs-blocks'), weapons: q('.bs-weapons'), toast: q('.bs-toast'), guide: q('.bs-guide'), result: q('.bs-result') };
  ui.buttons = Object.fromEntries([...el.querySelectorAll('[data-action]')].map(b => [b.dataset.action, b]));
  ui.cards = new Map([...el.querySelectorAll('[data-card]')].map(b => [b.dataset.card, b]));
}
function setImages(urls) { images = urls; for (const [id, button] of ui.cards) { const img = button.querySelector('img'); img.src = urls[id]; img.hidden = false; } for (const [attr, id] of [['block', 'cube'], ['stack', 'pillar'], ['weapon', 'rocket']]) { const img = host.querySelector(`[data-guide-${attr}]`); img.src = urls[id]; } }
function patch() {
  if (disposed || !S) return;
  ui.root.dataset.phase = S.phase;
  const c = mine(), build = S.phase === 'build', siege = S.phase === 'siege', active = canAct(), seconds = S.endsAt > 0 ? Math.max(0, Math.ceil((S.endsAt - now()) / 1000)) : null;
  setText(ui.round, `Round ${S.round} / ${S.rounds}`); setText(ui.phaseName, build ? 'Construction' : siege ? 'Siege' : S.phase === 'resolving' ? 'Final impacts' : S.phase === 'done' ? 'Match complete' : 'Round complete'); setText(ui.clock, seconds === null ? '' : `${seconds}s`);
  setText(ui.own.querySelector('b'), c ? `${SEAT_GLYPHS[c.seat]} ${c.name}` : 'Watching'); setText(ui.own.querySelector('span'), c ? `${c.crown.hp} / ${c.crown.maxHp} Crown · ${c.wins} wins` : 'Join the next match'); ui.own.style.setProperty('--seat', c ? SEAT_COLORS[c.seat] : '#fff'); ui.own.querySelector('i').style.width = c ? `${c.crown.hp / c.crown.maxHp * 100}%` : '0%';
  for (const b of ui.rivals.querySelectorAll('[data-target]')) { const rival = S.castles.find(c => c.pid === b.dataset.target); if (!rival) continue; setText(b.querySelector('b'), `${SEAT_GLYPHS[rival.seat]} ${rival.name}`); setText(b.querySelector('span'), rival.alive ? build ? `${rival.ready ? 'Ready' : 'Building'} · ${rival.crown.hp}` : `${rival.crown.hp} Crown` : 'Crown fell'); b.setAttribute('aria-pressed', String(rival.pid === target)); b.classList.toggle('bs-eliminated', !rival.alive); }
  ui.blocks.hidden = !build; ui.weapons.hidden = build; ui.bottom.hidden = ['round-result', 'done'].includes(S.phase); ui.actions.hidden = !S.mine || S.spectator || !c?.alive || !['build', 'siege'].includes(S.phase);
  for (const [name, b] of Object.entries(ui.buttons)) { b.hidden = !build && name !== 'confirm'; b.disabled = !active; }
  setText(ui.buttons.confirm, build ? 'Place' : 'Fire'); setText(ui.buttons.ready, c?.ready ? 'Unready' : 'Ready'); ui.buttons.remove.setAttribute('aria-pressed', String(removeMode));
  if (build) ui.buttons.confirm.disabled = !active || !!validateDraft();
  if (siege) ui.buttons.confirm.disabled = !active || !target || !aim || !S.castles.some(c => c.pid === target && c.alive) || !(S.mine?.ammo[weapon] > 0) || (S.mine?.cooldowns[weapon] || 0) > now();
  setText(ui.context, !S.mine || S.spectator ? 'Watching · choose a flag to view a castle' : !c?.alive ? 'Your Crown fell · watch this siege, then rebuild' : build ? removeMode ? 'Tap your own block to remove it' : draft ? `${LABELS[card]} · ${validateDraft() || (draft.y > 0 ? 'Stack here · Place' : 'Build here · Place')}` : c.ready ? 'Ready · waiting for the other castles' : 'Choose a block · tap your island or a top face' : siege ? aim ? `${LABELS[weapon]} · aimed at ${S.castles.find(c => c.pid === target)?.name || 'rival'} · Fire when ready` : 'Choose a rival · tap a point to aim' : 'Let the final impacts settle…');
  for (const [id, b] of ui.cards) {
    const isBlock = CARD_KEYS.includes(id), count = isBlock ? S.mine?.hand[id] ?? 0 : S.mine?.ammo[id] ?? 0;
    const remaining = isBlock ? 0 : Math.max(0, (S.mine?.cooldowns[id] || 0) - now()), length = S.weapons[id]?.cooldownMs || 1;
    const selected = id === (isBlock ? card : weapon); b.setAttribute('aria-label', `${LABELS[id]}, ${count} ${isBlock ? 'blocks' : 'shots'}${remaining > 0 ? `, reloading ${(remaining / 1000).toFixed(1)} seconds` : ''}`); const spec = isBlock ? S.cards[id] : S.weapons[id]; b.title = isBlock ? `${spec.material} · ${spec.w} × ${spec.d} × ${spec.h} · ${spec.hp} health` : `${spec.damage} direct${spec.splash ? ` + ${spec.splash} nearby` : ''} · ${spec.cooldownMs / 1000}s reload${id === 'ballista' ? ' · refills every 5s' : ''}`; b.setAttribute('aria-pressed', String(selected)); b.classList.toggle('bs-selected', selected); b.disabled = !S.mine || S.spectator || !c?.alive || count <= 0;
    setText(b.querySelector('.bs-qty'), remaining > 0 ? `${(remaining / 1000).toFixed(1)}s · ${count}` : `× ${count}`); b.querySelector('.bs-cool i').style.width = `${100 * (1 - remaining / length)}%`; if (isBlock || remaining <= 0) b.querySelector('.bs-ring').setAttribute('hidden', ''); else b.querySelector('.bs-ring').removeAttribute('hidden'); b.querySelector('.bs-progress').style.strokeDashoffset = `${94.25 * remaining / length}`;
  }
  if (toastUntil && Date.now() > toastUntil) { ui.toast.hidden = true; toastUntil = 0; }
  scene?.setEnabled(!blocked() && !viewUnavailable);
  if (S.phase === 'done' || S.phase === 'round-result') showResult();
}
function showResult() {
  const done = S.phase === 'done', result = done ? S.result : S.roundResult;
  ui.result.hidden = !result || !['round-result', 'done'].includes(S.phase) || (!viewUnavailable && scene?.isSettled?.() === false); if (ui.result.hidden) return;
  setText(ui.result.querySelector('.bs-result-kicker'), done ? 'MATCH COMPLETE' : `ROUND ${S.round}`);
  const names = (result.winners || []).map(pid => S.castles.find(c => c.pid === pid)?.name || 'Castle');
  setText(ui.result.querySelector('h2'), names.length ? names.length > 1 ? `${names.join(' & ')} share the win` : `${names[0]} wins` : 'Draw');
  setText(ui.result.querySelector('.bs-result-reason'), done ? `${result.reason}. Final round: ${result.lastRoundReason}.` : result.reason);
  const rows = result.standings || [], key = JSON.stringify(rows);
  if (ui.result.dataset.rows !== key) { ui.result.dataset.rows = key; ui.result.querySelector('ol').innerHTML = rows.map(row => { const c = S.castles.find(c => c.pid === row.pid); return `<li style="--seat:${SEAT_COLORS[c?.seat || 0]}"><b>${esc(c?.name || 'Castle')}</b><span>${done ? `${row.wins} wins · ${row.health} health · ${row.damage} damage` : `${row.hp} Crown · ${row.height} height · ${row.damage} damage`}</span></li>`; }).join(''); }
  const isHost = api?.context?.().isHost === true;
  const controls = ui.result.querySelector('.bs-result-actions'); controls.hidden = !done || !isHost;
  setText(ui.result.querySelector('.bs-host-wait'), done && !isHost ? 'Waiting for the host to rematch or change game.' : done ? '' : 'The next construction round starts shortly.');
  if (done && resultReady !== S.instanceId) { resultReady = S.instanceId; api?.resultsReady?.(S.instanceId); }
}
function dispose() {
  disposed = true; viewUnavailable = false; generation++; if (timer) clearInterval(timer); timer = 0;
  for (const [el, type, fn, options] of bound) el?.removeEventListener(type, fn, options); bound = [];
  scene?.dispose(); scene = null; sound?.dispose(); sound = null; host = api = S = null; ui = {}; images = {}; thumbKey = ''; currentInstance = ''; currentRound = 0; resultReady = '';
  card = 'cube'; weapon = 'ballista'; rotation = 0; draft = aim = target = pendingPlacement = null; removeMode = false; feedbackId = 0;
}
export default {
  ownsTimer: true, ownsRematch: true, ownsInputs: true,
  _inject(options) { if (typeof options?.scene === 'function') loader = options.scene; },
  _debug() { return { card, weapon, rotation, draft, target, aim, removeMode, instance: currentInstance, mounted: !disposed, input: readInputCapabilities(), scene: scene?.debug?.() }; },
  mount(el, apiIn) {
    dispose(); disposed = false; const token = ++generation; host = el; api = apiIn;
    if (!document.getElementById('block-siege-style')) { const link = document.createElement('link'); link.id = 'block-siege-style'; link.rel = 'stylesheet'; link.href = '/css/castle-immersive.css'; document.head.appendChild(link); }
    skeleton(el); sound = createSoundBank();
    try { guideDismissed = localStorage.getItem(GUIDE_KEY) === '1'; } catch { guideDismissed = false; }
    ui.guide.hidden = guideDismissed;
    for (const [id, b] of ui.cards) on(b, 'click', () => select(id));
    on(ui.buttons.rotate, 'click', () => { rotation = (rotation + 1) % 4; pushScene(); patch(); });
    on(ui.buttons.undo, 'click', () => send('undo'));
    on(ui.buttons.remove, 'click', () => { removeMode = !removeMode; patch(); });
    on(ui.buttons.confirm, 'click', () => S?.phase === 'build' ? place() : fire());
    on(ui.buttons.ready, 'click', () => send('ready', { value: !mine()?.ready }));
    on(host.querySelector('[data-dismiss]'), 'click', dismissGuide);
    on(host.querySelector('[data-guide]'), 'click', () => { ui.help.open = false; ui.guide.hidden = false; neutralize(); });
    on(host.querySelector('[data-rematch]'), 'click', () => api?.rematch?.()); on(host.querySelector('[data-change]'), 'click', () => api?.lobby?.());
    for (const button of host.querySelectorAll('[data-focus]')) on(button, 'click', () => { const focus = button.dataset.focus; ui.view.open = false; scene?.focus(focus === 'own' ? S?.mine?.pid : focus === 'target' ? target : null); neutralize(); });
    for (const button of host.querySelectorAll('[data-zoom]')) on(button, 'click', () => scene?.zoom(Number(button.dataset.zoom)));
    on(window, 'keydown', keydown); on(window, 'blur', neutralize); on(document, 'visibilitychange', neutralize); on(document, 'game-screenchange', neutralize); on(document, 'toggle', neutralize, true);
    timer = setInterval(patch, 150);
    Promise.resolve(loader()).then(mod => { if (disposed || token !== generation) return null; return mod.createBlockSiegeScene(ui.world, { now, onPick: hit => { if (!disposed && token === generation) onPick(hit); }, onHover: hit => { if (!disposed && token === generation) onHover(hit); }, onUnavailable: reason => { if (disposed || token !== generation) return; viewUnavailable = true; scene?.cancel(); scene?.setEnabled(false); ui.unavailable.hidden = false; setText(ui.unavailable, reason); }, onEffect: e => { if (api?.context?.().sound === false) return; if (e.type === 'shot') sound?.cue(e.shot.weapon === 'ballista' ? 'click' : e.shot.weapon === 'mortar' ? 'turn' : 'join'); else sound?.cue(e.hit ? e.weapon === 'ballista' ? 'click' : e.weapon === 'mortar' ? 'lose' : 'turn' : 'tick'); } }); }).then(handle => {
      if (disposed || token !== generation) { handle?.dispose(); return; } scene = handle;
      if (handle.fallback) { viewUnavailable = true; ui.unavailable.hidden = false; setText(ui.unavailable, 'The 3D arena could not start. You can watch the Crown status and use keyboard placement and aiming. Rejoin to try graphics again.'); }
      pushScene(); if (S && !handle.fallback) { setImages(scene.thumbnails(S.cards, S.weapons)); thumbKey = 'ready'; } patch();
    }).catch(() => { if (!disposed && token === generation) { viewUnavailable = true; ui.unavailable.hidden = false; setText(ui.unavailable, 'The 3D arena could not load. Rejoin to restore the view.'); } });
  },
  update(el, snapshot, apiIn) {
    if (disposed || host !== el) this.mount(el, apiIn); api = apiIn; S = snapshot;
    if (currentInstance !== S.instanceId || currentRound !== S.round) {
      const fresh = currentInstance !== S.instanceId; currentInstance = S.instanceId; currentRound = S.round; draft = null; aim = null; pendingPlacement = null; rotation = 0; removeMode = false; feedbackId = Number(S.feedback?.id) || 0;
      if (fresh || !S.castles.some(c => c.pid === target)) { target = S.castles.find(c => c.pid !== S.mine?.pid)?.pid || null; aim = null; }
      ui.rivals.innerHTML = S.castles.filter(c => c.pid !== S.mine?.pid).map(c => `<button data-target="${esc(c.pid)}" style="--seat:${SEAT_COLORS[c.seat]}" aria-label="Target ${esc(c.name)}"><b></b><span></span></button>`).join('');
      for (const b of ui.rivals.querySelectorAll('[data-target]')) on(b, 'click', () => chooseTarget(b.dataset.target));
    }
    if (!thumbKey && scene && !scene.fallback) { setImages(scene.thumbnails(S.cards, S.weapons)); thumbKey = 'ready'; }
    confirmPlacement();
    if (S.feedback && S.feedback.id > feedbackId) { feedbackId = S.feedback.id; pendingPlacement = null; toast(S.feedback.reason); }
    pushScene(); patch(); showResult();
  },
  dispose,
};
