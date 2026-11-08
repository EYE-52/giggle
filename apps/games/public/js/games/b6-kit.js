import { ensureStylesheet, esc } from "../util.js";
import {
  paintFinal,
  paintLiveStrip,
  syncHudTimer,
  stopHudTimer,
} from "../kit.js";

export const watch = (S) =>
  !!S.spectator ||
  !(S.players || []).some((p) => p.id === S.me) ||
  S.gone?.includes(S.me);
export function html(node, value) {
  if (node && node.innerHTML !== value) node.innerHTML = value;
}
export function chip(label, attrs = "") {
  return `<button type="button" class="tb-btn tb-chip" ${attrs}>${label}</button>`;
}

// The same DOM slots survive count, score, phase and turn changes. Art has a
// reserved stage; actions and the live strip never follow variable content.
export function batchView(config) {
  let root = null,
    S = null,
    api = null,
    local = {},
    key = "",
    resource = null;
  const send = (action) => {
    if (S && !S.preparing && !watch(S) && S.phase !== "done")
      return api.send(action);
    return false;
  };
  const context = () => ({
    el: root,
    S,
    api,
    local,
    send,
    refresh: () => render(root, S, api),
  });
  function teardown() {
    resource?.dispose?.();
    resource = null;
  }
  function render(el, state, nextApi) {
    if (!el || !state) return;
    for (const sheet of ["party-scenes", "b6", config.id])
      ensureStylesheet(sheet + "-css", `/css/${sheet}.css`);
    root = el;
    S = state;
    api = nextApi;
    if (S.phase === "done") {
      teardown();
      stopHudTimer(root);
      key = "";
      paintFinal(root, {
        scene: config.id,
        scores: S.scores || {},
        players: S.players || [],
        you: watch(S) ? null : S.me,
        watching: watch(S),
      });
      return;
    }
    if (!el.querySelector(".b6-world")) {
      teardown();
      key = "";
      el.innerHTML = `<section class="party-scene b6-world ${config.prefix}-world" data-family="${config.family}" aria-label="${esc(config.name)}">
        <div class="gk-hud party-hud"><span class="gk-hud-round"></span><span class="gk-hud-phase"></span><span class="gk-hud-progress"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>
        <h3 class="gk-prompt party-prompt b6-prompt"></h3>
        <div class="b6-field">${config.field}</div>
        <div class="b6-actions"><p class="b6-status tb-reason gk-meta" role="status"></p><button type="button" class="tb-btn tb-primary b6-primary"></button></div>
      </section>`;
      resource = config.mount?.(context());
    }
    const nextKey = [S.instanceId, S.me, S.round, S.phase, S.turnNo || 0].join(
      ":",
    );
    if (key !== nextKey) {
      key = nextKey;
      local = { zone: null, vote: null, power: "soft", text: "", gallery: 0 };
      config.reset?.(context());
      const stage = el.querySelector(".b6-stage");
      stage?.classList.remove("b6-pop");
      if (S.phase === "reveal") stage?.classList.add("b6-pop");
      api.announce?.(config.name + ": " + S.phase);
    }
    const scene = el.querySelector(".b6-world");
    scene.dataset.phase = S.phase;
    scene.style.setProperty(
      "--b6-zoom",
      String(parseFloat(el.style.zoom) || 1),
    );
    const d = config.patch(context()) || {};
    el.querySelectorAll(".b6-tools p").forEach((n) =>
      n.classList.add("gk-meta"),
    );
    el.querySelector(".b6-prompt").textContent = d.title || config.name;
    el.querySelector(".gk-hud-round").textContent =
      d.round || `Round ${S.round} of ${S.rounds}`;
    el.querySelector(".gk-hud-phase").textContent = d.phase || S.phase;
    el.querySelector(".gk-hud-progress").textContent = d.progress || "";
    const next = S.phase === "reveal";
    const canNext = S.me === S.hostId;
    const primary = el.querySelector(".b6-primary");
    primary.textContent = next ? "Next" : d.button || "Lock in";
    primary.disabled =
      !!S.preparing || !!watch(S) || (next ? !canNext : !d.ready);
    el.querySelector(".b6-status").textContent = S.preparing
      ? "Getting the table ready…"
      : watch(S)
        ? "Watching · the players have the controls."
        : next
          ? `${d.status || `You earned +${S.last?.pts?.[S.me] || 0} points.`}${canNext ? "" : " Waiting for the host."}`
          : d.status || "";
    const token = key;
    primary.onclick = () => {
      if (key !== token || primary.disabled) return;
      if (next) send({ next: true });
      else config.submit(context());
    };
    paintLiveStrip(
      scene,
      {
        ...S,
        players: (S.players || []).map((p) => ({
          ...p,
          left: p.left || S.gone?.includes(p.id),
        })),
      },
      {
        acted: d.acted || S.voted || S.ready || S.locked || [],
        waiting: d.waiting ?? "Playing",
        roles: d.roles || {},
        family: config.family,
        gains: next ? S.last?.pts || {} : {},
      },
    );
    syncHudTimer(el, S, api, { show: true, totalMs: S.windowMs });
    resource?.update?.(S, api, context());
  }
  return {
    styles: ["/css/party-scenes.css", "/css/b6.css", `/css/${config.id}.css`],
    ownsTimer: true,
    render,
    dispose(el) {
      teardown();
      stopHudTimer(el || root);
      (el || root)?.querySelectorAll("button,input").forEach((n) => {
        n.onclick = n.oninput = n.onkeydown = null;
      });
      root = S = api = null;
      local = {};
      key = "";
    },
  };
}
