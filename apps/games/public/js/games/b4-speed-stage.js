import { ensureStylesheet } from "../util.js";
import {
  faceHtml,
  paintFinal,
  paintLiveStrip,
  syncHudTimer,
  stopHudTimer,
} from "../kit.js";

export function setHtml(node, html) {
  if (node.innerHTML !== html) node.innerHTML = html;
}
function setText(node, value) {
  const text = String(value);
  if (node.textContent !== text) node.textContent = text;
}
export function speedStage(config) {
  let root = null,
    state = null,
    api = null,
    clock = null;
  let local = {},
    key = "",
    lastPhase = "";
  const watching = () => state.spectator || state.watching || !state.me;
  const send = (action) => {
    if (!state.preparing && !watching()) return api.send(action);
    return false;
  };
  const context = () => ({
    el: root,
    S: state,
    api,
    local,
    send,
    watch: watching(),
    now: api.now(),
  });
  function refresh() {
    if (!root || !state || state.phase === "done") return;
    const c = context(),
      info = config.patch(c);
    setText(root.querySelector(".b4-title"), info.title);
    setText(
      root.querySelector(".b4-status"),
      state.preparing
        ? "Get ready…"
        : state.phase === "reveal" && state.me !== state.hostId
          ? info.status + " Waiting for the host."
          : info.status,
    );
    const primary = root.querySelector(".b4-primary");
    const reveal = state.phase === "reveal";
    const showButton = reveal || !!config.submit;
    primary.hidden = !showButton;
    root.querySelector(".b4-play-badge").hidden = showButton;
    root.querySelector(".b4-play-badge").textContent =
      state.strings.playBadge || "";
    primary.textContent = reveal ? "Next" : info.button;
    setText(
      root.querySelector(".gk-hud-phase"),
      reveal ? "Results" : config.phase,
    );
    const notice = document.getElementById("toast");
    const noticeText =
      notice && !notice.hidden ? notice.textContent.trim() : "";
    const noticeSlot = root.querySelector(".b4-notice");
    setText(noticeSlot, noticeText);
    noticeSlot.title = noticeText;
    noticeSlot.hidden = !noticeText;
    const result = root.querySelector(".b4-result");
    result.hidden = !reveal;
    if (reveal) {
      const detail = config.result(c);
      result.querySelector(".b4-result-mark").textContent = detail.mark;
      result.querySelector(".b4-result-value").textContent = detail.value;
      result.querySelector(".b4-result-label").textContent = detail.label;
      const person = result.querySelector(".b4-result-person");
      setHtml(
        person,
        detail.pid ? faceHtml(state, detail.pid, { name: true }) : "",
      );
      person.hidden = !detail.pid;
    }
    primary.disabled =
      !!state.preparing ||
      watching() ||
      (reveal ? state.me !== state.hostId : !info.ready);
    primary.onclick = () => {
      if (primary.disabled) return;
      if (state.phase === "reveal") send({ next: true });
      else config.submit?.(context());
    };
  }
  function render(el, S, nextApi) {
    root = el;
    state = S;
    api = nextApi;
    for (const file of ["party-scenes", "b4-speed-stage", config.id])
      ensureStylesheet(file + "-css", "/css/" + file + ".css");
    if (S.phase === "done") {
      stopHudTimer(el);
      clearInterval(clock);
      clock = null;
      local.bank?.dispose();
      local = {};
      key = "";
      lastPhase = "";
      paintFinal(el, {
        scene: config.id,
        scores: S.scores,
        players: S.players || [],
        you: watching() ? null : S.me,
        watching: watching(),
      });
      return;
    }
    const nextKey = JSON.stringify([S.instanceId, S.me]);
    if (key !== nextKey || !el.querySelector(".b4-stage")) {
      key = nextKey;
      local.bank?.dispose();
      local = { text: "" };
      el.innerHTML = `<section class="party-scene b4-stage ${config.prefix}-world" data-family="arcade" aria-label="${config.name}">
        <div class="gk-hud party-hud"><span class="gk-hud-round"></span><div class="b4-hud-status"><span class="gk-hud-phase" role="status" aria-live="polite"></span><span class="b4-notice" role="status" aria-live="polite" hidden></span></div><span class="gk-hud-progress"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>
        <h3 class="party-prompt b4-title"></h3>
        <div class="b4-field ${config.prefix}-field"><div class="b4-play">${config.field}</div><div class="b4-result" hidden><span class="b4-result-mark" aria-hidden="true"></span><strong class="b4-result-value"></strong><span class="b4-result-label"></span><div class="b4-result-person" hidden></div></div></div>
        <div class="b4-actions"><p class="b4-status tb-reason" role="status"></p><div class="b4-action-slot"><button class="tb-btn tb-primary gk-primary b4-primary" type="button"></button><div class="b4-play-badge" hidden></div></div></div>
      </section>`;
      const input = el.querySelector(".b4-input");
      if (input) {
        input.oninput = () => {
          local.text = input.value;
          refresh();
        };
        input.onkeydown = (event) => {
          if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            el.querySelector(".b4-primary").click();
          }
        };
      }
      config.bind?.(context(), refresh);
      clearInterval(clock);
      clock = setInterval(refresh, 100);
    }
    el.querySelector(".b4-stage").style.setProperty(
      "--b4-zoom",
      String(parseFloat(el.style.zoom) || 1),
    );
    const phase = `${S.round}:${S.phase}`;
    if (lastPhase !== phase) {
      lastPhase = phase;
      el.querySelector(".b4-stage").dataset.phase = S.phase;
      if (S.phase === "reveal") {
        el.querySelector(".b4-title").classList.remove("b4-pop");
        void el.querySelector(".b4-title").offsetWidth;
        el.querySelector(".b4-title").classList.add("b4-pop");
      } else el.querySelector(".b4-title").classList.remove("b4-pop");
      api.announce?.(config.name + ": " + S.phase);
    }
    el.querySelector(".gk-hud-round").textContent = S.rounds
      ? `Round ${S.round} of ${S.rounds}`
      : `Fuse ${S.round}`;
    el.querySelector(".gk-hud-progress").textContent = config.progress(S);
    refresh();
    const roles =
      config.roles?.(S) ||
      Object.fromEntries((S.gone || []).map((pid) => [pid, "Left"]));
    paintLiveStrip(el.querySelector(".b4-stage"), S, {
      family: "arcade",
      acted: S.acted || [],
      roles,
      waiting: config.waiting || "Playing",
      verb: "Locked",
      gains: S.phase === "reveal" ? S.last?.pts : {},
    });
    syncHudTimer(el, S, api, { totalMs: S.windowMs });
  }
  return {
    styles: [
      "/css/party-scenes.css",
      "/css/b4-speed-stage.css",
      `/css/${config.id}.css`,
    ],
    ownsTimer: true,
    render,
    dispose(el) {
      stopHudTimer(el || root);
      clearInterval(clock);
      clock = null;
      local.bank?.dispose();
      (el || root)?.querySelectorAll("button,input").forEach((n) => {
        n.onclick = n.oninput = n.onkeydown = null;
      });
      config.dispose?.();
      root = state = api = null;
      local = {};
      key = lastPhase = "";
    },
  };
}
