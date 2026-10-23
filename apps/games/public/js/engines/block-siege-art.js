/* Original, deterministic Castle art: shared limestone/timber textures and
 * meshes. Collider proxies stay separate from the bevels and battlements. */
export const SEAT_COLORS = ['#ff7d74', '#6ee8c0', '#ffdb68', '#bb99ff'];
export const SEAT_GLYPHS = ['◇', '✚', '△', '☆'];
export function createSiegeArt(T) {
  const textures = [], materials = [], geometries = [], blockGeometries = new Map();
  const permanentMaterials = new Set(), permanentGeometries = new Set(), permanentTextures = new Set();
  const mat = (color, extra = {}) => { const m = new T.MeshStandardMaterial({ color, roughness: .86, ...extra }); materials.push(m); return m; };
  const geometry = g => { geometries.push(g); return g; };
  const sharedGeometry = g => { geometry(g); permanentGeometries.add(g); return g; };
  const registerTexture = t => { textures.push(t); return t; };
  function texture(kind) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    let seed = 3719; const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
    x.fillStyle = { stone: '#807c6d', timber: '#ae7647', iron: '#6c7880', cliff: '#acb4b0', grass: '#76964d', water: '#489fa7', 'water-bump': '#808080', waterfall: '#70b7be' }[kind]; x.fillRect(0, 0, 256, 256);
    if (kind === 'stone') {
      for (let row = 0; row < 4; row++) for (let col = -1; col < 3; col++) {
        const left = col * 128 + row % 2 * 64, top = row * 64;
        const tint = Math.floor(165 + random() * 37); x.fillStyle = `rgb(${tint + 19},${tint + 13},${tint - 5})`; x.fillRect(left + 3, top + 3, 122, 58);
        x.fillStyle = '#fff2d16b'; x.fillRect(left + 5, top + 4, 117, 3); x.fillStyle = '#655e5273'; x.fillRect(left + 3, top + 57, 122, 4); x.fillRect(left + 121, top + 5, 4, 52);
      }
    }
    if (kind === 'water' || kind === 'water-bump') {
      // Periodic directional waves stay seamless without painted foam loops.
      // The grayscale height map is linear data, separate from the subtle color.
      const image = x.createImageData(256, 256), base = [72, 159, 167];
      for (let y = 0; y < 256; y++) for (let u = 0; u < 256; u++) {
        const a = u / 256 * Math.PI * 2, b = y / 256 * Math.PI * 2;
        const wave = Math.sin(a * 5 + b * 3 + .6 * Math.sin(b)) * .32 + Math.sin(a * 13 - b * 2) * .1 + Math.sin(a * 27 + b * 8) * .045;
        const i = (y * 256 + u) * 4;
        for (let c = 0; c < 3; c++) image.data[i + c] = kind === 'water-bump' ? 128 + wave * 24 : base[c] + wave * 5;
        image.data[i + 3] = 255;
      }
      x.putImageData(image, 0, 0);
    } else for (let i = 0; i < (kind === 'grass' ? 2400 : 850); i++) {
      const light = random() > .52; x.fillStyle = light ? `rgba(255,248,214,${random() * .12})` : `rgba(47,39,29,${random() * .15})`;
      x.fillRect(random() * 256, random() * 256, kind === 'timber' ? 15 + random() * 100 : 1 + random() * 6, .4 + random() * (kind === 'cliff' ? 4 : 2));
    }
    if (kind === 'timber') {
      for (let i = 0; i < 4; i++) { x.fillStyle = '#4f321a66'; x.fillRect(0, i * 64, 256, 2); x.strokeStyle = '#4d2c1777'; x.lineWidth = 1.4; x.beginPath(); x.ellipse(43 + i * 46, 25 + i * 57, 19, 4, -.08, 0, Math.PI * 2); x.stroke(); }
    }
    if (kind === 'cliff') for (let i = 0; i < 9; i++) { x.fillStyle = i % 2 ? '#e1dac621' : '#4e575a28'; x.fillRect(0, i * 29 + random() * 5, 256, 2 + random() * 6); }
    if (kind === 'iron') { x.strokeStyle = '#d5e1df66'; x.lineWidth = 3; x.strokeRect(6, 6, 244, 244); for (const u of [15, 240]) for (const v of [15, 240]) { x.fillStyle = '#2c414c'; x.fillRect(u - 3, v - 3, 6, 6); x.fillStyle = '#c2c9bf'; x.fillRect(u - 2, v - 3, 3, 2); } }
    if (kind === 'waterfall') for (let i = 0; i < 95; i++) { x.fillStyle = i % 4 ? '#e7fff282' : '#299ca966'; x.fillRect(random() * 256, random() * 256, 1 + random() * 4, 22 + random() * 140); }
    const t = new T.CanvasTexture(c); t.colorSpace = kind === 'water-bump' ? T.NoColorSpace : T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; textures.push(t); return t;
  }
  const blockMats = Object.fromEntries(['stone', 'timber', 'iron'].map(k => [k, mat(0xffffff, { map: texture(k), metalness: k === 'iron' ? .64 : 0, roughness: k === 'iron' ? .47 : .91 })]));
  const cliff = mat('#f3eeee', { map: texture('cliff'), vertexColors: true }), grass = mat('#eef4de', { map: texture('grass'), vertexColors: true });
  const dark = mat('#314052'), metal = mat('#a7bcc3', { metalness: .72, roughness: .31 }), wood = mat('#b3824e', { map: blockMats.timber.map }), gold = mat('#eebd5d', { metalness: .46, roughness: .36 }), cream = mat('#f9eacb'), coral = mat('#e36c54');
  const leaf = mat('#47765a', { vertexColors: true }), leafLight = mat('#588950'), rock = mat('#bdc1ad'), soil = mat('#897b59'), scarMat = mat('#655442');
  const smoke = new T.MeshBasicMaterial({ color: '#d4d6d0', transparent: true, opacity: .3, depthWrite: false }); materials.push(smoke);
  const waterMap = texture('water'), waterBump = texture('water-bump'); waterMap.repeat.set(10, 10); waterBump.repeat.set(38, 38);
  const water = mat('#a3dfd6', { map: waterMap, bumpMap: waterBump, bumpScale: .16, metalness: .08, roughness: .61 });
  const waterfall = new T.MeshBasicMaterial({ map: texture('waterfall'), color: '#defff6', transparent: true, opacity: .86, depthWrite: false }); materials.push(waterfall);
  const proxyMat = new T.MeshBasicMaterial({ visible: false }); materials.push(proxyMat);
  const boxGeo = sharedGeometry(new T.BoxGeometry(1, 1, 1)), cylinder = sharedGeometry(new T.CylinderGeometry(1, 1, 1, 12)), cone = sharedGeometry(new T.ConeGeometry(1, 1, 8)), gem = sharedGeometry(new T.OctahedronGeometry(1)), rockGeo = sharedGeometry(new T.IcosahedronGeometry(1, 0));
  const sphere = sharedGeometry(new T.SphereGeometry(1, 9, 6));
  // Instanced cliff/leaf materials multiply both geometry and instance color.
  // Primitive geometry needs a white base, otherwise the bank renders black.
  for (const g of [boxGeo, cylinder, cone, gem, rockGeo, sphere]) g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  function fir(branches) {
    const positions = [], colors = [];
    for (let tier = 0; tier < 5; tier++) for (let i = 0; i < branches; i++) {
      const angle = i / branches * Math.PI * 2, next = (i + 1) / branches * Math.PI * 2, radius = 1 - tier * .17, y = tier * .16, tip = [Math.sin(angle + .14) * radius * .14, y + .39, Math.cos(angle + .14) * radius * .14];
      for (const p of [[Math.sin(angle) * radius, y + Math.sin(i * 3 + tier) * .028, Math.cos(angle) * radius], [Math.sin(next) * radius * .87, y + .044, Math.cos(next) * radius * .87], tip]) { positions.push(...p); const shade = i % 2 ? .76 : .99; colors.push(shade, shade, shade * .91); }
    }
    const g = sharedGeometry(new T.BufferGeometry()); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); g.computeVertexNormals(); return g;
  }
  const firGeo = fir(20), firCoarse = fir(10);
  for (const m of materials) permanentMaterials.add(m); for (const t of textures) permanentTextures.add(t);
  function mesh(g, m, scale, position, parent) { const o = new T.Mesh(g, m); if (scale) o.scale.set(...scale); if (position) o.position.set(...position); o.castShadow = o.receiveShadow = true; if (parent) parent.add(o); return o; }
  function box(parent, material, scale, position) { return mesh(boxGeo, material, scale, position, parent); }
  function instances(g, m, items, parent) {
    const o = new T.InstancedMesh(g, m, items.length), transform = new T.Object3D();
    for (let i = 0; i < items.length; i++) { const p = items[i]; transform.position.set(...p.position); transform.scale.set(...(p.scale || [1, 1, 1])); transform.rotation.set(...(p.rotation || [0, 0, 0])); transform.updateMatrix(); o.setMatrixAt(i, transform.matrix); if (p.color) o.setColorAt(i, new T.Color(p.color)); }
    o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; o.castShadow = o.receiveShadow = true; parent.add(o); return o;
  }
  function batchDecor(group) {
    group.updateMatrixWorld(true); const inverse = group.matrixWorld.clone().invert(), batches = new Map();
    group.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.material.visible === false) return; const key = `${o.geometry.uuid}:${o.material.uuid}`; if (!batches.has(key)) batches.set(key, []); batches.get(key).push(o); });
    for (const list of batches.values()) if (list.length > 1) { const first = list[0], batch = new T.InstancedMesh(first.geometry, first.material, list.length); list.forEach((o, i) => { batch.setMatrixAt(i, inverse.clone().multiply(o.matrixWorld)); o.parent.remove(o); }); batch.instanceMatrix.needsUpdate = true; batch.castShadow = batch.receiveShadow = true; group.add(batch); }
    return group;
  }
  function bevel(w, h, d) {
    const key = `${w},${h},${d}`; if (blockGeometries.has(key)) return blockGeometries.get(key);
    const edge = Math.min(.045, h * .08), shape = new T.Shape(), x = w / 2 - edge, y = h / 2 - edge;
    shape.moveTo(-x, -y); shape.lineTo(x, -y); shape.lineTo(x, y); shape.lineTo(-x, y); shape.closePath();
    const g = sharedGeometry(new T.ExtrudeGeometry(shape, { depth: d - edge * 2, bevelEnabled: true, bevelSize: edge, bevelThickness: edge, bevelSegments: 1, steps: 1, curveSegments: 1 })); g.translate(0, h / 2, -d / 2 + edge);
    // World-sized UVs keep the mortar courses and grain consistent as blocks stack.
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * .55, uv.getY(i) * .55); blockGeometries.set(key, g); return g;
  }
  function block(p) {
    const group = new T.Group(), visual = new T.Group(); group.add(visual); const bodyHeight = p.card === 'parapet' ? p.h * .72 : p.h;
    mesh(bevel(p.w, bodyHeight, p.d), blockMats[p.material] || blockMats.stone, null, null, visual);
    if (p.card === 'parapet') for (const x of [-.72, 0, .72]) mesh(bevel(p.w * .22, p.h * .28, p.d), blockMats[p.material], null, [x * p.w / 2, bodyHeight, 0], visual);
    if (p.material === 'timber') for (const x of [-.34, .34]) box(visual, dark, [.07, p.h * .94, p.d * .98], [p.w * x, p.h / 2, 0]);
    const scars = [];
    for (const [x, y, angle] of [[-.12, .6, .62], [.08, .45, -.4], [.11, .69, -.72]]) { const s = box(visual, scarMat, [.019, p.h * .25, .008], [x * p.w, y * bodyHeight, p.d / 2 - .012]); s.rotation.z = angle; s.visible = false; scars.push(s); }
    const body = box(group, proxyMat, [p.w, p.h, p.d], [0, p.h / 2, 0]);
    let seed = 0; for (const ch of String(p.id || p.card || 'stone')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const tint = new T.Color(p.material === 'stone' ? ['#ffffff', '#e8e3d5', '#d7dfd7', '#f1e4ce', '#d5d6c8'][seed % 5] : '#ffffff');
    return { group, body, visual, scars, tint };
  }
  function crown(seat, p = { w: 1.2, h: 1.8, d: 1.2 }) {
    const group = new T.Group(), color = SEAT_COLORS[seat];
    mesh(cylinder, gold, [.59, .16, .59], [0, .09, 0], group); mesh(cylinder, dark, [.52, .26, .52], [0, .26, 0], group);
    const crystalMat = mat(color, { metalness: .18, roughness: .23, emissive: color, emissiveIntensity: .17 });
    const crystal = mesh(gem, crystalMat, [.46, .66, .46], [0, 1.04, 0], group);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(cone, gold, [.09, .32, .09], [Math.sin(a) * .49, .49, Math.cos(a) * .49], group); }
    const body = box(group, proxyMat, [p.w, p.h, p.d], [0, p.h / 2, 0]); batchDecor(group); return { group, body, crystal };
  }
  function projectile(kind) {
    const group = new T.Group();
    if (kind === 'ballista') {
      mesh(cylinder, wood, [.042, 1.6, .042], [0, 0, 0], group); mesh(cone, metal, [.14, .31, .14], [0, .94, 0], group);
      for (const a of [0, Math.PI / 2]) { const f = box(group, cream, [.36, .29, .022], [0, -.55, 0], group); f.rotation.y = a; }
    } else if (kind === 'rocket') {
      mesh(cylinder, metal, [.17, .86, .17], [0, 0, 0], group); mesh(cone, coral, [.175, .36, .175], [0, .61, 0], group); mesh(cylinder, dark, [.18, .12, .18], [0, -.41, 0], group);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const f = box(group, dark, [.045, .33, .34], [Math.sin(a) * .18, -.3, Math.cos(a) * .18]); f.rotation.y = a; }
      mesh(cone, gold, [.09, .52, .09], [0, -.74, 0], group).rotation.z = Math.PI;
    } else { mesh(sphere, dark, [.31, .34, .31], [0, 0, 0], group); mesh(cylinder, metal, [.17, .07, .17], [0, .29, 0], group); box(group, gold, [.035, .16, .035], [0, .4, 0]); }
    return batchDecor(group);
  }
  function launcher(kind = 'ballista') {
    const group = new T.Group(); box(group, wood, [1.7, .2, 1.45], [0, .28, 0]);
    for (const x of [-.83, .83]) for (const z of [-.48, .48]) { const wheel = mesh(cylinder, dark, [.31, .17, .31], [x, .27, z], group); wheel.rotation.z = Math.PI / 2; mesh(cylinder, gold, [.09, .18, .09], [x, .27, z], group).rotation.z = Math.PI / 2; }
    if (kind === 'ballista') {
      for (const x of [-.45, .45]) box(group, wood, [.18, .83, .18], [x, .73, .25]);
      box(group, metal, [.13, .14, 1.85], [0, 1.22, -.15]); box(group, wood, [.26, .19, 1.7], [0, 1.11, -.15]);
      for (const side of [-1, 1]) { const arm = box(group, wood, [1.02, .15, .19], [side * .5, 1.18, -.42]); arm.rotation.y = side * -.23; const brace = box(group, metal, [.08, .13, .42], [side * .55, 1.25, -.44]); brace.rotation.y = side * -.23; }
      const ropeMat = new T.LineBasicMaterial({ color: '#e4cc91' }); materials.push(ropeMat);
      const rope = new T.Line(geometry(new T.BufferGeometry().setFromPoints([new T.Vector3(-1, 1.19, -.52), new T.Vector3(0, 1.19, .55), new T.Vector3(1, 1.19, -.52)])), ropeMat); group.add(rope);
      const bolt = projectile('ballista'); bolt.scale.setScalar(.65); bolt.rotation.x = -Math.PI / 2; bolt.position.set(0, 1.35, -.1); group.add(bolt);
    } else if (kind === 'mortar') {
      mesh(cylinder, gold, [.47, .17, .47], [0, .48, 0], group); const barrel = new T.Group(); barrel.position.set(0, .77, -.1); barrel.rotation.x = -.68; group.add(barrel);
      mesh(cylinder, dark, [.39, .98, .39], [0, .25, 0], barrel); mesh(cylinder, metal, [.43, .14, .43], [0, .69, 0], barrel); mesh(cylinder, dark, [.29, .015, .29], [0, .77, 0], barrel);
      for (const x of [-.57, .57]) box(group, wood, [.17, .5, .56], [x, .55, 0]);
    } else {
      const rack = new T.Group(); rack.position.set(0, .8, 0); rack.rotation.x = -.72; group.add(rack);
      for (const x of [-.29, .29]) { const tube = mesh(cylinder, dark, [.235, 1.15, .235], [x, .2, 0], rack); mesh(cylinder, metal, [.25, .12, .25], [x, .77, 0], rack); const rocket = projectile('rocket'); rocket.scale.setScalar(.71); rocket.position.set(x, .32, 0); rack.add(rocket); tube.receiveShadow = true; }
      for (const x of [-.45, .45]) box(group, metal, [.12, .65, .15], [x, .69, .25]);
    }
    group.userData.weapon = kind; return batchDecor(group);
  }
  function flag(seat) {
    const group = new T.Group(); mesh(cylinder, wood, [.055, 3.4, .055], [0, 1.7, 0], group); mesh(sphere, gold, [.09, .09, .09], [0, 3.46, 0], group);
    const c = document.createElement('canvas'); c.width = 128; c.height = 160; const x = c.getContext('2d'); x.fillStyle = SEAT_COLORS[seat]; x.fillRect(0, 0, 128, 160); x.fillStyle = '#263d43'; x.fillRect(0, 0, 8, 160); x.fillStyle = '#fff3cf'; x.font = 'bold 66px sans-serif'; x.textAlign = 'center'; x.fillText(SEAT_GLYPHS[seat], 69, 108);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; textures.push(t); const m = mat(0xffffff, { map: t, side: T.DoubleSide });
    const shape = new T.Shape(); shape.moveTo(0, 0); shape.lineTo(1.26, -.08); shape.lineTo(1.2, -1.66); shape.lineTo(.6, -1.39); shape.lineTo(0, -1.64); shape.closePath();
    const g = geometry(new T.ShapeGeometry(shape)), uv = g.attributes.uv, pos = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 1.26, (pos.getY(i) + 1.66) / 1.66);
    const banner = mesh(g, m, null, [.06, 3.14, 0], group); banner.rotation.y = -.24; return { group, body: banner };
  }
  function thumbnails(cards, weapons) {
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(180, 128); renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(35, 180 / 128, .1, 30); scene.add(new T.HemisphereLight('#fff4d5', '#4a6782', 1.6)); const light = new T.DirectionalLight('#ffe8b8', 2.1); light.position.set(-3, 5, 4); scene.add(light);
    const urls = {};
    for (const [id, card] of Object.entries({ ...cards, ...weapons })) { const group = card.w ? block({ ...card, card: id }).group : launcher(id); scene.add(group); group.updateMatrixWorld(true); const bounds = new T.Box3(); group.traverse(o => { if (o.isMesh && o.material.visible !== false && o.visible) { if (o.isInstancedMesh) { o.computeBoundingBox(); bounds.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); } else { o.geometry.computeBoundingBox(); bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } } }); const center = bounds.getCenter(new T.Vector3()), sphere = bounds.getBoundingSphere(new T.Sphere()); const distance = sphere.radius / Math.tan(camera.fov * Math.PI / 360) * 1.09; camera.position.copy(center).add(new T.Vector3(1, .72, 1.3).normalize().multiplyScalar(distance)); camera.lookAt(center); renderer.render(scene, camera); urls[id] = renderer.domElement.toDataURL('image/png'); scene.remove(group); releaseObject(group); }
    renderer.dispose(); renderer.forceContextLoss(); return urls;
  }
  function releaseObject(object) {
    const seenGeometries = new Set(), seenMaterials = new Set(), seenTextures = new Set();
    object.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.geometry && !permanentGeometries.has(o.geometry)) seenGeometries.add(o.geometry); const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of list) if (!permanentMaterials.has(m)) { seenMaterials.add(m); for (const v of Object.values(m)) if (v?.isTexture && !permanentTextures.has(v)) seenTextures.add(v); } });
    for (const [list, values] of [[textures, seenTextures], [materials, seenMaterials], [geometries, seenGeometries]]) for (const value of values) { value.dispose(); const i = list.indexOf(value); if (i >= 0) list.splice(i, 1); }
  }
  return { block, crown, projectile, launcher, flag, mesh, box, instances, mat, geometry, registerTexture, boxGeo, gem, cylinder, cone, sphere, rockGeo, firGeo, firCoarse, blockMats, cliff, grass, leaf, leafLight, rock, soil, dark, metal, wood, gold, cream, smoke, water, waterfall, thumbnails, releaseObject, resources() { return { geometries: geometries.length, materials: materials.length, textures: textures.length }; },
    dispose() { for (const t of textures) t.dispose(); for (const m of materials) m.dispose(); for (const g of geometries) g.dispose(); } };
}
