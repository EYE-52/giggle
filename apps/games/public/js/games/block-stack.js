import { nameOf } from "../util.js";
import { batchView, watch } from "./b6-kit.js";
import { sceneView, canvasSize } from "./b6-three.js";

const palette = [
  "#fb7185",
  "#38bdf8",
  "#a78bfa",
  "#2dd4bf",
  "#fbbf24",
  "#fb923c",
  "#818cf8",
  "#e879f9",
  "#67e8f9",
  "#a3e635",
  "#fda4af",
  "#c4b5fd",
];
const blocksLabel = (n) => `${n} ${n === 1 ? "block" : "blocks"}`;
const slide = (t, now) =>
  4.5 *
  Math.sin(
    Math.max(0, (now - t.startedAt) / 1000) * t.speed -
      (t.height === 0 ? 0 : Math.PI / 2),
  );
function paint(canvas, S, api) {
  const { ctx, w, h } = canvasSize(canvas),
    ids = Object.keys(S.towers || {});
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#6a97bd");
  sky.addColorStop(1, "#d4e8d6");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const cell = w / Math.max(1, ids.length),
    max = Math.max(8, ...Object.values(S.towers).map((t) => t.height + 3));
  const unit = Math.min(cell / 12, (h - 48) / max / 0.55),
    levelH = Math.min(14, (h - 48) / max);
  for (const [i, pid] of ids.entries()) {
    const t = S.towers[pid],
      cx = cell * (i + 0.5),
      bottom = h - 32;
    ctx.fillStyle = pid === S.myTower ? "#ffffff" : "#52607a";
    ctx.fillRect(cx - 4.5 * unit, bottom + 2, 9 * unit, 5);
    const slab = (b, level, color) => {
      const corners = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ].map(([x, z]) => {
        const bx = b.x + x * b.width,
          bz = b.z + z * b.depth;
        return [
          cx + (bx - bz) * unit * 0.65,
          bottom - level * levelH + (bx + bz) * unit * 0.3,
        ];
      });
      ctx.fillStyle = color;
      ctx.strokeStyle = "#17243a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach(([x, y], j) => ctx[j ? "lineTo" : "moveTo"](x, y));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    for (const [j, b] of t.blocks.entries()) {
      slab(b, j + 1, palette[i % palette.length]);
    }
    if (["countdown", "stack"].includes(S.phase) && !t.out) {
      const moving = slide(t, api.now());
      slab(
        {
          ...t,
          x: t.x + (t.axis === "x" ? moving : 0),
          z: t.z + (t.axis === "z" ? moving : 0),
        },
        t.height + 2,
        "#ffffff",
      );
      if (pid === S.myTower) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(cx + t.x * unit, 16);
        ctx.lineTo(cx + t.x * unit, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.fillStyle = "#203750";
    ctx.textAlign = "center";
    ctx.font = "700 13px sans-serif";
    ctx.fillText(`${t.height}${t.out ? " ×" : ""}`, cx, 18);
    ctx.fillText(
      pid === S.myTower
        ? "YOU"
        : nameOf(S, pid).slice(0, Math.max(2, Math.floor(cell / 8))),
      cx,
      h - 8,
    );
  }
}
// Rounded toy slabs, pooled cut-offs and an instanced skyline.
function build(T, helper, get) {
  const scene = new T.Scene(),
    night = document.documentElement.dataset.theme === "night";
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 2;
  skyCanvas.height = 256;
  const ctx = skyCanvas.getContext("2d"),
    gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, night ? "#283f70" : "#88c9e7");
  gradient.addColorStop(0.6, night ? "#8b8db9" : "#d5ebec");
  gradient.addColorStop(1, night ? "#d5a9ba" : "#ffe6bb");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const skyTexture = new T.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = T.SRGBColorSpace;
  scene.background = skyTexture;
  scene.fog = new T.Fog(night ? "#a69abb" : "#dae9e1", 38, 95);
  const camera = new T.OrthographicCamera(-8, 8, 7, -7, 0.1, 180);
  scene.add(
    new T.HemisphereLight(night ? "#d2ddff" : "#ffffff", "#8d91ac", 1.8),
  );
  const sun = new T.DirectionalLight("#fff1d2", 2.2);
  sun.position.set(-12, 24, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -24,
    right: 24,
    top: 40,
    bottom: -24,
    far: 100,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const renderer = helper.renderer();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const material = (color, extra = {}) =>
    new T.MeshStandardMaterial({ color, roughness: 0.48, ...extra });
  // A subdivided cube projected onto a rounded box gives true soft bevels.
  const rounded = new T.BoxGeometry(1, 1, 1, 4, 4, 4),
    position = rounded.attributes.position,
    v = new T.Vector3(),
    core = new T.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    core.copy(v).clampScalar(-0.42, 0.42);
    v.sub(core).normalize().multiplyScalar(0.08).add(core);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  rounded.computeVertexNormals();
  const blockMat = material("#ffffff"),
    platformMat = material("#fff9ed"),
    rimMat = material("#e9bb75"),
    shadowMat = new T.MeshBasicMaterial({
      color: "#334968",
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: T.DoubleSide,
    });
  const ground = new T.Mesh(
    new T.CircleGeometry(8, 64),
    material(night ? "#6b799b" : "#b6cfd2"),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.25;
  ground.receiveShadow = true;
  scene.add(ground);
  // Islands in the mist give the plinth a place in the world.
  const scenery = new T.InstancedMesh(
      new T.CylinderGeometry(1.3, 1.6, 1, 12),
      material(night ? "#8192ad" : "#b4d4ce"),
      14,
    ),
    dummy = new T.Object3D(),
    color = new T.Color();
  for (let i = 0; i < 14; i++) {
    dummy.position.set(((i % 7) - 3) * 7, -3.5, -12 - Math.floor(i / 7) * 14);
    dummy.scale.set(1, 1 + (i % 3) * 0.3, 1);
    dummy.rotation.y = i;
    dummy.updateMatrix();
    scenery.setMatrixAt(i, dummy.matrix);
  }
  scenery.receiveShadow = true;
  scene.add(scenery);
  const clouds = [],
    puffGeo = new T.SphereGeometry(1, 12, 8),
    cloudMat = material(night ? "#c5cee9" : "#fffaf1", {
      transparent: true,
      opacity: night ? 0.45 : 0.85,
    });
  for (let j = 0; j < 6; j++) {
    const cloud = new T.Group();
    for (let i = 0; i < 4; i++) {
      const puff = new T.Mesh(puffGeo, cloudMat);
      puff.position.set(i * 1.1, i === 1 ? 0.4 : 0, 0);
      puff.scale.set(1.25, 0.65, 0.8);
      cloud.add(puff);
    }
    cloud.position.set(
      ((j % 3) - 1) * 11,
      3 + Math.floor(j / 3) * 6,
      -15 - (j % 2) * 7,
    );
    scene.add(cloud);
    clouds.push(cloud);
  }
  const moon = new T.Mesh(
    new T.SphereGeometry(1.2, 24, 16),
    new T.MeshBasicMaterial({ color: night ? "#fff1ce" : "#fff3bf" }),
  );
  moon.position.set(-10, 10, -25);
  scene.add(moon);
  const records = new Map(),
    moving = [],
    debris = [];
  const ringGeo = new T.TorusGeometry(2.8, 0.045, 6, 64),
    debrisMaterial = material("#ffffff");
  for (let i = 0; i < 24; i++) {
    const mesh = new T.Mesh(rounded, debrisMaterial.clone());
    mesh.visible = false;
    mesh.castShadow = true;
    scene.add(mesh);
    debris.push({
      mesh,
      start: -100,
      x: 0,
      y: 0,
      z: 0,
      dir: 1,
      axis: "x",
      scale: 1,
    });
  }
  let debrisIndex = 0,
    snapshot = null,
    round = null,
    aspect = 1,
    lift = 0,
    viewSize = 6.4;
  const look = new T.Vector3();
  function make(pid, own, index, total) {
    const group = new T.Group(),
      scale = own ? 1 : 0.32,
      peer = own ? 0 : index - (get().S.myTower ? 1 : 0);
    group.position.set(
      own ? 0 : (peer - (total - 2) / 2) * 5.1,
      0,
      own ? 2.4 : -6,
    );
    group.scale.setScalar(scale);
    scene.add(group);
    function part(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }
    const platform = part(
      new T.CylinderGeometry(3.25, 3.55, 0.65, 64),
      platformMat,
      0,
      -0.45,
      0,
    );
    platform.name = own ? "bs-own-platform" : "bs-rival-platform";
    part(new T.CylinderGeometry(3.5, 3.3, 0.24, 64), rimMat, 0, -0.83, 0);
    const rim = part(
      new T.TorusGeometry(3.18, 0.055, 8, 64),
      rimMat,
      0,
      -0.1,
      0,
    );
    rim.rotation.x = Math.PI / 2;
    part(
      rounded,
      material(own ? "#fcf5e6" : "#9bb2cb"),
      0,
      0.08,
      0,
      4.4,
      0.3,
      4.4,
    );
    const settled = new T.InstancedMesh(rounded, blockMat, 384);
    settled.count = 0;
    settled.castShadow = settled.receiveShadow = true;
    group.add(settled);
    const top = part(rounded, material("#ffffff"), 0, 0.7, 0);
    top.name = own ? "bs-own-top" : "bs-rival-top";
    const slider = part(
      rounded,
      material("#ffffff", { emissive: "#fff2ba", emissiveIntensity: 0.12 }),
      0,
      1.8,
      0,
    );
    slider.name = own ? "bs-own-slider" : "bs-rival-slider";
    // Thin top inset catches light without a dark wireframe cage.
    const inset = new T.Mesh(
      rounded,
      material("#ffffff", { transparent: true, opacity: 0.26 }),
    );
    inset.position.y = 0.46;
    inset.scale.set(0.93, 0.06, 0.93);
    slider.add(inset);
    const ghost = part(new T.PlaneGeometry(1, 1), shadowMat, 0, 0.3, 0);
    ghost.rotation.x = -Math.PI / 2;
    const guideGeo = new T.BufferGeometry().setAttribute(
      "position",
      new T.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    );
    const guide = new T.Line(
      guideGeo,
      new T.LineBasicMaterial({
        color: "#fff8dc",
        transparent: true,
        opacity: 0.75,
      }),
    );
    guide.name = own ? "bs-drop-guide" : "bs-rival-guide";
    group.add(guide);
    const rail = new T.Line(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
      ),
      new T.LineBasicMaterial({
        color: "#fff9e6",
        transparent: true,
        opacity: 0.2,
      }),
    );
    group.add(rail);
    const ring = part(
      ringGeo,
      new T.MeshBasicMaterial({
        color: "#fff3b8",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      0,
      0,
      0,
    );
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    ring.name = own ? "bs-perfect-ring" : "bs-rival-ring";
    const r = {
      pid,
      own,
      index,
      group,
      scale,
      settled,
      top,
      slider,
      ghost,
      guide,
      rail,
      ring,
      height: -1,
      out: false,
      round: null,
      prev: null,
      landingAt: -100,
    };
    records.set(pid, r);
    moving.push(r);
    return r;
  }
  function blockColor(level, index) {
    return color.setHSL(
      ((level * 9 + index * 34 + 330) % 360) / 360,
      0.67,
      night ? 0.61 : 0.57,
    );
  }
  function cut(r, t, previous, now) {
    if (!previous || helper.reducedMotion()) return;
    const axis = previous.axis,
      size = axis === "x" ? "width" : "depth",
      miss = t.out && !previous.out;
    const amount = miss ? previous[size] : previous[size] - t[size];
    if (amount < 0.001) return;
    const delta = miss ? t.miss?.offset || 0 : (t[axis] - previous[axis]) * 2,
      dir = delta < 0 ? -1 : 1,
      d = debris[debrisIndex++ % debris.length];
    d.axis = axis;
    d.dir = dir;
    d.start = now;
    d.scale = r.scale;
    const x =
      axis === "x"
        ? miss
          ? previous.x + delta
          : previous.x + dir * (previous.width / 2 + amount / 2)
        : previous.x;
    const z =
      axis === "z"
        ? miss
          ? previous.z + delta
          : previous.z + dir * (previous.depth / 2 + amount / 2)
        : previous.z;
    d.x = r.group.position.x + x * r.scale;
    d.y = (0.7 + (miss ? t.height : t.height - 1) * 0.8) * r.scale;
    d.z = r.group.position.z + z * r.scale;
    d.mesh.scale.set(
      (axis === "x" ? amount : previous.width) * r.scale,
      0.75 * r.scale,
      (axis === "z" ? amount : previous.depth) * r.scale,
    );
    d.mesh.material.color.copy(
      blockColor(miss ? t.height : t.height - 1, r.index),
    );
    d.mesh.rotation.set(0, 0, 0);
    d.mesh.visible = true;
  }
  function sync(S, now) {
    const ids = Object.keys(S.towers),
      ordered = [S.myTower, ...ids.filter((pid) => pid !== S.myTower)].filter(
        Boolean,
      );
    ordered.forEach((pid, index) => {
      const t = S.towers[pid],
        r =
          records.get(pid) ||
          make(pid, pid === S.myTower, index, ordered.length);
      if (r.round !== S.round || r.height !== t.height || r.out !== t.out) {
        const fresh = r.round === S.round && r.height >= 0,
          landed = fresh && t.height > r.height;
        if (fresh && (landed || t.out !== r.out)) cut(r, t, r.prev, now);
        if (landed) {
          r.landingAt = now;
          if (r.own)
            get().api.cue?.(t.perfect ? "correct" : "place", {
              id: S.instanceId + ":" + S.round + ":" + t.height + ":land",
            });
        }
        r.round = S.round;
        r.height = t.height;
        r.out = t.out;
        r.settled.count = Math.max(0, t.blocks.length - 1);
        for (let j = 0; j < t.blocks.length - 1; j++) {
          const b = t.blocks[j];
          dummy.position.set(b.x, 0.7 + j * 0.8, b.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(b.width, 0.75, b.depth);
          dummy.updateMatrix();
          r.settled.setMatrixAt(j, dummy.matrix);
          r.settled.setColorAt(j, blockColor(j, r.index));
        }
        r.settled.instanceMatrix.needsUpdate = true;
        if (r.settled.instanceColor) r.settled.instanceColor.needsUpdate = true;
        r.top.material.color.copy(
          blockColor(Math.max(0, t.height - 1), r.index),
        );
        r.slider.material.color.copy(blockColor(t.height, r.index));
        r.top.visible = t.height > 0;
      }
      r.prev = t;
    });
    if (round !== S.round) {
      round = S.round;
      for (const d of debris) d.mesh.visible = false;
    }
  }
  return {
    scene,
    camera,
    resize(w, h) {
      aspect = w / h;
    },
    frame(dt = 0.016) {
      const { S, api } = get();
      if (!S) return;
      const now = performance.now() / 1000,
        reduced = helper.reducedMotion();
      if (snapshot !== S) {
        snapshot = S;
        sync(S, now);
      }
      let highest = 0;
      for (const r of moving) {
        const t = S.towers[r.pid];
        if (!t) continue;
        const d = slide(t, api.now()),
          x = t.x + (t.axis === "x" ? d : 0),
          z = t.z + (t.axis === "z" ? d : 0),
          floor = 0.32 + t.height * 0.8,
          hover = floor + 1.65;
        const visible =
          (S.phase === "countdown" || S.phase === "stack") && !t.out;
        r.slider.visible =
          r.ghost.visible =
          r.guide.visible =
          r.rail.visible =
            visible;
        r.slider.position.set(x, hover, z);
        r.slider.scale.set(t.width, 0.75, t.depth);
        r.ghost.position.set(x, floor + 0.025, z);
        r.ghost.scale.set(t.width, t.depth, 1);
        const points = r.guide.geometry.attributes.position;
        points.setXYZ(0, x, floor + 0.04, z);
        points.setXYZ(1, x, hover - 0.4, z);
        points.needsUpdate = true;
        const rail = r.rail.geometry.attributes.position;
        rail.setXYZ(
          0,
          t.x - (t.axis === "x" ? 6 : 0),
          hover,
          t.z - (t.axis === "z" ? 6 : 0),
        );
        rail.setXYZ(
          1,
          t.x + (t.axis === "x" ? 6 : 0),
          hover,
          t.z + (t.axis === "z" ? 6 : 0),
        );
        rail.needsUpdate = true;
        const age = now - r.landingAt,
          p = reduced ? 1 : Math.min(1, age / 0.42),
          fall = Math.pow(1 - p, 3),
          bounce = Math.sin(p * Math.PI * 2) * Math.pow(1 - p, 2);
        if (r.top.visible) {
          const b = t.blocks[t.blocks.length - 1];
          r.top.position.set(
            b.x,
            0.7 + (t.height - 1) * 0.8 + fall * 1.15,
            b.z,
          );
          r.top.scale.set(
            b.width * (1 + bounce * 0.06),
            0.75 * (1 - bounce * 0.16),
            b.depth * (1 + bounce * 0.06),
          );
        }
        r.ring.visible = !reduced && t.perfect && age < 0.75 && age >= 0;
        r.ring.position.set(t.x, 0.5 + t.height * 0.8, t.z);
        r.ring.scale.setScalar(0.35 + Math.min(0.75, age) * 1.4);
        r.ring.material.opacity = Math.max(0, 1 - age / 0.75);
        r.group.rotation.z =
          !reduced && t.height > 7
            ? Math.sin(now * 1.7) * Math.min(0.012, t.height * 0.0005)
            : 0;
        highest = Math.max(highest, t.height * 0.8 * r.scale);
      }
      for (const d of debris) {
        if (!d.mesh.visible) continue;
        const age = now - d.start;
        if (reduced || age > 1.8) {
          d.mesh.visible = false;
          continue;
        }
        d.mesh.position.set(
          d.x + (d.axis === "x" ? d.dir * age * 2.8 * d.scale : 0),
          d.y + age * 0.6 - age * age * 7,
          d.z + (d.axis === "z" ? d.dir * age * 2.8 * d.scale : 0),
        );
        d.mesh.rotation.set(age * 1.8, age * 0.6, age * d.dir * 2);
      }
      for (let i = 0; i < clouds.length; i++)
        if (!reduced)
          clouds[i].position.x =
            ((i % 3) - 1) * 11 + Math.sin(now * 0.06 + i) * 1.6;
      const target = Math.max(0, highest * 0.46),
        blend = reduced ? 1 : 1 - Math.exp(-Math.max(0.001, dt) * 4);
      lift += (target - lift) * blend;
      const targetSize = Math.max(5.6, highest * 0.48 + 3.1);
      viewSize += (targetSize - viewSize) * blend;
      const halfW = Math.max(6.8, viewSize * aspect);
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfW / aspect;
      camera.bottom = -halfW / aspect;
      camera.position.set(8, lift + 11, 23);
      camera.lookAt(look.set(0, lift + 1.1, 0));
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const r of moving) r.settled.dispose();
      scenery.dispose();
      skyTexture.dispose();
      debrisMaterial.dispose();
      records.clear();
    },
  };
}
export default batchView({
  id: "block-stack",
  prefix: "bs",
  name: "Block Stack",
  family: "arcade",
  field: `<div class="b6-stage bs-sky" tabindex="0" data-game-focus role="region" aria-label="Your tower. Press Space or Enter to drop."><div class="b6-world-view"><canvas class="b6-flat" aria-label="All towers in 2D"></canvas><div class="b6-gl"></div></div><span class="bs-height"></span><span class="bs-perfect" hidden>Perfect!</span><div class="bs-countdown" role="status" aria-live="polite" hidden><span>Get ready</span><strong class="bs-countdown-value">3</strong></div><div class="b6-tools b6-recovery" hidden><span class="b6-view-note" hidden></span><button type="button" class="tb-btn tb-chip" data-retry data-watchok hidden>Retry 3D</button></div></div>`,
  mount({ el, api, send }) {
    const scene = sceneView(
      el.querySelector(".b6-world-view"),
      api,
      build,
      paint,
    );
    let current = null,
      clock = api,
      focusPending = true,
      focusFrame = 0,
      countdownFrame = 0,
      burstTimer = 0,
      burstKey = "";
    const field = el.querySelector(".bs-sky"),
      burst = el.querySelector(".bs-perfect"),
      countdown = el.querySelector(".bs-countdown"),
      countdownValue = el.querySelector(".bs-countdown-value");
    const tickCountdown = () => {
      const seconds = Math.ceil((current.startsAt - clock.now()) / 1000);
      const label = seconds > 0 ? String(Math.min(3, seconds)) : "…";
      if (countdownValue.textContent !== label)
        countdownValue.textContent = label;
      countdownFrame = requestAnimationFrame(tickCountdown);
    };
    const editing = (target) =>
      target?.closest?.(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
      );
    const keydown = (e) => {
      if (
        !["Space", "Enter", "NumpadEnter"].includes(e.code) ||
        e.repeat ||
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        editing(e.target) ||
        e.target.closest?.("button,a,summary") ||
        document.querySelector("dialog[open],#roomMenu[open]") ||
        [
          ...document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
        ].some(
          (node) =>
            !node.closest("details:not([open]),[hidden],[inert]") &&
            node.getClientRects().length > 0 &&
            getComputedStyle(node).visibility !== "hidden",
        ) ||
        !current
      )
        return;
      const t = current.towers?.[current.me];
      if (["countdown", "stack"].includes(current.phase) && t && !t.out) {
        e.preventDefault();
        if (current.phase === "stack")
          send({ drop: true, level: t.height, round: current.round });
      }
    };
    window.addEventListener("keydown", keydown);
    return {
      update(S, a) {
        current = S;
        clock = a;
        scene.update(S, a);
        cancelAnimationFrame(countdownFrame);
        countdown.hidden = S.phase !== "countdown";
        if (!countdown.hidden) tickCountdown();
        if (
          focusPending &&
          !S.preparing &&
          ["countdown", "stack"].includes(S.phase)
        ) {
          focusPending = false;
          const until = performance.now() + 2000;
          const focusWhenReady = () => {
            const frame = window.frameElement;
            let parentEditing = false;
            if (window.parent !== window) {
              try {
                parentEditing = editing(window.parent.document.activeElement);
              } catch {
                parentEditing = !document.hasFocus();
              }
            }
            if (
              parentEditing ||
              editing(document.activeElement) ||
              document.visibilityState === "hidden" ||
              (frame &&
                (!frame.getClientRects().length ||
                  frame.closest("[hidden],[inert]")))
            )
              return;
            // The room removes its preparation barrier after the view paints.
            if (
              field.closest("[hidden],[inert]") ||
              !field.getClientRects().length
            ) {
              if (performance.now() < until)
                focusFrame = requestAnimationFrame(focusWhenReady);
              return;
            }
            field.focus({ preventScroll: true });
          };
          focusFrame = requestAnimationFrame(focusWhenReady);
        }
        const t = S.towers?.[S.me],
          next = `${S.instanceId}:${S.round}:${t?.height}`;
        if (next !== burstKey) {
          const was = burstKey;
          burstKey = next;
          clearTimeout(burstTimer);
          burst.hidden = true;
          if (was && t?.perfect && !t.out && t.height > 0) {
            clearTimeout(burstTimer);
            burst.hidden = false;
            burst.classList.remove("is-burst");
            void burst.offsetWidth;
            burst.classList.add("is-burst");
            burstTimer = setTimeout(() => {
              burst.hidden = true;
            }, 750);
          }
        }
      },
      dispose() {
        scene.dispose();
        cancelAnimationFrame(focusFrame);
        cancelAnimationFrame(countdownFrame);
        clearTimeout(burstTimer);
        current = null;
        window.removeEventListener("keydown", keydown);
      },
    };
  },
  patch({ el, S }) {
    const t = S.towers?.[S.me],
      best = Math.max(0, ...Object.values(S.towers || {}).map((t) => t.height));
    el.querySelector(".bs-height").textContent = t
      ? `${blocksLabel(t.height)} · ${t.out ? "Run finished" : t.axis === "x" ? "Side to side" : "Near and far"}`
      : `Tallest: ${blocksLabel(best)}`;
    return {
      title:
        S.phase === "countdown"
          ? "Get ready to stack."
          : S.phase === "reveal"
            ? S.last.winners.length > 1
              ? "Tied at the top!"
              : "The skyline is set"
            : t?.out
              ? "Your tower is in"
              : "Line it up. Drop it.",
      phase:
        S.phase === "countdown"
          ? "Ready"
          : S.phase === "stack"
            ? "Stack"
            : "Reveal",
      progress: `${best} high`,
      button: S.phase === "countdown" ? "Get ready…" : "Drop block",
      ready: S.phase === "stack" && !!t && !t.out && !watch(S),
      status:
        S.phase === "countdown"
          ? "Wait for 3–2–1. The first block starts over your base."
          : S.phase === "reveal"
            ? `Best height: ${blocksLabel(S.last.best)}. Your score: +${S.last.pts?.[S.me] || 0}.`
            : t?.out
              ? "Your run ended. Other towers keep building until time runs out."
              : t?.perfect
                ? "Perfect! Full width kept. Drop the next block."
                : "Your tower has the white base. Space or Enter drops the block.",
      roles: Object.fromEntries(
        Object.entries(S.towers || {}).map(([pid, t]) => [
          pid,
          `${blocksLabel(t.height)}${t.out ? " · out" : ""}`,
        ]),
      ),
      waiting: false,
    };
  },
  submit({ S, send }) {
    send({ drop: true, level: S.towers[S.me].height, round: S.round });
  },
});
