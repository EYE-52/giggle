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
  const p = pose(S, api, reduced),
    x = w * 0.12,
    y = h * 0.12,
    gw = w * 0.76,
    gh = h * 0.62;
  ctx.fillStyle = "#175d50";
  ctx.fillRect(0, 0, w, h);
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
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(-12, -8, 24, 30);
  ctx.fillRect(-34, -8, 68, 9);
  ctx.fillStyle = "#ffe6c8";
  ctx.beginPath();
  ctx.arc(0, -17, 10, 0, Math.PI * 2);
  ctx.fill();
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
function build(T, helper, get) {
  const scene = new T.Scene();
  scene.background = new T.Color("#175d50");
  const camera = new T.PerspectiveCamera(42, 1, 0.1, 100);
  let aspect = 1;
  function frameCamera() {
    camera.aspect = aspect;
    camera.fov = aspect < 1.45 ? 43 : 40;
    camera.position.set(0, 3.4, 12.5);
    camera.lookAt(0, 0.6, 4.5);
    camera.updateProjectionMatrix();
  }
  frameCamera();
  scene.add(new T.HemisphereLight("#ffffff", "#175d50", 3));
  const sun = new T.DirectionalLight("#ffffff", 3);
  sun.position.set(-3, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -12,
    right: 12,
    top: 12,
    bottom: -12,
    far: 35,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.001;
  sun.shadow.normalBias = 0.02;
  helper.renderer().shadowMap.enabled = true;
  helper.renderer().shadowMap.type = T.PCFSoftShadowMap;
  scene.add(sun);
  const white = new T.MeshStandardMaterial({ color: "#ffffff" });
  const grass = new T.Mesh(
    new T.BoxGeometry(20, 0.1, 22),
    new T.MeshStandardMaterial({ color: "#23836b", roughness: 1 }),
  );
  grass.position.set(0, -0.15, 3);
  grass.receiveShadow = true;
  scene.add(grass);
  for (let i = -5; i <= 5; i++) {
    const stripe = new T.Mesh(
      new T.PlaneGeometry(2, 22),
      new T.MeshStandardMaterial({
        color: i % 2 ? "#369779" : "#278b70",
        roughness: 1,
      }),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(i * 2, -0.094, 3);
    stripe.receiveShadow = true;
    scene.add(stripe);
  }
  const stand = new T.Mesh(
    new T.BoxGeometry(24, 2, 1.5),
    new T.MeshStandardMaterial({ color: "#458a83", roughness: 1 }),
  );
  stand.position.set(0, 0.2, -4);
  scene.add(stand);
  function bar(x, y, z, w, h, d, mat = white, parent = scene) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  bar(-3.2, 1.6, 0, 0.16, 3.2, 0.16);
  bar(3.2, 1.6, 0, 0.16, 3.2, 0.16);
  bar(0, 3.2, 0, 6.5, 0.16, 0.16);
  // Real mesh strands stay visible on phone GPUs, where GL lines are one pixel.
  const netMaterial = new T.MeshStandardMaterial({
    color: "#e7fff6",
    transparent: true,
    opacity: 0.84,
    roughness: 1,
  });
  for (let i = 0; i <= 16; i++)
    bar(-3.2 + i * 0.4, 1.6, -0.65, 0.04, 3.2, 0.04, netMaterial);
  for (let i = 0; i <= 8; i++)
    bar(0, i * 0.4, -0.65, 6.4, 0.04, 0.04, netMaterial);
  for (const x of [-3.2, 3.2]) {
    for (let i = 0; i <= 8; i++)
      bar(x, i * 0.4, -0.325, 0.04, 0.04, 0.65, netMaterial);
  }
  bar(0, 0, 3, 6.4, 0.03, 0.08);
  bar(0, 0, 7, 0.7, 0.03, 0.08);
  const keeper = new T.Group();
  scene.add(keeper);
  const jersey = new T.MeshStandardMaterial({ color: "#fbbf24" }),
    shorts = new T.MeshStandardMaterial({ color: "#24344f" });
  bar(0, 0, 0, 0.55, 0.8, 0.35, jersey, keeper);
  bar(-0.45, 0.2, 0, 0.55, 0.18, 0.2, jersey, keeper);
  bar(0.45, 0.2, 0, 0.55, 0.18, 0.2, jersey, keeper);
  bar(-0.2, -0.65, 0, 0.18, 0.7, 0.2, shorts, keeper);
  bar(0.2, -0.65, 0, 0.18, 0.7, 0.2, shorts, keeper);
  const head = new T.Mesh(
    new T.SphereGeometry(0.22, 12, 8),
    new T.MeshStandardMaterial({ color: "#ffe6c8" }),
  );
  head.position.y = 0.65;
  head.castShadow = true;
  keeper.add(head);
  keeper.name = "pk6-keeper";
  keeper.scale.setScalar(1.12);
  for (const x of [-0.8, 0.8]) bar(x, 0.2, 0, 0.22, 0.25, 0.24, white, keeper);
  const ball = new T.Mesh(new T.SphereGeometry(0.29, 20, 14), white);
  ball.name = "pk6-ball";
  ball.castShadow = true;
  scene.add(ball);
  const seam = new T.Mesh(
    new T.IcosahedronGeometry(0.295, 1),
    new T.MeshBasicMaterial({ color: "#24344f", wireframe: true }),
  );
  ball.add(seam);
  return {
    scene,
    camera,
    resize(w, h) {
      aspect = w / h;
      frameCamera();
    },
    frame() {
      const { S, api } = get();
      if (!S) return;
      const p = pose(S, api, helper.reducedMotion());
      ball.position.set(p.ball.x, p.ball.y, p.ball.z);
      keeper.position.set(p.keeper.x, p.keeper.y, -0.1);
      keeper.rotation.z = p.keeper.lean;
    },
  };
}
export default batchView({
  id: "penalty-kicks",
  prefix: "pk6",
  name: "Penalty Kicks",
  family: "arcade",
  field: `<div class="b6-stage pk6-pitch"><div class="b6-world-view"><canvas class="b6-flat" aria-label="Goal in 2D"></canvas><div class="b6-gl"></div></div><div class="b6-tools b6-recovery" hidden><span class="b6-view-note" hidden></span><button type="button" class="tb-btn tb-chip" data-retry data-watchok hidden>Retry 3D</button></div></div>
    <div class="pk6-zones" role="group" aria-label="Goal zones"></div>
    <div class="pk6-controls"><div class="tb-seg pk6-power" role="group" aria-label="Shot power"></div><div class="pk6-match-tools"></div></div>`,
  mount({ el, api }) {
    el.querySelector(".b6-field").append(el.querySelector(".b6-actions"));
    return sceneView(el.querySelector(".b6-world-view"), api, build, paint);
  },
  patch({ el, S, local, send, refresh }) {
    const locked = !!S.myChoice || S.phase !== "pick" || watch(S);
    html(
      el.querySelector(".pk6-zones"),
      zones
        .map((label, i) =>
          chip(
            label,
            `data-zone="${i}" aria-pressed="${(S.myChoice?.zone ?? local.zone) === i}" ${locked ? "disabled" : ""}`,
          ),
        )
        .join(""),
    );
    html(
      el.querySelector(".pk6-power"),
      ["soft", "hard"]
        .map((p) =>
          chip(
            p === "soft" ? "Soft" : "Hard",
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
              ? "Pick a zone. Power is chosen by the shooter."
              : local.power === "hard" && local.zone !== null && local.zone < 3
                ? "Hard and high: 20% chance over the bar. Pick a zone, then lock."
                : "Pick a zone and power, then lock your shot.",
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
