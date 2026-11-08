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
function build(T, helper, get) {
  const scene = new T.Scene();
  const night = document.documentElement.dataset.theme === "night";
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 2;
  skyCanvas.height = 256;
  const sky = skyCanvas.getContext("2d"),
    gradient = sky.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, night ? "#405d8c" : "#bde7ff");
  gradient.addColorStop(0.65, night ? "#a9a6cf" : "#e8f6ff");
  gradient.addColorStop(1, night ? "#e6b4ac" : "#fff0d1");
  sky.fillStyle = gradient;
  sky.fillRect(0, 0, 2, 256);
  const skyTexture = new T.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = T.SRGBColorSpace;
  scene.background = skyTexture;
  scene.fog = new T.Fog(night ? "#aaa8c9" : "#edf6ee", 45, 110);
  const camera = new T.OrthographicCamera(-10, 10, 8, -8, 0.1, 180);
  scene.add(
    new T.HemisphereLight(night ? "#d6e6ff" : "#ffffff", "#8ba399", 2.3),
  );
  const sun = new T.DirectionalLight("#fff0d9", 2.1);
  sun.position.set(-12, 24, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -26,
    right: 26,
    top: 35,
    bottom: -26,
    far: 100,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.001;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const renderer = helper.renderer();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const ground = new T.Mesh(
    new T.PlaneGeometry(80, 34),
    new T.MeshStandardMaterial({
      color: night ? "#758c9c" : "#b7d7c6",
      roughness: 1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.8, 8);
  ground.receiveShadow = true;
  scene.add(ground);
  for (const [x, y, z] of [
    [-7, 0, -18],
    [3, 1, -20],
  ]) {
    const cloud = new T.Group();
    const material = new T.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: night ? 0.34 : 0.7,
    });
    for (let i = 0; i < 3; i++) {
      const puff = new T.Mesh(new T.SphereGeometry(1.5, 12, 8), material);
      puff.position.set(i * 1.7, i === 1 ? 0.5 : 0, 0);
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    scene.add(cloud);
  }
  let towers = new T.Group();
  scene.add(towers);
  let key = "",
    moving = [],
    aspect = 1,
    lift = 0;
  const prior = new Map();
  const vec = new T.Vector3();
  function rebuild(S) {
    towers.traverse((node) => {
      if (node.isInstancedMesh) node.dispose();
    });
    helper.disposeObject(towers);
    scene.remove(towers);
    towers = new T.Group();
    scene.add(towers);
    moving = [];
    const ids = Object.keys(S.towers),
      ordered = [S.myTower, ...ids.filter((pid) => pid !== S.myTower)].filter(
        Boolean,
      ),
      box = new T.BoxGeometry(1, 1, 1);
    ordered.forEach((pid, i) => {
      const t = S.towers[pid],
        own = pid === S.myTower,
        peer = Math.max(0, i - (S.myTower ? 1 : 0)),
        row = Math.floor(peer / 4),
        count = Math.min(4, ordered.length - (S.myTower ? 1 : 0) - row * 4),
        group = new T.Group(),
        scale = own ? 1 : 0.36;
      group.position.set(
        own ? 0 : ((peer % 4) - (count - 1) / 2) * 4.4,
        0,
        own ? 3 : -5 - row * 5,
      );
      group.scale.setScalar(scale);
      towers.add(group);
      const color = palette[ids.indexOf(pid) % palette.length];
      const platform = new T.Mesh(
        new T.CylinderGeometry(3.1, 3.3, 0.6, 40),
        new T.MeshStandardMaterial({
          color: own ? "#fffdf2" : "#c5d9dc",
          roughness: 0.8,
        }),
      );
      platform.position.y = -0.35;
      platform.castShadow = platform.receiveShadow = true;
      platform.name = own ? "bs-own-platform" : "bs-rival-platform";
      group.add(platform);
      const rim = new T.Mesh(
        new T.TorusGeometry(3.05, own ? 0.1 : 0.06, 6, 48),
        new T.MeshStandardMaterial({ color: own ? "#ffbc64" : color }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.03;
      group.add(rim);
      const base = new T.Mesh(
        box,
        new T.MeshStandardMaterial({
          color: own ? "#ffffff" : "#97b3ba",
          roughness: 0.75,
        }),
      );
      base.scale.set(4.4, 0.3, 4.4);
      base.position.y = 0.15;
      base.castShadow = base.receiveShadow = true;
      group.add(base);
      const previous = prior.get(pid),
        stamp = `${S.round}:${t.height}`,
        landed =
          previous && previous.stamp !== stamp && t.height > previous.height,
        landingAt = landed
          ? performance.now() / 1000
          : previous?.landingAt || -100;
      prior.set(pid, { stamp, height: t.height, landingAt });
      const material = new T.MeshStandardMaterial({ color, roughness: 0.5 });
      let top = null;
      if (t.blocks.length) {
        const settled = new T.InstancedMesh(
          box,
          material,
          Math.max(1, t.blocks.length - 1),
        );
        const matrix = new T.Matrix4();
        settled.count = Math.max(0, t.blocks.length - 1);
        t.blocks.slice(0, -1).forEach((b, j) => {
          matrix.compose(
            new T.Vector3(b.x, 0.7 + j * 0.8, b.z),
            new T.Quaternion(),
            new T.Vector3(b.width, 0.75, b.depth),
          );
          settled.setMatrixAt(j, matrix);
          settled.setColorAt(
            j,
            new T.Color(color).lerp(new T.Color("#ffffff"), j % 2 ? 0.15 : 0),
          );
        });
        settled.castShadow = settled.receiveShadow = true;
        group.add(settled);
        const b = t.blocks.at(-1);
        top = new T.Mesh(box, material);
        top.name = own ? "bs-own-top" : "bs-rival-top";
        top.scale.set(b.width, 0.75, b.depth);
        top.position.set(b.x, 0.7 + (t.height - 1) * 0.8, b.z);
        top.castShadow = top.receiveShadow = true;
        group.add(top);
      }
      const block = new T.Mesh(
        box,
        new T.MeshStandardMaterial({
          color: own ? "#fff4a3" : "#fffde7",
          emissive: own ? "#b47722" : "#786b39",
          emissiveIntensity: 0.22,
          roughness: 0.35,
        }),
      );
      block.name = own ? "bs-own-slider" : "bs-rival-slider";
      block.scale.set(t.width, 0.75, t.depth);
      block.castShadow = true;
      group.add(block);
      const edge = new T.LineSegments(
        new T.EdgesGeometry(box),
        new T.LineBasicMaterial({
          color: "#875a30",
          transparent: true,
          opacity: 0.65,
        }),
      );
      block.add(edge);
      const ghost = new T.Mesh(
        new T.PlaneGeometry(1, 1),
        new T.MeshBasicMaterial({
          color: "#29465b",
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: T.DoubleSide,
        }),
      );
      ghost.rotation.x = -Math.PI / 2;
      ghost.scale.set(t.width, t.depth, 1);
      group.add(ghost);
      const guide = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(),
          new T.Vector3(),
        ]),
        new T.LineDashedMaterial({
          color: "#fffdf2",
          dashSize: 0.14,
          gapSize: 0.12,
          transparent: true,
          opacity: 0.85,
        }),
      );
      guide.name = own ? "bs-drop-guide" : "bs-rival-guide";
      group.add(guide);
      const rail = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(),
          new T.Vector3(),
        ]),
        new T.LineDashedMaterial({
          color: own ? "#8d6947" : "#dde9ef",
          dashSize: 0.25,
          gapSize: 0.2,
          transparent: true,
          opacity: 0.55,
        }),
      );
      group.add(rail);
      moving.push({ pid, block, ghost, guide, rail, top, landingAt });
    });
  }
  function frame(dt = 0) {
    const { S, api } = get();
    if (!S) return;
    const signature = JSON.stringify([
      S.round,
      S.myTower,
      Object.values(S.towers).map((t) => [t.height, t.out]),
    ]);
    if (signature !== key) {
      key = signature;
      rebuild(S);
    }
    const now = performance.now() / 1000;
    for (const m of moving) {
      const t = S.towers[m.pid],
        d = slide(t, api.now()),
        x = t.x + (t.axis === "x" ? d : 0),
        z = t.z + (t.axis === "z" ? d : 0),
        floor = 0.32 + t.height * 0.8,
        hover = floor + 1.8;
      m.block.visible =
        m.ghost.visible =
        m.guide.visible =
        m.rail.visible =
          ["countdown", "stack"].includes(S.phase) && !t.out;
      m.block.position.set(x, hover, z);
      m.ghost.position.set(x, floor + 0.02, z);
      const points = m.guide.geometry.attributes.position;
      points.setXYZ(0, x, floor + 0.04, z);
      points.setXYZ(1, x, hover - 0.4, z);
      points.needsUpdate = true;
      m.guide.computeLineDistances();
      const rail = m.rail.geometry.attributes.position;
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
      m.rail.computeLineDistances();
      if (m.top) {
        const b = t.blocks.at(-1),
          p = helper.reducedMotion()
            ? 1
            : Math.min(1, Math.max(0, (now - m.landingAt) / 0.48)),
          fall = Math.pow(1 - p, 3),
          bounce = Math.sin(p * Math.PI * 2) * Math.pow(1 - p, 2);
        m.top.position.y = 0.7 + (t.height - 1) * 0.8 + fall * 1.15;
        m.top.scale.set(
          b.width * (1 + bounce * 0.08),
          0.75 * (1 - bounce * 0.18),
          b.depth * (1 + bounce * 0.08),
        );
      }
    }
    const highest = Math.max(
        0,
        ...Object.entries(S.towers).map(
          ([pid, t]) => t.height * 0.8 * (pid === S.myTower ? 1 : 0.36),
        ),
      ),
      target = highest * 0.48;
    lift +=
      (target - lift) *
      (helper.reducedMotion() ? 1 : 1 - Math.exp(-Math.max(0.016, dt) * 4));
    const halfH = Math.max(7.5, highest * 0.58 + 3.6),
      halfW = Math.max(8.5, halfH * aspect);
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfW / aspect;
    camera.bottom = -halfW / aspect;
    camera.position.set(6, lift + 17, 27);
    camera.lookAt(vec.set(0, lift + 1.2, -2));
    camera.updateProjectionMatrix();
  }
  return {
    scene,
    camera,
    frame,
    resize(w, h) {
      aspect = w / h;
      frame();
    },
    dispose() {
      towers.traverse((node) => {
        if (node.isInstancedMesh) node.dispose();
      });
      skyTexture.dispose();
      prior.clear();
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
