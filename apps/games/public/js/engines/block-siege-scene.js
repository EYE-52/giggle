import { createThreeView } from '../renderers/three-view.js';
import { createArenaControls } from '../renderers/arena-controls.mjs';
import { createSiegeArt, SEAT_COLORS } from './block-siege-art.js';
const Y0 = .55, WATER_Y = -6.4, MAX_PROJECTILES = 24, MAX_DEBRIS = 64, MAX_FALLING = 40;
const pointAt = (shot, t) => ({ x: shot.start.x + (shot.target.x - shot.start.x) * t, y: shot.start.y + (shot.target.y - shot.start.y) * t + 4 * shot.arc * t * (1 - t) + Y0, z: shot.start.z + (shot.target.z - shot.start.z) * t });
export async function createBlockSiegeScene(mount, opts = {}) {
  let T, art, scene, camera, controls, helper, root, pieceLayer, bridges, shadowLight, snapshot = null, selection = {}, eventId = null, instance = null, round = null, phase = null, disposed = false;
  let ghost = null, ghostKey = '', previewKey = '', preview = null, reticle = null, frameCount = 0, frameMs = [], lastFrame = 0, shake = 0, batchesDirty = false, focusedPid = null, manualCamera = false;
  const castles = new Map(), pieces = new Map(), projectiles = new Map(), debris = [], falling = [], pickables = [], clouds = [], detail = [];
  const panorama = { status: 'procedural', url: '/assets/castle/alpine-panorama-v2.webp', bytes: 78484, width: 1774, height: 887 };
  const now = () => opts.now ? opts.now() : Date.now();
  const seeded = seed => () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  function pick(ndc) {
    if (!camera || !snapshot) return null;
    const ray = new T.Raycaster(); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    for (const h of hits) {
      const data = h.object.userData;
      if (!data.pid || !data.pick || (data.piece && pieces.get(data.piece)?.group.visible === false)) continue;
      return { pid: data.pid, piece: data.piece || null, crown: !!data.crown, flag: !!data.flag,
        point: { x: h.point.x - data.position.x, y: Math.max(0, h.point.y - Y0), z: h.point.z - data.position.z },
        normal: h.face?.normal ? { x: h.face.normal.x, y: h.face.normal.y, z: h.face.normal.z } : { x: 0, y: 1, z: 0 } };
    }
    return null;
  }
  function surfaceGeometry(triangles) {
    const positions = [], colors = [], uvs = [];
    for (const [a, b, c, color] of triangles) for (const p of [a, b, c]) { positions.push(...p); const tint = new T.Color(color || '#ffffff'); colors.push(tint.r, tint.g, tint.b); uvs.push(p[0] * .13 + p[2] * .08, p[1] * .24 + p[2] * .11); }
    const g = art.geometry(new T.BufferGeometry()); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals(); return g;
  }
  function cliff(parent, radius, top, bottom, seed, flat = false) {
    const rand = seeded(seed), n = 28, radii = Array.from({ length: n }, () => radius * (.92 + rand() * .13)), rings = [];
    for (const [scale, y] of [[1, top], [.98, top - .45], [1.12, top - 2.2], [1.08, top - 2.55], [1.14, bottom + .65], [.86, bottom]]) rings.push(radii.map((r, i) => { const a = i * Math.PI * 2 / n, edge = y === top ? 1 : .94 + rand() * .12; return [Math.sin(a) * r * scale * edge, y + (y === top ? 0 : (rand() - .5) * .45), Math.cos(a) * r * scale * edge]; }));
    const wall = [], tops = [], tints = ['#e4e6dc', '#c2ccc7', '#a9bab5', '#ccd2c6'];
    for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < n; i++) { const j = (i + 1) % n, color = tints[(i + row * 3) % tints.length]; wall.push([rings[row][i], rings[row + 1][i], rings[row][j], color], [rings[row][j], rings[row + 1][i], rings[row + 1][j], color]); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; tops.push([[0, top, 0], rings[0][i], rings[0][j], i % 3 ? '#f3f0cf' : '#d8e7ad']); const a = rings[2][i], b = rings[2][j]; tops.push([[0, top - 2.16, 0], [a[0], top - 2.16, a[2]], [b[0], top - 2.16, b[2]], '#a9c982']); }
    art.mesh(surfaceGeometry(wall), art.cliff, null, null, parent); art.mesh(surfaceGeometry(tops), art.grass, null, null, parent); return radii;
  }
  function forest(parent, spots, fine = false) {
    const trunks = [], lower = [];
    for (let i = 0; i < spots.length; i++) { const p = spots[i], h = p.h || 3.8, r = h * .24, angle = i * 2.3999; trunks.push({ position: [p.x, p.y + h * .24, p.z], scale: [h * .039, h * .48, h * .039] });
      lower.push({ position: [p.x, p.y + h * .09, p.z], scale: [r, h * .93, r], rotation: [0, angle, 0], color: i % 3 === 0 ? '#bbc59f' : '#d4dba9' });
    }
    art.instances(art.cylinder, art.wood, trunks, parent); art.instances(fine ? art.firGeo : art.firCoarse, art.leaf, lower, parent);
  }
  function decorate() {
    scene.background = new T.Color('#568aab'); scene.fog = new T.Fog('#5993a2', 95, 245);
    scene.add(new T.HemisphereLight('#f6e5cd', '#5f8297', 1.55)); const light = new T.DirectionalLight('#ffe1b0', 2.05); light.position.set(-35, 48, -55); light.target.position.set(0, 2, 0); scene.add(light, light.target); shadowLight = light;
    light.castShadow = true; light.shadow.camera.left = light.shadow.camera.bottom = -40; light.shadow.camera.right = light.shadow.camera.top = 40; light.shadow.camera.near = 1; light.shadow.camera.far = 145; light.shadow.bias = -.00045; light.shadow.normalBias = .06; light.shadow.intensity = .48;
    const renderer = helper.renderer?.(); if (renderer) { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.07; renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; }
    const skyCanvas = document.createElement('canvas'); skyCanvas.width = 4; skyCanvas.height = 256; const ctx = skyCanvas.getContext('2d');
    const stops = [[0, [66, 113, 155]], [.48, [147, 172, 194]], [.66, [235, 173, 156]], [1, [250, 211, 163]]];
    for (let y = 0; y < 256; y++) { const t = y / 255; let s = 0; while (s < stops.length - 2 && t > stops[s + 1][0]) s++; const u = (t - stops[s][0]) / (stops[s + 1][0] - stops[s][0]); ctx.fillStyle = `rgb(${stops[s][1].map((v, i) => Math.round(v + (stops[s + 1][1][i] - v) * u)).join(',')})`; ctx.fillRect(0, y, 4, 1); }
    const skyTexture = art.registerTexture(new T.CanvasTexture(skyCanvas)); skyTexture.colorSpace = T.SRGBColorSpace;
    const skyMat = new T.MeshBasicMaterial({ map: skyTexture, side: T.BackSide, fog: false, depthWrite: false }); const sky = art.mesh(art.geometry(new T.SphereGeometry(350, 24, 14)), skyMat, null, null, scene); sky.renderOrder = -10; sky.castShadow = false;
    const river = art.mesh(art.geometry(new T.PlaneGeometry(480, 480)), art.water, null, [0, WATER_Y, 0], scene); river.rotation.x = -Math.PI / 2; river.castShadow = false;
    const sunMat = new T.MeshBasicMaterial({ color: '#ffedb2', fog: false }), sun = art.mesh(art.geometry(new T.SphereGeometry(1, 24, 16)), sunMat, [4.4, 4.4, 4.4], [-67, 23, -100], scene); sun.castShadow = false;
    const mountainTriangles = [], snowTriangles = [], rand = seeded(813);
    for (let i = 0; i < 32; i++) { const a = i * Math.PI * 2 / 32, radius = 110 + rand() * 24, height = 20 + rand() * 18, width = 15 + rand() * 15, cx = Math.sin(a) * radius, cz = Math.cos(a) * radius, peak = [cx + (rand() - .5) * 5, height, cz + (rand() - .5) * 5], ring = [];
      for (let j = 0; j < 7; j++) { const b = j / 7 * Math.PI * 2; ring.push([cx + Math.sin(b) * width * (.72 + rand() * .35), -4, cz + Math.cos(b) * width]); }
      for (let j = 0; j < 7; j++) { const next = (j + 1) % 7, color = ['#8894a6', '#97a5b5', '#8990a6', '#b0a4b8'][i % 4]; mountainTriangles.push([peak, ring[j], ring[next], color]); const u = .17 + rand() * .16, snowA = peak.map((v, k) => v + (ring[j][k] - v) * u), snowB = peak.map((v, k) => v + (ring[next][k] - v) * (.16 + rand() * .18)); snowTriangles.push([[peak[0], peak[1] + .025, peak[2]], snowA, snowB, j % 2 ? '#f4e8e5' : '#cbd7e2']); }
    }
    const mountains = art.mesh(surfaceGeometry(mountainTriangles), art.mat('#ffffff', { vertexColors: true, roughness: 1 }), null, null, scene), snowcaps = art.mesh(surfaceGeometry(snowTriangles), art.mat('#ffffff', { vertexColors: true }), null, null, scene);
    mountains.castShadow = snowcaps.castShadow = false;
    const bank = new T.Group(); scene.add(bank); const bankRocks = [], trees = [];
    for (let i = 0; i < 42; i++) { const a = i / 42 * Math.PI * 2, r = 49 + Math.sin(i * 3) * 4, h = 2.5 + rand() * 2.1; bankRocks.push({ position: [Math.sin(a) * r, WATER_Y + h * .24, Math.cos(a) * r], scale: [5.2 + rand() * 3, h, 5.2 + rand() * 3], rotation: [0, a, .08], color: i % 3 ? '#d5d4bf' : '#a8bcb1' });
      for (let j = 0; j < 4; j++) { const b = a + (j - 1.5) * .018, rr = r + 3 + rand() * 4; trees.push({ x: Math.sin(b) * rr, z: Math.cos(b) * rr, y: h * .75 + WATER_Y, h: 3 + rand() * 3.2 }); }
    }
    art.instances(art.rockGeo, art.cliff, bankRocks, bank); forest(bank, trees); detail.push(bank);
    const cloudItems = []; for (let i = 0; i < 11; i++) for (let j = 0; j < 5; j++) cloudItems.push({ position: [-88 + i * 17 + j * 2.4, 27 + i % 3 * 5 + j % 2 * .55, -75 - i % 2 * 18], scale: [3.6, 1.05 + j % 2 * .5, 1.9] });
    const cloud = art.instances(art.sphere, art.mat('#ffdfd2', { transparent: true, opacity: .72, roughness: 1, depthWrite: false }), cloudItems, scene); cloud.castShadow = false; clouds.push(cloud);
    // Imagegen supplies distant atmosphere only. Foreground terrain, castles,
    // launchers and all hits stay in the live scene; failed loads keep this sky.
    if (typeof document.createElementNS === 'function') {
      panorama.status = 'loading';
      new T.TextureLoader().load(panorama.url, texture => {
        if (disposed) { texture.dispose(); return; }
        art.registerTexture(texture); texture.colorSpace = T.SRGBColorSpace; texture.wrapS = T.RepeatWrapping; texture.anisotropy = 2;
        const material = new T.MeshBasicMaterial({ map: texture, side: T.BackSide, fog: false, toneMapped: false, depthWrite: false });
        const backdrop = art.mesh(art.geometry(new T.SphereGeometry(350, 48, 24)), material, null, null, scene); backdrop.rotation.y = .84; backdrop.renderOrder = -9; backdrop.castShadow = false;
        sky.visible = sun.visible = mountains.visible = snowcaps.visible = cloud.visible = false; panorama.status = 'ready';
      }, undefined, () => { if (!disposed) panorama.status = 'fallback'; });
    }
    const glints = [], glintMat = new T.MeshBasicMaterial({ color: '#a0e1d9', transparent: true, opacity: .14, depthWrite: false });
    for (let i = 0; i < 56; i++) glints.push({ position: [-47 + rand() * 94, WATER_Y + .018, -45 + rand() * 90], scale: [1.1 + rand() * 3.5, .012, .04 + rand() * .05], rotation: [0, -.25, 0] }); art.instances(art.boxGeo, glintMat, glints, scene).castShadow = false;
    root = new T.Group(); pieceLayer = new T.Group(); bridges = new T.Group(); scene.add(root, pieceLayer, bridges);
    const aimMat = new T.MeshBasicMaterial({ color: '#fff1bd', transparent: true, opacity: .95, depthTest: false }); reticle = new T.Group(); art.mesh(art.geometry(new T.TorusGeometry(.38, .036, 6, 28)), aimMat, null, null, reticle);
    for (const a of [0, Math.PI / 2]) { const line = art.box(reticle, aimMat, [.95, .035, .035], [0, 0, 0]); line.rotation.z = a; } reticle.traverse(o => { o.castShadow = false; }); reticle.visible = false; scene.add(reticle);
  }
  function island(c) {
    const group = new T.Group(); group.position.set(c.position.x, 0, c.position.z); root.add(group); cliff(group, 10.1, Y0 - .028, -7.6, 1453 + c.seat * 307, true);
    const ground = art.box(group, new T.MeshBasicMaterial({ visible: false }), [12, .02, 12], [0, Y0, 0]); ground.userData = { pid: c.pid, position: c.position, pick: true }; pickables.push(ground);
    const cornerPoints = []; for (const x of [-6, 6]) for (const z of [-6, 6]) { const p = new T.Vector3(x, Y0 + .025, z); cornerPoints.push(p, new T.Vector3(x - Math.sign(x) * 1.1, Y0 + .025, z), p, new T.Vector3(x, Y0 + .025, z - Math.sign(z) * 1.1)); }
    const zone = new T.LineSegments(art.geometry(new T.BufferGeometry().setFromPoints(cornerPoints)), new T.LineBasicMaterial({ color: SEAT_COLORS[c.seat], transparent: true, opacity: .72 })); group.add(zone);
    const flag = art.flag(c.seat, c.name); flag.group.position.set(-5.7, Y0, -5.7); group.add(flag.group); flag.body.userData = { pid: c.pid, flag: true, position: c.position, pick: true }; pickables.push(flag.body);
    const launcher = art.launcher(); launcher.position.set(c.launcher.x - c.position.x, Y0, c.launcher.z - c.position.z); launcher.rotation.y = Math.atan2(c.position.x, c.position.z); group.add(launcher);
    const rand = seeded(1669 + c.seat * 613), trees = [], rocks = [], meadow = [], flowers = [];
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + .11, r = 8.95 + rand() * .7; trees.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, y: Y0 - .04, h: 2.2 + rand() * 1.5 }); }
    forest(group, trees, true);
    for (let i = 0; i < 34; i++) { const a = i * 2.3999, r = 8.9 + rand() * 2.1; rocks.push({ position: [Math.sin(a) * r, -1.1 - rand() * 3.8, Math.cos(a) * r], scale: [.42 + rand() * .8, .5 + rand() * 1.3, .4 + rand() * .7], rotation: [0, a, .13], color: i % 3 ? '#ede0bd' : '#b6bdb5' }); }
    for (let i = 0; i < 70; i++) { const a = i * 2.3999, r = 6.7 + rand() * 2.1, x = Math.sin(a) * r, z = Math.cos(a) * r; if (Math.abs(x) < 6.35 && Math.abs(z) < 6.35) continue; meadow.push({ position: [x, Y0 + .11, z], scale: [.14 + rand() * .18, .19, .14 + rand() * .18], rotation: [0, a, 0], color: i % 2 ? '#dbe494' : '#87b86c' }); if (i % 4 === 0) flowers.push({ position: [x, Y0 + .27, z], scale: [.07, .07, .07], color: i % 3 ? '#ffdb94' : '#edbac5' }); }
    art.instances(art.rockGeo, art.rock, rocks, group); art.instances(art.gem, art.leafLight, meadow, group); art.instances(art.sphere, art.cream, flowers, group);
    const falls = [], mist = [], inward = Math.atan2(-c.position.x, -c.position.z); for (const offset of [-.52, .49]) { const a = inward + offset, x = Math.sin(a) * 11.85, z = Math.cos(a) * 11.85; falls.push({ position: [x, -4.05, z], scale: [.58, 4.7, .08], rotation: [0, a, 0] }); mist.push({ position: [x, WATER_Y + .03, z], scale: [1.2, .04, .73], rotation: [0, a, 0] }); }
    art.instances(art.boxGeo, art.waterfall, falls, group).castShadow = false;
    const foamMat = new T.MeshBasicMaterial({ color: '#c8eee0', transparent: true, opacity: .5, depthWrite: false, vertexColors: true }); art.instances(art.sphere, foamMat, mist, group).castShadow = false;
    const shore = []; for (let i = 0; i < 42; i++) { const a = i / 42 * Math.PI * 2, b = (i + 1) / 42 * Math.PI * 2, r = 11.8 + Math.sin(i * 3.3) * .3, rr = 12.2 + Math.cos(i * 2.1) * .34, p = angle => [Math.sin(angle) * r, WATER_Y + .025, Math.cos(angle) * r], q = angle => [Math.sin(angle) * rr, WATER_Y + .027, Math.cos(angle) * rr]; shore.push([p(a), q(a), p(b), '#d8f0d7'], [p(b), q(a), q(b), '#77c6c0']); }
    art.mesh(surfaceGeometry(shore), foamMat, null, null, group).castShadow = false;
    castles.set(c.pid, { group, crown: null, flag: flag.group, launcher, zone });
  }
  function buildBridges() {
    if (bridges.children.length || !snapshot?.castles.length) return;
    const planks = [], posts = [], braces = [], ropePoints = [], list = snapshot.castles;
    for (let i = 0; i < (list.length === 2 ? 1 : list.length); i++) { const a = list[i].position, b = list[(i + 1) % list.length].position, dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz), ux = dx / dist, uz = dz / dist, length = dist - 18.5, count = Math.ceil(length / .5), yaw = Math.atan2(ux, uz), height = Y0 - .06;
      for (let j = 0; j <= count; j++) { const t = 9.25 + j / count * length, x = a.x + ux * t, z = a.z + uz * t; planks.push({ position: [x, height, z], scale: [1.65, .18, .44], rotation: [0, yaw, (j % 3 - 1) * .012] }); if (j % 4 === 0 || j === count) for (const side of [-1, 1]) { const px = x + uz * side * .77, pz = z - ux * side * .77; posts.push({ position: [px, height + .43, pz], scale: [.1, 1.05, .1], rotation: [0, yaw, 0] }); if (j < count) { const t2 = 9.25 + Math.min(count, j + 4) / count * length; ropePoints.push(new T.Vector3(px, height + .83, pz), new T.Vector3(a.x + ux * t2 + uz * side * .77, height + .83, a.z + uz * t2 - ux * side * .77)); } } }
      for (const side of [-1, 1]) braces.push({ position: [(a.x + b.x) / 2 + uz * side * .57, height - .28, (a.z + b.z) / 2 - ux * side * .57], scale: [.15, .34, length + .7], rotation: [0, yaw, 0] });
    }
    art.instances(art.boxGeo, art.wood, planks, bridges); art.instances(art.boxGeo, art.dark, posts, bridges); art.instances(art.boxGeo, art.wood, braces, bridges); const rope = new T.LineSegments(art.geometry(new T.BufferGeometry().setFromPoints(ropePoints)), new T.LineBasicMaterial({ color: '#e0bc82' })); bridges.add(rope);
  }
  function attachPick(body, c, p) { body.userData = { pid: c.pid, piece: p.id, crown: !!p.crown, position: c.position, pick: true }; pickables.push(body); }
  function rebuildBatches() {
    if (!batchesDirty) return; batchesDirty = false;
    for (const child of [...pieceLayer.children]) { pieceLayer.remove(child); child.dispose(); }
    const batches = new Map(); root.updateMatrixWorld(true);
    for (const entry of pieces.values()) if (entry.visual && entry.group.visible) entry.visual.traverse(o => { if (!o.isMesh || !o.visible || o.material.visible === false) return; const key = `${o.geometry.uuid}:${o.material.uuid}`; if (!batches.has(key)) batches.set(key, { geometry: o.geometry, material: o.material, transforms: [], colors: [] }); const batch = batches.get(key); batch.transforms.push(o.matrixWorld.clone()); batch.colors.push(o.material === art.blockMats.stone ? entry.tint : null); });
    for (const b of batches.values()) { const mesh = new T.InstancedMesh(b.geometry, b.material, b.transforms.length); b.transforms.forEach((m, i) => { mesh.setMatrixAt(i, m); if (b.material === art.blockMats.stone) mesh.setColorAt(i, b.colors[i]); }); mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.castShadow = mesh.receiveShadow = true; pieceLayer.add(mesh); } const renderer = helper.renderer?.(); if (renderer) renderer.shadowMap.needsUpdate = true;
  }
  function removePiece(id, animate = false) {
    const old = pieces.get(id); if (!old) return; const i = pickables.indexOf(old.body); if (i >= 0) pickables.splice(i, 1); old.group.parent?.remove(old.group); pieces.delete(id); batchesDirty = true;
    if (animate && falling.length < MAX_FALLING) { if (old.visual) old.visual.visible = true; scene.add(old.group); old.group.position.set(old.x, old.y, old.z); falling.push({ group: old.group, age: 0, vy: 0, spin: .6 + falling.length % 3 * .3 }); } else art.releaseObject(old.group);
  }
  function setLauncher(c, weapon, targetPoint) {
    const entry = castles.get(c.pid); if (!entry) return;
    if (entry.launcher.userData.weapon !== weapon) { const old = entry.launcher, next = art.launcher(weapon); next.position.copy(old.position); next.rotation.copy(old.rotation); entry.group.remove(old); art.releaseObject(old); entry.group.add(next); entry.launcher = next; const renderer = helper.renderer?.(); if (renderer) renderer.shadowMap.needsUpdate = true; }
    if (targetPoint) entry.launcher.rotation.y = Math.atan2(c.launcher.x - targetPoint.x, c.launcher.z - targetPoint.z);
  }
  function syncPieces() {
    const keep = new Set();
    for (const c of snapshot.castles) {
      if (!castles.has(c.pid)) island(c);
      const world = castles.get(c.pid); world.zone.visible = snapshot.phase === 'build' && c.pid === snapshot.mine?.pid; world.flag.scale.setScalar(c.pid === selection.target ? 1.1 : 1);
      for (const p of [...c.pieces, c.crown]) { keep.add(p.id); let entry = pieces.get(p.id);
        if (!entry) { const obj = p.crown ? art.crown(c.seat, p) : art.block(p); obj.group.position.set(p.x, p.y + Y0, p.z); if (obj.visual) obj.visual.visible = false; world.group.add(obj.group); attachPick(obj.body, c, p); entry = { ...obj, x: p.x + c.position.x, y: p.y + Y0, z: p.z + c.position.z }; pieces.set(p.id, entry); batchesDirty = true; }
        if (entry.group.userData.hp !== p.hp) { entry.group.visible = p.hp > 0; if (entry.scars) for (const scar of entry.scars) scar.visible = p.hp < p.maxHp * .62; entry.group.userData.hp = p.hp; batchesDirty = true; }
        if (p.crown) { entry.crystal.material.emissiveIntensity = p.hp < p.maxHp * .4 ? .45 : .17; entry.crystal.rotation.y = c.seat * .7; }
      }
      if (c.pid === snapshot.mine?.pid || snapshot.phase === 'build') { const target = snapshot.castles.find(t => t.pid === selection.target), aim = selection.aim; setLauncher(c, snapshot.phase === 'siege' ? selection.weapon || 'ballista' : 'ballista', target && aim ? { x: target.position.x + aim.x, z: target.position.z + aim.z } : null); }
    }
    for (const id of [...pieces.keys()]) if (!keep.has(id)) removePiece(id); buildBridges(); rebuildBatches();
  }
  function removeFlight(id) { const p = projectiles.get(id); if (!p) return; scene.remove(p.group); art.releaseObject(p.group); if (p.trail) { scene.remove(p.trail); p.trail.dispose(); } projectiles.delete(id); }
  function addFlight(shot) {
    if (projectiles.has(shot.id) || projectiles.size >= MAX_PROJECTILES || now() >= shot.impactAt + 100) return;
    const group = art.projectile(shot.weapon); group.traverse(o => { o.castShadow = false; }); scene.add(group); let trail = null; if (shot.weapon !== 'ballista') { trail = art.instances(art.sphere, art.smoke, Array.from({ length: 7 }, () => ({ position: [0, -100, 0], scale: [.01, .01, .01] })), scene); trail.castShadow = false; } projectiles.set(shot.id, { group, shot, trail }); const c = snapshot?.castles.find(c => c.pid === shot.by); if (c) setLauncher(c, shot.weapon, shot.target);
  }
  function burst(event) {
    removeFlight(event.shot); shake = helper.reducedMotion() ? 0 : .13; opts.onEffect?.(event); const point = event.point;
    for (let i = 0; i < 12 && debris.length < MAX_DEBRIS; i++) { const m = i % 3 === 0 ? art.gold : art.blockMats[i % 2 ? 'stone' : 'timber'], group = art.mesh(art.rockGeo, m, [.1 + i % 3 * .08, .14, .12], [point.x, point.y + Y0, point.z], scene), a = i * 2.3999; group.castShadow = false; debris.push({ group, age: 0, vx: Math.sin(a) * (1 + i % 3), vy: 2.5 + i % 4, vz: Math.cos(a) * (1 + i % 3) }); }
  }
  function events(S, fresh) {
    if (fresh || eventId === null) { eventId = Math.max(0, ...S.events.map(e => Number(e.id) || 0)); for (const shot of S.shots) addFlight(shot); return; }
    for (const e of S.events) { if (e.id <= eventId) continue; eventId = e.id; if (e.type === 'shot') { addFlight(e.shot); opts.onEffect?.(e); } else if (e.type === 'collapse') for (const p of e.pieces) removePiece(p.id, true); else if (e.type === 'impact') burst(e); }
  }
  function clearGhost() { if (ghost) { scene.remove(ghost); art.releaseObject(ghost); ghost = null; } }
  function previewSelection() {
    if (!art || !snapshot) return; const c = snapshot.castles.find(c => c.pid === snapshot.mine?.pid), draft = selection.draft, key = draft && c ? `${selection.card}:${draft.x},${draft.y},${draft.z}:${draft.rotation}:${draft.valid}` : '';
    if (key !== ghostKey) { ghostKey = key; clearGhost(); if (draft && c && snapshot.phase === 'build') { const card = snapshot.cards[selection.card], rotated = draft.rotation % 2; if (card) { const w = rotated ? card.d : card.w, d = rotated ? card.w : card.d; ghost = art.block({ ...card, card: selection.card, w, d }).group; ghost.traverse(o => { o.castShadow = false; if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .62; o.material.depthWrite = false; o.material.color.set(draft.valid ? '#a4ffe0' : '#ff8e80'); } }); const outline = new T.LineSegments(art.geometry(new T.EdgesGeometry(new T.BoxGeometry(w, card.h, d))), new T.LineBasicMaterial({ color: draft.valid ? '#d7ffe5' : '#ff856f', transparent: true, opacity: .95 })); outline.position.y = card.h / 2; ghost.add(outline); ghost.position.set(c.position.x + draft.x, Y0 + draft.y, c.position.z + draft.z); scene.add(ghost); } } }
    const target = snapshot.castles.find(c => c.pid === selection.target), aim = selection.aim, weapon = snapshot.weapons[selection.weapon]; reticle.visible = !!(c && target && aim && weapon && snapshot.phase === 'siege');
    const nextKey = reticle.visible ? `${selection.weapon}:${target.pid}:${aim.x},${aim.y},${aim.z}` : '';
    if (nextKey !== previewKey) { previewKey = nextKey; if (preview) { scene.remove(preview); preview.geometry.dispose(); preview.material.dispose(); preview = null; } if (reticle.visible) { const end = { x: target.position.x + aim.x, y: aim.y, z: target.position.z + aim.z }, path = { start: c.launcher, target: end, arc: weapon.arc }, points = []; for (let i = 0; i <= 40; i++) { const p = pointAt(path, i / 40); points.push(new T.Vector3(p.x, p.y, p.z)); } const g = new T.BufferGeometry().setFromPoints(points), m = new T.LineDashedMaterial({ color: '#fff0b7', dashSize: .28, gapSize: .22, transparent: true, opacity: .7 }); preview = new T.Line(g, m); preview.computeLineDistances(); scene.add(preview); reticle.position.set(end.x, end.y + Y0, end.z); } }
  }
  function focus(pid) {
    const c = snapshot?.castles.find(c => c.pid === pid);
    focusedPid = c?.pid || null; manualCamera = false;
    if (!c) { const aspect = camera?.aspect || 1; controls?.focus({ x: 0, y: 0, z: 0 }, { yaw: .42, pitch: .44, distance: (snapshot?.castles.length > 2 ? 73 : 57) / Math.min(1, aspect) }); }
    else controls?.focus({ x: c.position.x, y: 1.7, z: c.position.z }, { yaw: Math.atan2(c.position.x, c.position.z) + .42, pitch: camera.aspect < 1 ? .4 : .34, distance: (camera.aspect < 1 ? 16 : 21) / Math.min(1, camera.aspect) });
  }
  function clearWorld() { for (const p of [...pieces.keys()]) removePiece(p); for (const c of castles.values()) { root.remove(c.group); art.releaseObject(c.group); } castles.clear(); pickables.length = 0; for (const id of [...projectiles.keys()]) removeFlight(id); for (const p of [...falling, ...debris]) { scene.remove(p.group); art.releaseObject(p.group); } falling.length = debris.length = 0; art.releaseObject(bridges); bridges.clear(); rebuildBatches(); }
  const handle = await createThreeView(mount, {
    onContextLost() { opts.onUnavailable?.('The 3D view lost its graphics connection. Rejoin to restore it.'); },
    build(three, h) {
      T = three; helper = h; art = createSiegeArt(T); scene = new T.Scene(); camera = new T.PerspectiveCamera(60, 1, .1, 900); decorate();
      controls = createArenaControls({ element: h.canvas(), camera, target: { x: 0, y: 1, z: 0 }, yaw: .42, pitch: .44, distance: 58, minDistance: 15, maxDistance: 220, minPitch: .25, maxPitch: 1.35, reducedMotion: h.reducedMotion, pick,
        onTap: hit => opts.onPick?.(hit), onHover: hit => opts.onHover?.(hit), hoverKey: hit => hit ? `${hit.pid}:${hit.piece}:${Math.round(hit.point.x * 2)},${Math.round(hit.point.z * 2)}` : '' });
      const trailTransform = new T.Object3D();
      return { scene, camera,
        resize(w, height) { const previousAspect = camera.aspect; camera.aspect = w / height; camera.setViewOffset(w, height, 0, height * .065, w, height); camera.updateProjectionMatrix(); if (snapshot && previousAspect !== camera.aspect && !manualCamera && !controls.getState().userMoved) focus(focusedPid); for (const g of detail) g.visible = w > 430 || height < 480; const mapSize = w <= 600 ? 512 : 1024; if (shadowLight.shadow.mapSize.x !== mapSize) { shadowLight.shadow.map?.dispose(); shadowLight.shadow.map = null; shadowLight.shadow.mapSize.set(mapSize, mapSize); const renderer = h.renderer?.(); if (renderer) renderer.shadowMap.needsUpdate = true; } },
        frame(dt, time) {
          if (disposed) return; const pnow = performance.now(); if (lastFrame) { frameMs.push(pnow - lastFrame); if (frameMs.length > 300) frameMs.shift(); } lastFrame = pnow; frameCount++; controls.update(dt);
          if (shake > 0) { shake = Math.max(0, shake - dt); camera.position.x += Math.sin(time * 80) * shake * .25; } if (reticle.visible) reticle.lookAt(camera.position);
          if (falling.length) { const renderer = h.renderer?.(); if (renderer) renderer.shadowMap.needsUpdate = true; }
          art.water.bumpMap.offset.set(h.reducedMotion() ? 0 : time * .01 % 1, h.reducedMotion() ? 0 : time * .006 % 1);
          if (!h.reducedMotion()) for (const cloud of clouds) cloud.position.x = Math.sin(time * .009) * 4;
          for (const [id, p] of projectiles) { const t = Math.max(0, Math.min((now() - p.shot.startAt) / p.shot.duration, p.shot.hit?.t ?? 1)), point = pointAt(p.shot, t), next = pointAt(p.shot, Math.min(1, t + .005)); p.group.position.set(point.x, point.y, point.z); const dir = new T.Vector3(next.x - point.x, next.y - point.y, next.z - point.z).normalize(); p.group.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
            if (p.trail) { p.trail.visible = !h.reducedMotion(); for (let i = 0; i < 7; i++) { const at = Math.max(0, t - (i + 1) * .015), q = pointAt(p.shot, at), size = at > 0 ? .1 + i * .035 : .001; trailTransform.position.set(q.x, q.y, q.z); trailTransform.scale.setScalar(size); trailTransform.updateMatrix(); p.trail.setMatrixAt(i, trailTransform.matrix); } p.trail.instanceMatrix.needsUpdate = true; }
            if (now() > (p.shot.endAt || p.shot.startAt + p.shot.duration) + 1500) removeFlight(id);
          }
          for (let i = falling.length - 1; i >= 0; i--) { const p = falling[i]; p.age += dt; p.vy -= dt * 15; p.group.position.y += p.vy * dt; if (!h.reducedMotion()) p.group.rotation.z += dt * p.spin; if (p.age >= 1.1) { scene.remove(p.group); art.releaseObject(p.group); falling.splice(i, 1); } }
          for (let i = debris.length - 1; i >= 0; i--) { const p = debris[i]; p.age += dt; p.vy -= dt * 9; p.group.position.x += p.vx * dt; p.group.position.y += p.vy * dt; p.group.position.z += p.vz * dt; if (!h.reducedMotion()) p.group.rotation.x += dt * 4; if (p.age >= 1) { scene.remove(p.group); debris.splice(i, 1); } }
        }, dispose() { controls?.dispose(); clearGhost(); art?.dispose(); },
      };
    },
  });
  if (handle.fallback) return { ...handle, update() {}, dispose() { handle.dispose?.(); }, focus() {}, zoom() {}, orbit() {}, cancel() {}, setEnabled() {}, isSettled() { return true; }, debug() { return { fallback: true }; } };
  return {
    fallback: false,
    update(S, sel = {}) {
      if (disposed) return; const fresh = instance !== S.instanceId;
      if (fresh || round !== S.round) { if (fresh && castles.size && [...castles.keys()].join(',') !== S.castles.map(c => c.pid).join(',')) clearWorld(); else { for (const id of [...pieces.keys()]) removePiece(id); for (const id of [...projectiles.keys()]) removeFlight(id); for (const p of [...falling, ...debris]) { scene.remove(p.group); art.releaseObject(p.group); } falling.length = debris.length = 0; } ghostKey = ''; previewKey = ''; clearGhost(); }
      snapshot = S; selection = sel; for (const shot of S.shots) if (projectiles.has(shot.id)) projectiles.get(shot.id).shot = shot; events(S, fresh); syncPieces(); previewSelection();
      if (fresh || round !== S.round || phase !== S.phase) { if (S.phase === 'build') focus(S.mine?.pid); else if (S.phase === 'siege') focus(selection.target || S.castles.find(c => c.pid !== S.mine?.pid && c.alive)?.pid || S.mine?.pid); else if (fresh) focus(null); } instance = S.instanceId; round = S.round; phase = S.phase;
    }, focus,
    isSettled() { return projectiles.size === 0 && debris.length === 0 && falling.length === 0; },
    zoom(direction) { manualCamera = true; const g = controls.getState().goal; controls.focus(g.target, { distance: g.distance * (direction > 0 ? .85 : 1.18), yaw: g.yaw, pitch: g.pitch }); },
    orbit(dx, dy) { manualCamera = true; const g = controls.getState().goal; controls.focus(g.target, { yaw: g.yaw + dx, pitch: g.pitch + dy, distance: g.distance }); },
    setEnabled(value) { controls.setEnabled(value); }, cancel() { controls.cancel(); }, thumbnails(cards, weapons) { return art.thumbnails(cards, weapons); },
    debug() { const sorted = frameMs.slice().sort((a, b) => a - b); return { threeRevision: T.REVISION, artResources: art.resources(), blockBatches: pieceLayer.children.length, panorama: { ...panorama }, textureBudget: { shared: 8, pixelsPerShared: 256 * 256, flags: castles.size, waterBumpColorSpace: art.water.bumpMap.colorSpace, panoramaGpuRgbaBytes: panorama.width * panorama.height * 4 }, limits: { pieces: 4 * 65, projectiles: MAX_PROJECTILES, trailParticlesPerShot: 7, debris: MAX_DEBRIS, falling: MAX_FALLING }, frames: frameCount, medianMs: sorted[Math.floor(sorted.length * .5)] || 0, p95Ms: sorted[Math.floor(sorted.length * .95)] || 0, pieces: pieces.size, projectiles: projectiles.size, debris: debris.length, falling: falling.length, calls: handle.renderer.info.render.calls, triangles: handle.renderer.info.render.triangles, geometries: handle.renderer.info.memory.geometries, textures: handle.renderer.info.memory.textures || 0, camera: controls.getState() }; },
    dispose() { if (disposed) return; disposed = true; handle.dispose(); },
  };
}
