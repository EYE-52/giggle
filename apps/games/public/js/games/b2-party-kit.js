/* Batch 2 frame: stable slots, private seat drafts, kit clocks and live scores. */
import { esc, ensureStylesheet } from "../util.js";
import {
  paintFinal,
  paintLiveStrip,
  faceHtml,
  syncHudTimer,
  stopHudTimer,
} from "../kit.js";
export { esc, faceHtml };
export const watch = (S) =>
  !!(
    S.spectator ||
    S.watching ||
    !(S.players || []).some((p) => p.id === S.me)
  );
export const people = (S) =>
  (S.players || []).filter((p) => !S.gone?.includes(p.id));
export const name = (S, pid) =>
  (S.players || []).find((p) => p.id === pid)?.name || "Someone";
export const person = (S, pid) => faceHtml(S, pid, { name: true });
export function choices(S, ids, extra = () => "") {
  return ids.map((pid) => ({ value: pid, html: person(S, pid) + extra(pid) }));
}
function html(node, value) {
  if (node.innerHTML !== value) node.innerHTML = value;
}
export function partyGame(config) {
  let root = null,
    state = null,
    api = null,
    key = "",
    turn = "",
    actionKey = "",
    local = {},
    toastHome = null;
  function restoreToast() {
    if (!toastHome) return;
    const { node, parent, next } = toastHome;
    parent.insertBefore(node, next?.parentNode === parent ? next : null);
    toastHome = null;
  }
  function render(el, S, nextApi) {
    for (const [id, href] of [
      ["party-scenes-css", "/css/party-scenes.css"],
      ["b2-party-css", "/css/b2-party.css"],
      [config.id + "-css", "/css/" + config.id + ".css"],
    ])
      ensureStylesheet(id, href);
    root = el;
    state = S;
    api = nextApi;
    if (S.phase === "done") {
      restoreToast();
      stopHudTimer(el);
      key = actionKey = "";
      paintFinal(el, {
        scene: config.id,
        players: S.players || [],
        scores: S.scores || {},
        you: watch(S) ? null : S.me,
        watching: watch(S),
        note: config.finalNote?.(S) || "",
        title: config.finalTitle?.(S) || "Final scores",
      });
      return;
    }
    const nextKey = JSON.stringify([S.instanceId, S.me]);
    if (key !== nextKey || !el.querySelector(".b2-scene")) {
      restoreToast();
      key = nextKey;
      el.innerHTML = `<section class="party-scene b2-scene ${config.prefix}-world" data-family="party" aria-label="${esc(config.title)}">
        <div class="gk-hud party-hud"><span class="gk-hud-round"></span><span class="gk-hud-phase"></span><span class="gk-hud-progress"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>
        <h3 class="gk-prompt party-prompt b2-prompt"></h3>
        <div class="b2-play"><div class="b2-piece ${config.prefix}-piece"></div><div class="b2-work">
          <div class="b2-options gk-choices" role="group" aria-label="Choices"></div>
          <div class="b2-composer"><label class="b2-input-label" for="b2-answer"></label><input id="b2-answer" data-input type="text" inputmode="text" autocomplete="off" enterkeyhint="go"><p class="b2-input-help tb-reason"></p></div>
          <div class="b2-message"></div>
        </div></div>
        <div class="b2-actions"><p class="b2-status tb-reason" role="status"></p><button class="tb-btn tb-primary gk-primary b2-primary" type="button"></button><div class="b2-tools"></div><div class="b2-feedback" aria-label="Game feedback"></div></div>
      </section>`;
      const toast = document.getElementById("toast");
      if (toast) {
        toastHome = { node: toast, parent: toast.parentNode, next: toast.nextSibling };
        el.querySelector(".b2-feedback").append(toast);
      }
      local = { selected: null, text: "", guessMode: false };
      const input = el.querySelector("[data-input]");
      input.oninput = () => {
        if (root !== el || key !== nextKey) return;
        local.text = input.value;
        refresh();
      };
      input.onkeydown = (event) => {
        if (root !== el || key !== nextKey) return;
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          el.querySelector(".b2-primary").click();
        }
      };
    }
    const nextTurn = JSON.stringify([
      S.round,
      S.phase,
      S.turnPid,
      S.turnNo,
      S.me,
    ]);
    if (turn !== nextTurn) {
      turn = nextTurn;
      local = { selected: null, text: "", guessMode: false };
      el.querySelector("[data-input]").value = "";
      api.announce?.(config.title + ": " + S.phase);
    }
    const renderActionKey = JSON.stringify([
      S.instanceId,
      S.me,
      S.round,
      S.phase,
      S.turnNo,
      S.endsAt,
    ]);
    actionKey = renderActionKey;
    const current = () =>
      root === el && actionKey === renderActionKey && key === nextKey;
    const guardedSend = (action) => (current() ? send(action) : false);
    const context = {
      S,
      local,
      watching: watch(S),
      send: guardedSend,
      refresh,
    };
    const d = config.describe(context),
      scene = el.querySelector(".b2-scene");
    scene.dataset.phase = S.phase;
    scene.style.setProperty(
      "--b2-zoom",
      String(parseFloat(el.style.zoom) || 1),
    );
    el.querySelector(".gk-hud-round").textContent = S.rounds
      ? `Round ${S.round} of ${S.rounds}`
      : `Day ${S.round}`;
    el.querySelector(".gk-hud-phase").textContent = watch(S)
      ? "Watching"
      : d.phase ||
        {
          lastChance: "Last chance",
          pick: "Whisper",
          flip: "Coin",
          reveal: "Results",
        }[S.phase] ||
        S.phase;
    el.querySelector(".gk-hud-progress").textContent =
      d.progress ||
      config.progress?.(S) ||
      `${S.acted?.length || 0}/${d.total ?? people(S).length} ready`;
    el.querySelector(".b2-prompt").textContent = d.title;
    html(el.querySelector(".b2-piece"), d.piece || "");
    const opts = el.querySelector(".b2-options");
    opts.hidden = !d.options?.length;
    html(
      opts,
      (d.options || [])
        .map(
          (opt, i) =>
            `<button type="button" class="gk-choice b2-choice pl-c${i % 5}${local.selected === opt.value ? " is-selected" : ""}" data-choice="${esc(opt.value)}" aria-pressed="${local.selected === opt.value}"${watch(S) || d.locked || opt.disabled ? " disabled" : ""}>${opt.html || esc(opt.label)}${local.selected === opt.value ? '<span class="b2-tick" aria-hidden="true">✓</span>' : ""}</button>`,
        )
        .join(""),
    );
    for (const button of opts.querySelectorAll("[data-choice]"))
      button.onclick = () => {
        if (!current() || button.disabled) return;
        local.selected = button.dataset.choice;
        refresh();
      };
    const composer = el.querySelector(".b2-composer");
    composer.hidden = !d.input;
    const input = el.querySelector("[data-input]");
    input.disabled = watch(S) || !!d.locked || !d.input;
    input.maxLength = d.input?.max || 80;
    el.querySelector(".b2-input-label").textContent = d.input?.label || "";
    el.querySelector(".b2-input-help").textContent = d.input?.help || "";
    const message = el.querySelector(".b2-message");
    message.hidden = !d.message;
    html(message, d.message || "");
    scene.classList.toggle("b2-has-options", !!d.options?.length);
    scene.classList.toggle("b2-has-input", !!d.input);
    const reveal = S.phase === "reveal";
    const canNext = !watch(S) && (S.me === S.hostId || S.me === S.lead);
    const button = el.querySelector(".b2-primary");
    button.textContent = reveal ? "Next" : d.button || "Lock in";
    button.disabled =
      !!S.preparing || watch(S) || (reveal ? !canNext : !d.ready);
    el.querySelector(".b2-status").textContent = S.preparing
      ? "Waiting for the room to be ready."
      : watch(S)
        ? "Watching this round. Private cards stay with their players."
        : reveal
          ? S.last?.reason && S.last?.skipped
            ? S.last.reason
            : `You earned +${S.last?.pts?.[S.me] || 0} this round.${d.revealHint ? " " + d.revealHint : ""}${canNext ? "" : " Waiting for the host."}`
          : d.status || "Choose an option, then lock it in.";
    button.onclick = () => {
      if (!current() || button.disabled) return;
      if (reveal) guardedSend({ next: true });
      else d.action?.();
    };
    const tools = el.querySelector(".b2-tools");
    html(
      tools,
      (d.tools || [])
        .map(
          (tool, i) =>
            `<button type="button" class="tb-btn tb-chip" data-tool="${i}"${tool.disabled || watch(S) ? " disabled" : ""}>${esc(tool.label)}</button>`,
        )
        .join(""),
    );
    for (const tool of tools.querySelectorAll("[data-tool]"))
      tool.onclick = () => {
        if (current() && !tool.disabled)
          d.tools[Number(tool.dataset.tool)].action();
      };
    paintLiveStrip(scene, S, {
      acted: S.acted || [],
      gains: reveal ? S.last?.pts || {} : {},
      roles: d.roles,
      verb: "Ready",
      waiting: "Thinking",
    });
    syncHudTimer(el, S, api, { totalMs: S.windowMs });
  }
  function send(action) {
    if (state && !state.preparing && !watch(state)) return api.send(action);
    return false;
  }
  function refresh() {
    if (root && state) render(root, state, api);
  }
  return {
    ownsTimer: true,
    styles: [
      "/css/party-scenes.css",
      "/css/b2-party.css",
      `/css/${config.id}.css`,
    ],
    render,
    dispose(el) {
      restoreToast();
      stopHudTimer(el || root);
      (el || root)?.querySelectorAll("button,input").forEach((n) => {
        n.onclick = n.oninput = n.onkeydown = null;
      });
      root = state = api = null;
      key = turn = actionKey = "";
      local = {};
    },
  };
}
export const stamp = (title, body, cls = "") =>
  `<div class="b2-stamp ${cls}"><span class="t-caption">${esc(title)}</span><strong>${body}</strong></div>`;
export const result = (S, text) =>
  `<div class="b2-result"><strong class="t-title">${esc(text)}</strong>${S.last?.pts ? `<span class="t-caption">${Object.values(S.last.pts).reduce((a, b) => a + b, 0)} points shared this round</span>` : ""}</div>`;
