import { nameOf } from "../util.js";
import { batchView, html, chip, watch } from "./b6-kit.js";
import { sceneView, canvasSize } from "./b6-three.js";

const zones = [
  "Top left",
  "Top centre",
  "Top right",
  "Bottom left",
  "Bottom centre",
  "Bottom right",
];
const zoneXY = (n) => ({ x: ((n % 3) - 1) * 2.1, y: n < 3 ? 2.3 : 0.65 });
function pose(S, api, reduced) {
  const last = S.phase === "reveal" ? S.last : null;
  const t = last
    ? reduced
      ? 1
      : Math.min(1, Math.max(0, (api.now() - last.shotAt) / 1400))
    : 0;
  const shot = zoneXY(last?.zone ?? 4),
    dive = zoneXY(last?.dive ?? 4);
  const goalY = last?.outcome === "miss" ? 4 : shot.y;
  return {
    ball: {
      x: shot.x * t,
      y: 0.22 + (goalY - 0.22) * t + Math.sin(t * Math.PI) * 0.6,
      z:
        7 * (1 - t) - (last?.outcome === "goal" ? Math.max(0, t - 0.8) * 4 : 0),
    },
    keeper: {
      x: dive.x * t,
      y: 0.9 + Math.max(0, dive.y - 1) * t,
      lean: -dive.x * t * 0.25,
    },
  };
}
function paint(canvas, S, api) {
  const { ctx, w, h } = canvasSize(canvas);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targets = canvas.parentElement.querySelector(".pk6-zones");
  if (
    targets &&
    canvas.closest(".pk6-pitch").dataset.renderer === "2d" &&
    targets.style.left !== "12%"
  ) {
    targets.style.left = "12%";
    targets.style.top = "12%";
    targets.style.width = "76%";
    targets.style.height = "62%";
  }
  const p = pose(S, api, reduced),
    x = w * 0.12,
    y = h * 0.12,
    gw = w * 0.76,
    gh = h * 0.62;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#345b7a");
  sky.addColorStop(1, "#43a385");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? "#339477" : "#2d896d";
    ctx.fillRect(0, h * 0.55 + i * h * 0.06, w, h * 0.06);
  }
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 30; col++) {
      ctx.fillStyle = ["#ffe2a4", "#94d7ca", "#df9cac", "#416078"][
        (row + col) % 4
      ];
      ctx.beginPath();
      ctx.ellipse(
        (col * w) / 29,
        h * 0.035 + row * h * 0.04,
        3,
        5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  ctx.fillStyle = "#0c3439";
  ctx.fillRect(x, y, gw, gh);
  ctx.strokeStyle = "#a4c5bd";
  ctx.lineWidth = 1;
  for (let i = 1; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (gw * i) / 12, y);
    ctx.lineTo(x + (gw * i) / 12, y + gh);
    ctx.stroke();
  }
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(x, y + (gh * i) / 6);
    ctx.lineTo(x + gw, y + (gh * i) / 6);
    ctx.stroke();
  }
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.strokeRect(x, y, gw, gh);
  const kx = w / 2 + (p.keeper.x / 6) * gw,
    ky = y + gh - (p.keeper.y / 3) * gh;
  ctx.save();
  ctx.translate(kx, ky);
  ctx.rotate(p.keeper.lean);
  ctx.lineCap = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#174357";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 6, 16);
    ctx.lineTo(side * 10, 37);
    ctx.stroke();
    ctx.strokeStyle = "#1f9a9a";
    ctx.beginPath();
    ctx.moveTo(side * 8, 0);
    ctx.lineTo(side * 27, 8);
    ctx.stroke();
    ctx.fillStyle = "#fff2d1";
    ctx.beginPath();
    ctx.ellipse(side * 30, 8, 6, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#174357";
  }
  ctx.fillStyle = "#167d85";
  ctx.beginPath();
  ctx.roundRect(-12, -8, 24, 30, 8);
  ctx.fill();
  ctx.fillStyle = "#ffc767";
  ctx.fillRect(-10, -3, 20, 4);
  ctx.fillStyle = "#ffe6c8";
  ctx.beginPath();
  ctx.arc(0, -17, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#493545";
  ctx.beginPath();
  ctx.ellipse(0, -24, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#183650";
  for (const x of [-4, 4]) {
    ctx.beginPath();
    ctx.arc(x, -17, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const bx = w / 2 + (p.ball.x / 6) * gw,
    by = y + gh - (p.ball.y / 3) * gh + (p.ball.z / 7) * h * 0.16;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#17243a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(bx, by, 8 + (p.ball.z / 7) * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
// A small toy stadium. Reusable meshes/typed buffers keep the kick loop allocation-free.
function build(T, helper, get) {
  const scene = new T.Scene(),
    night = document.documentElement.dataset.theme === "night";
  scene.background = new T.Color(night ? "#192d50" : "#b5dfe9");
  scene.fog = new T.Fog(scene.background, 24, 55);
  const camera = new T.OrthographicCamera(-5, 5, 3, -3, 0.1, 80);
  const pitch = helper.canvas().closest(".pk6-pitch"),
    targets = pitch.querySelector(".pk6-zones"),
    banner = pitch.querySelector(".pk6-banner"),
    cue = pitch.querySelector(".pk6-runup");
  const renderer = helper.renderer();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  scene.add(new T.HemisphereLight(night ? "#b8d9ff" : "#ffffff", "#306a61", 2));
  const light = new T.DirectionalLight("#fff5db", 3.1);
  light.position.set(-5, 10, 8);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, {
    left: -12,
    right: 12,
    top: 12,
    bottom: -12,
    far: 35,
  });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.normalBias = 0.035;
  scene.add(light);
  const mat = (color, extra = {}) =>
    new T.MeshStandardMaterial({ color, roughness: 0.72, ...extra });
  const white = mat("#fff9e8"),
    teal = mat("#167d85"),
    ink = mat("#183650"),
    skin = mat("#e5ac7c"),
    glove = mat("#ffefce"),
    orange = mat("#ffb345"),
    hair = mat("#493545");
  const box = new T.BoxGeometry(1, 1, 1),
    sphere = new T.SphereGeometry(1, 16, 12),
    capsule = new T.CapsuleGeometry(0.5, 1, 5, 12);
  function mesh(
    geo,
    material,
    x,
    y,
    z,
    sx = 1,
    sy = 1,
    sz = 1,
    parent = scene,
  ) {
    const m = new T.Mesh(geo, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function bar(x, y, z, w, h, d, m = white, parent = scene) {
    return mesh(box, m, x, y, z, w, h, d, parent);
  }
  mesh(box, mat("#26896b"), 0, -0.16, 3, 30, 0.25, 28);
  const stripeMat = mat("#329b79");
  const stripes = new T.InstancedMesh(box, stripeMat, 9),
    dummy = new T.Object3D();
  for (let i = 0; i < 9; i++) {
    dummy.position.set(0, -0.025, -8 + i * 2.8);
    dummy.scale.set(28, 0.012, 1.4);
    dummy.updateMatrix();
    stripes.setMatrixAt(i, dummy.matrix);
  }
  stripes.receiveShadow = true;
  scene.add(stripes);
  // Painted goal area and the real penalty spot.
  bar(0, 0.005, 3.1, 10, 0.016, 0.055);
  bar(-5, 0.005, 0.6, 0.055, 0.016, 5);
  bar(5, 0.005, 0.6, 0.055, 0.016, 5);
  const spot = mesh(
    new T.CylinderGeometry(0.12, 0.12, 0.012, 24),
    white,
    0,
    0.018,
    6.2,
  );
  const arc = mesh(
    new T.TorusGeometry(3.1, 0.025, 5, 60, Math.PI),
    white,
    0,
    0.018,
    5.9,
  );
  arc.rotation.set(-Math.PI / 2, 0, 0);
  // Stadium bowl, alternating crowd shirts in one instanced draw.
  const stand = mat(night ? "#263f62" : "#548394"),
    trim = mat("#e9cf97");
  for (let row = 0; row < 5; row++)
    bar(0, 0.15 + row * 0.35, -3.5 - row * 0.8, 25, 0.7, 1.05, stand);
  bar(0, 0.4, -2.65, 25, 0.8, 0.16, teal);
  bar(0, 0.85, -2.65, 25, 0.07, 0.19, trim);
  const crowd = new T.InstancedMesh(
      new T.SphereGeometry(1, 8, 6),
      mat("#ffffff"),
      300,
    ),
    crowdColor = new T.Color();
  const shirts = ["#ffd17e", "#7fcfc3", "#f299a8", "#d7e5e9", "#536d93"];
  for (let i = 0; i < 300; i++) {
    const row = Math.floor(i / 60);
    dummy.position.set(
      ((i % 60) - 29.5) * 0.39,
      0.6 + row * 0.35,
      -3.5 - row * 0.8,
    );
    dummy.scale.set(0.12, 0.17 + (i % 3) * 0.018, 0.12);
    dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
    crowd.setColorAt(i, crowdColor.set(shirts[(i * 7 + row) % 5]));
  }
  scene.add(crowd);
  // Floodlight clusters, pennants and ad-board stripes make a stadium silhouette.
  const lamps = mat("#fff8d7", { emissive: "#ffeab5", emissiveIntensity: 1.8 });
  for (const x of [-3.85, 3.85]) {
    bar(x, 1.7, -2.9, 0.1, 3.4, 0.1, ink);
    bar(x, 3.4, -2.9, 1.3, 0.6, 0.2, ink);
    for (let i = 0; i < 8; i++)
      bar(
        x + ((i % 4) - 1.5) * 0.31,
        3.24 + Math.floor(i / 4) * 0.32,
        -2.74,
        0.23,
        0.2,
        0.08,
        lamps,
      );
  }
  for (let i = -5; i <= 5; i++) {
    bar(i * 2.1, 0.46, -2.53, 0.85, 0.22, 0.04, i % 2 ? orange : white);
  }
  // Rounded posts and a flexible back net. Original vertex positions never change.
  const postGeo = new T.CylinderGeometry(0.075, 0.075, 1, 12);
  mesh(postGeo, white, -3.2, 1.6, 0, 1, 3.2, 1);
  mesh(postGeo, white, 3.2, 1.6, 0, 1, 3.2, 1);
  const cross = mesh(postGeo, white, 0, 3.2, 0, 1, 6.55, 1);
  cross.rotation.z = Math.PI / 2;
  for (const x of [-3.2, 3.2]) {
    bar(x, 1.6, -0.95, 0.045, 3.2, 0.045);
    bar(x, 3.2, -0.48, 0.045, 0.045, 0.95);
  }
  const vertices = [];
  function line(x1, y1, z1, x2, y2, z2, steps = 16) {
    for (let i = 0; i < steps; i++)
      for (const t of [i / steps, (i + 1) / steps])
        vertices.push(
          x1 + (x2 - x1) * t,
          y1 + (y2 - y1) * t,
          z1 + (z2 - z1) * t,
        );
  }
  for (let x = -3.2; x <= 3.21; x += 0.32) line(x, 0, -0.95, x, 3.2, -0.95);
  for (let y = 0; y <= 3.21; y += 0.32) {
    line(-3.2, y, -0.95, 3.2, y, -0.95);
    for (const x of [-3.2, 3.2]) line(x, y, 0, x, y, -0.95, 3);
  }
  const netGeo = new T.BufferGeometry(),
    original = new Float32Array(vertices),
    netPos = new T.Float32BufferAttribute(vertices, 3);
  netGeo.setAttribute("position", netPos);
  const net = new T.LineSegments(
    netGeo,
    new T.LineBasicMaterial({
      color: "#e6fff1",
      transparent: true,
      opacity: 0.48,
    }),
  );
  net.name = "pk6-net";
  scene.add(net);
  // Merge the stadium by material: its many authored parts cost only a few
  // draw calls. Crowd and mowing stripes already use instancing.
  scene.updateMatrixWorld(true);
  const batches = new Map(),
    retired = new Set();
  for (const node of [...scene.children]) {
    if (!node.isMesh || node.isInstancedMesh) continue;
    const g = node.geometry.index
      ? node.geometry.toNonIndexed()
      : node.geometry.clone();
    g.applyMatrix4(node.matrixWorld);
    if (!batches.has(node.material)) batches.set(node.material, []);
    batches.get(node.material).push(g);
    retired.add(node.geometry);
    scene.remove(node);
  }
  for (const [material, geos] of batches) {
    const merged = new T.BufferGeometry();
    for (const name of ["position", "normal", "uv"]) {
      let length = 0;
      for (const g of geos) length += g.attributes[name].array.length;
      const array = new Float32Array(length);
      let offset = 0;
      for (const g of geos) {
        array.set(g.attributes[name].array, offset);
        offset += g.attributes[name].array.length;
      }
      merged.setAttribute(
        name,
        new T.BufferAttribute(array, name === "uv" ? 2 : 3),
      );
    }
    for (const g of geos) g.dispose();
    const mesh = new T.Mesh(merged, material);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const geometry of retired)
    if (geometry !== box && geometry !== sphere) geometry.dispose();
  // Articulated, rounded keeper, with face, shorts, socks, boots and padded gloves.
  const keeper = new T.Group();
  keeper.name = "pk6-keeper";
  scene.add(keeper);
  mesh(capsule, teal, 0, 0.05, 0, 0.65, 0.42, 0.43, keeper);
  bar(0, 0.21, 0.225, 0.5, 0.1, 0.025, orange, keeper);
  bar(0, -0.2, 0, 0.61, 0.26, 0.43, ink, keeper);
  const badge = mesh(
    new T.CircleGeometry(0.085, 16),
    white,
    0.16,
    0.09,
    0.235,
    1,
    1,
    1,
    keeper,
  );
  mesh(sphere, skin, 0, 0.75, 0, 0.31, 0.35, 0.29, keeper);
  mesh(sphere, hair, 0, 0.91, -0.045, 0.32, 0.22, 0.28, keeper);
  for (const x of [-0.12, 0.12]) {
    mesh(sphere, white, x, 0.77, 0.263, 0.071, 0.079, 0.025, keeper);
    mesh(sphere, ink, x, 0.77, 0.288, 0.031, 0.041, 0.012, keeper);
  }
  mesh(sphere, skin, 0, 0.66, 0.297, 0.075, 0.064, 0.065, keeper);
  const smile = mesh(
    new T.TorusGeometry(0.075, 0.013, 5, 12, Math.PI),
    ink,
    0,
    0.61,
    0.273,
    1,
    1,
    1,
    keeper,
  );
  smile.rotation.z = Math.PI;
  const arms = [],
    legs = [];
  for (const side of [-1, 1]) {
    const arm = new T.Group();
    arm.position.set(side * 0.38, 0.28, 0);
    keeper.add(arm);
    arms.push(arm);
    mesh(
      capsule,
      teal,
      side * 0.16,
      -0.12,
      0,
      0.24,
      0.25,
      0.25,
      arm,
    ).rotation.z = side * 0.7;
    mesh(
      capsule,
      skin,
      side * 0.34,
      -0.32,
      0.05,
      0.17,
      0.18,
      0.17,
      arm,
    ).rotation.z = side * 0.7;
    mesh(sphere, glove, side * 0.45, -0.44, 0.1, 0.22, 0.25, 0.16, arm);
    bar(side * 0.44, -0.35, 0.1, 0.27, 0.1, 0.29, orange, arm);
    const leg = new T.Group();
    leg.position.set(side * 0.19, -0.3, 0);
    keeper.add(leg);
    legs.push(leg);
    mesh(capsule, ink, 0, -0.2, 0, 0.21, 0.24, 0.23, leg);
    mesh(capsule, teal, side * 0.04, -0.56, 0, 0.16, 0.18, 0.17, leg);
    mesh(sphere, orange, side * 0.05, -0.78, 0.09, 0.17, 0.12, 0.29, leg);
  }
  const ball = mesh(sphere, white, 0, 0.24, 6.2, 0.24, 0.24, 0.24);
  ball.name = "pk6-ball";
  const ico = new T.IcosahedronGeometry(1, 0).attributes.position,
    seen = new Set(),
    normal = new T.Vector3(),
    up = new T.Vector3(0, 0, 1);
  for (let i = 0; i < ico.count; i++) {
    normal.fromBufferAttribute(ico, i).normalize();
    const k = normal
      .toArray()
      .map((n) => n.toFixed(2))
      .join();
    if (seen.has(k)) continue;
    seen.add(k);
    const patch = new T.Mesh(new T.CircleGeometry(0.31, 5), ink);
    patch.position.copy(normal).multiplyScalar(1.004);
    patch.quaternion.setFromUnitVectors(up, normal);
    ball.add(patch);
  }
  const trail = [];
  for (let i = 0; i < 8; i++) {
    const m = mesh(
      sphere,
      mat("#fff4b4", { transparent: true, opacity: 0.3, depthWrite: false }),
      0,
      0,
      0,
      0.1,
      0.1,
      0.1,
    );
    m.visible = false;
    trail.push(m);
  }
  const punch = mesh(new T.TorusGeometry(0.4, 0.055, 6, 32), lamps, 0, 0, 0);
  punch.visible = false;
  punch.name = "pk6-save-flash";
  const confetti = new T.InstancedMesh(
      new T.PlaneGeometry(0.09, 0.16),
      new T.MeshBasicMaterial({ side: T.DoubleSide }),
      72,
    ),
    c = new T.Color();
  for (let i = 0; i < 72; i++)
    confetti.setColorAt(
      i,
      c.set(["#ffbd58", "#ff8199", "#9ce7d6", "#ffffff"][i % 4]),
    );
  scene.add(confetti);
  confetti.visible = false;
  const project = new T.Vector3();
  let stamp = "",
    impact = false,
    shownKick = null,
    netActive = false;
  function frameCamera(w, h) {
    const halfW = Math.max(4.25, (3.0 * w) / h);
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = (halfW * h) / w;
    camera.bottom = -camera.top;
    camera.position.set(0, 4.5, 13);
    camera.lookAt(0, 1.35, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    project.set(-3.12, 3.12, 0).project(camera);
    const left = (project.x + 1) * 50,
      top = (1 - project.y) * 50;
    project.set(3.12, 0.08, 0).project(camera);
    targets.style.left = left + "%";
    targets.style.top = top + "%";
    targets.style.width = (project.x + 1) * 50 - left + "%";
    targets.style.height = (1 - project.y) * 50 - top + "%";
  }
  return {
    scene,
    camera,
    resize: frameCamera,
    dispose() {
      crowd.dispose();
      stripes.dispose();
      confetti.dispose();
    },
    frame() {
      const { S, api } = get();
      if (!S) return;
      const reduced = helper.reducedMotion(),
        last = S.phase === "reveal" ? S.last : null,
        age = last ? Math.max(0, (api.now() - last.shotAt) / 1000) : 0,
        flight = last
          ? reduced
            ? 1
            : Math.min(1, Math.max(0, (age - 0.34) / 0.82))
          : 0;
      const kick = last?.kick ?? null;
      if (kick !== shownKick) {
        shownKick = kick;
        stamp = last ? S.instanceId + ":" + last.kick : "";
        impact = false;
        banner.hidden = true;
        if (last) api.cue?.("place", { id: stamp + ":kick" });
      }
      cue.hidden = !!last && age > 0.34;
      const cueText = last
        ? "•••  Kick!"
        : S.myChoice
          ? "Choice locked"
          : "Pick your spot";
      if (cue.textContent !== cueText) cue.textContent = cueText;
      if (last && flight >= 0.96 && !impact) {
        impact = true;
        banner.textContent =
          last.outcome === "goal"
            ? "GOAL!"
            : last.outcome === "save"
              ? "SAVED!"
              : "OVER!";
        banner.dataset.outcome = last.outcome;
        banner.hidden = false;
        api.cue?.(last.outcome === "goal" ? "correct" : "capture", {
          id: stamp + ":impact",
        });
      }
      const sx = last ? ((last.zone % 3) - 1) * 2.1 : 0,
        sy = last
          ? last.outcome === "miss"
            ? 4.1
            : last.zone < 3
              ? 2.4
              : 0.65
          : 0.24;
      const dx = last ? ((last.dive % 3) - 1) * 2.1 : 0,
        dy = last && last.dive < 3 ? 2.2 : 0.8,
        dive = last
          ? reduced
            ? 1
            : Math.min(1, Math.max(0, (age - 0.48) / 0.62))
          : 0,
        e = 1 - Math.pow(1 - dive, 3),
        idle = reduced ? 0 : Math.sin(api.now() / 550) * 0.035;
      keeper.position.set(
        dx * 0.78 * e + idle,
        1.09 + (dy - 1.09) * e + Math.sin(dive * Math.PI) * 0.2,
        -0.02,
      );
      keeper.rotation.z = -dx * 0.47 * e;
      keeper.rotation.y = idle;
      arms[0].rotation.z = -0.35 - e * 1.3;
      arms[1].rotation.z = 0.35 + e * 1.3;
      legs[0].rotation.z = -0.12 - e * 0.3;
      legs[1].rotation.z = 0.12 + e * 0.3;
      let bz = 6.2 * (1 - flight),
        bx = sx * flight,
        by = 0.24 + (sy - 0.24) * flight + Math.sin(flight * Math.PI) * 1.05;
      if (last && flight === 1) {
        if (last.outcome === "goal") bz = -0.86;
        if (last.outcome === "save") {
          const rebound = reduced ? 0 : Math.min(1, Math.max(0, age - 1.16));
          bx += rebound * (sx < 0 ? -1 : 1) * 1.8;
          bz = rebound * 3;
          by += Math.sin(rebound * Math.PI) * 0.9;
        }
      }
      ball.position.set(bx, by, bz);
      ball.rotation.set(flight * 9, flight * 6, flight * 3);
      for (let i = 0; i < trail.length; i++) {
        const t = Math.max(0, flight - i * 0.028);
        trail[i].visible = !!last && !reduced && flight > 0 && flight < 1;
        trail[i].position.set(
          sx * t,
          0.24 + (sy - 0.24) * t + Math.sin(t * Math.PI) * 1.05,
          6.2 * (1 - t),
        );
        trail[i].scale.setScalar(0.08 * (1 - i / 10));
      }
      const hit = last && last.outcome === "goal" ? age - 1.12 : -1,
        ripple =
          hit >= 0 && !reduced
            ? Math.sin((Math.min(1, hit / 0.22) * Math.PI) / 2) *
              Math.exp(-hit * 2.8)
            : 0;
      if (ripple > 0.001 || netActive) {
        for (let i = 0; i < netPos.count; i++) {
          const x = original[i * 3],
            y = original[i * 3 + 1],
            z = original[i * 3 + 2];
          netPos.array[i * 3 + 2] =
            z -
            ripple *
              0.8 *
              Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) * 0.7) *
              Math.cos((x - sx) * 3 + hit * 14);
        }
        netPos.needsUpdate = true;
        netActive = ripple > 0.001;
      }
      punch.visible =
        !!last &&
        last.outcome === "save" &&
        !reduced &&
        age > 1.08 &&
        age < 1.58;
      punch.position.set(sx, sy, 0.2);
      punch.scale.setScalar(1 + Math.max(0, age - 1.08) * 3);
      punch.material.emissiveIntensity = 1.8;
      confetti.visible = hit >= 0 && hit < 1.8 && !reduced;
      if (confetti.visible) {
        for (let i = 0; i < 72; i++) {
          const angle = i * 2.399;
          dummy.position.set(
            Math.sin(angle) * (1 + hit * 2.7),
            3.8 + (i % 7) * 0.13 + hit * 1.2 - hit * hit * 2.2,
            1 + Math.cos(angle) * hit * 2,
          );
          dummy.rotation.set(hit * 5 + i, hit * 4, angle);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          confetti.setMatrixAt(i, dummy.matrix);
        }
        confetti.instanceMatrix.needsUpdate = true;
      }
      camera.position.x =
        !reduced && last && age > 1.12 && age < 1.4
          ? Math.sin(age * 95) * 0.018
          : 0;
    },
  };
}
export default batchView({
  id: "penalty-kicks",
  prefix: "pk6",
  name: "Penalty Kicks",
  family: "arcade",
  field: `<div class="b6-stage pk6-pitch"><div class="b6-world-view"><canvas class="b6-flat" aria-label="Goal in 2D"></canvas><div class="b6-gl"></div></div><div class="pk6-zones" role="group" aria-label="Goal zones"></div><div class="pk6-banner" aria-hidden="true" hidden></div><div class="pk6-runup" aria-hidden="true">Pick your spot</div><div class="b6-tools b6-recovery" hidden><span class="b6-view-note" hidden></span><button type="button" class="tb-btn tb-chip" data-retry data-watchok hidden>Retry 3D</button></div></div>
    <div class="pk6-controls"><div class="tb-seg pk6-power" role="group" aria-label="Shot power"></div><div class="pk6-match-tools"></div></div>`,
  mount({ el, api }) {
    el.querySelector(".b6-field").append(el.querySelector(".b6-actions"));
    el.querySelector(".b6-world-view").append(el.querySelector(".pk6-zones"));
    return sceneView(el.querySelector(".b6-world-view"), api, build, paint);
  },
  patch({ el, S, local, send, refresh }) {
    const locked = !!S.myChoice || S.phase !== "pick" || watch(S);
    html(
      el.querySelector(".pk6-zones"),
      zones
        .map(
          (label, i) =>
            `<button type="button" class="pk6-target" data-zone="${i}" aria-label="${label}" aria-pressed="${(S.myChoice?.zone ?? local.zone) === i}" ${locked ? "disabled" : ""}><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="5"/><path d="M24 3v9m0 24v9M3 24h9m24 0h9"/></svg></button>`,
        )
        .join(""),
    );
    html(
      el.querySelector(".pk6-power"),
      ["soft", "hard"]
        .map((p) =>
          chip(
            `<span class="pk6-meter" data-power-level="${p}" aria-hidden="true"><i></i><i></i><i></i></span>${p === "soft" ? "Soft" : "Hard"}`,
            `data-power="${p}" aria-pressed="${(S.myChoice?.power || local.power) === p}" ${locked || S.role !== "shooter" ? "disabled" : ""}`,
          ),
        )
        .join(""),
    );
    for (const b of el.querySelectorAll("[data-zone]"))
      b.onclick = () => {
        local.zone = Number(b.dataset.zone);
        refresh();
      };
    for (const b of el.querySelectorAll("[data-power]"))
      b.onclick = () => {
        local.power = b.dataset.power;
        refresh();
      };
    const opponentOffer = S.drawOffer && S.drawOffer !== S.me;
    html(
      el.querySelector(".pk6-match-tools"),
      `${chip("Resign", `data-resign ${watch(S) ? "disabled" : ""}`)}${opponentOffer ? chip("Accept draw", "data-accept") + chip("Decline", "data-decline") : chip(S.drawOffer ? "Draw offered" : "Offer draw", `data-offer ${S.drawOffer || S.drawBlocked === S.me || watch(S) ? "disabled" : ""}`)}`,
    );
    el.querySelector("[data-resign]").onclick = () => {
      local.resigning = !local.resigning;
      if (local.resigning) {
        const b = el.querySelector("[data-resign]");
        b.textContent = "Resign?";
        b.onclick = () => send({ resign: true });
      } else refresh();
    };
    for (const [attr, action] of [
      ["offer", "offerDraw"],
      ["accept", "acceptDraw"],
      ["decline", "declineDraw"],
    ]) {
      const b = el.querySelector(`[data-${attr}]`);
      if (b) b.onclick = () => send({ [action]: true });
    }
    const outcome = S.last?.outcome;
    return {
      title:
        S.phase === "reveal"
          ? outcome === "goal"
            ? "Goal!"
            : outcome === "save"
              ? "Saved by the keeper!"
              : "Over the bar!"
          : S.role === "shooter"
            ? "You shoot. Pick your corner."
            : S.role === "keeper"
              ? "You keep. Read the shooter."
              : `${nameOf(S, S.shooter)} steps up`,
      round:
        S.kick > 10
          ? `Sudden death ${Math.ceil((S.kick - 10) / 2)}`
          : `Kick ${S.kick} / 10`,
      phase: S.phase === "pick" ? `Pick ${S.locked.length}/2` : "Kick",
      progress: (S.players || [])
        .map((p) => Number(S.goals[p.id]) || 0)
        .join(" : "),
      ready: !locked && local.zone !== null,
      button: S.role === "shooter" ? "Lock shot" : "Lock dive",
      status:
        S.phase === "reveal"
          ? `${nameOf(S, S.shooter)}: ${outcome === "goal" ? "goal" : outcome === "save" ? "saved" : "missed"}. ${zones[S.last.zone]}.`
          : S.myChoice
            ? "Choice locked. Waiting for the other player."
            : S.role === "keeper"
              ? "Tap a target to dive there. The shooter picks power."
              : local.power === "hard" && local.zone !== null && local.zone < 3
                ? "Hard and high: 20% chance over the bar. Pick a zone, then lock."
                : "Tap a target on the goal, choose power, then lock.",
      roles: { [S.shooter]: "Shooter", [S.keeper]: "Keeper" },
      waiting: false,
    };
  },
  submit({ S, local, send }) {
    send({
      kick: S.kick,
      zone: local.zone,
      ...(S.role === "shooter" ? { power: local.power } : {}),
    });
  },
});
