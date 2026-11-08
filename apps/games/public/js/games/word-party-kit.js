import { ensureStylesheet } from "../util.js";
import {
  paintFinal,
  paintLiveStrip,
  syncHudTimer,
  stopHudTimer,
} from "../kit.js";

export function watching(state) {
  return (
    state.spectator ||
    state.watching ||
    !(state.players || []).some((player) => player.id === state.me)
  );
}

export function activePlayers(state) {
  return (state.players || []).filter(
    (player) => !state.gone?.includes(player.id),
  );
}

// Keep composers alive through count updates. Only a new round or phase resets a draft.
export function partyRound(config) {
  let root = null;
  let state = null;
  let api = null;
  let phaseKey = "";
  let local = {};

  function send(action) {
    if (state && !state.preparing && !watching(state)) api.send(action);
  }

  function refresh() {
    if (root && state) render(root, state, api);
  }

  function context() {
    return {
      el: root,
      S: state,
      local,
      send,
      refresh,
      watching: watching(state),
      api,
    };
  }

  function render(el, S, nextApi) {
    ensureStylesheet("party-scenes-css", "/css/party-scenes.css");
    ensureStylesheet("word-party-css", "/css/word-party.css");
    ensureStylesheet(config.id + "-css", "/css/" + config.id + ".css");
    root = el;
    state = S;
    api = nextApi;
    if (S.phase === "done") {
      stopHudTimer(el);
      phaseKey = "";
      paintFinal(el, {
        scene: config.id,
        scores: S.scores || {},
        players: S.players || [],
        you: watching(S) ? null : S.me,
        watching: watching(S),
      });
      return;
    }
    const nextKey = JSON.stringify([
      S.instanceId,
      S.me,
      S.round,
      S.phase,
      S.lead,
      !!watching(S),
    ]);
    const newPhase = nextKey !== phaseKey || !el.querySelector(".word-party");
    if (newPhase) {
      phaseKey = nextKey;
      local = { text: "", selected: null, matches: {}, noteId: null };
      el.innerHTML = `<section class="party-scene word-party ${config.prefix}-world" data-family="${config.family || "party"}" aria-label="${config.name}">
        <div class="gk-hud party-hud"><span class="gk-hud-round"></span><span class="gk-hud-phase"></span><span class="gk-hud-progress"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>
        <h3 class="gk-prompt party-prompt t-heading"></h3>
        <div class="wp-play ${config.prefix}-play">${config.field(S, local)}</div>
        <div class="wp-actions"><p class="wp-status tb-reason" role="status"></p><button type="button" class="tb-btn tb-primary gk-primary wp-primary"></button></div>
      </section>`;
      const input = el.querySelector("[data-input]");
      if (input) {
        input.oninput = () => {
          local.text = input.value;
          refresh();
        };
        input.onkeydown = (event) => {
          if (
            event.key === "Enter" &&
            !event.isComposing &&
            input.tagName !== "TEXTAREA"
          ) {
            const button = el.querySelector(".wp-primary");
            if (!button.disabled && !button.hidden) {
              event.preventDefault();
              button.click();
            }
          }
        };
      }
      config.bind?.(context());
      api.announce?.(
        S.phase === "reveal" ? "Round results" : config.name + ": " + S.phase,
      );
    }
    const scene = el.querySelector(".word-party");
    scene.style.setProperty(
      "--round-zoom",
      String(parseFloat(el.style.zoom) || 1),
    );
    scene.dataset.phase = S.phase;
    const description = config.describe(context());
    el.querySelector(".party-prompt").textContent = description.title;
    el.querySelector(".gk-hud-round").textContent =
      `Round ${S.round} of ${S.rounds}`;
    el.querySelector(".gk-hud-phase").textContent =
      description.phase || S.phase;
    el.querySelector(".gk-hud-progress").textContent =
      `${description.progress || `${S.acted?.length || 0} / ${description.total ?? activePlayers(S).length} ready`}`;
    const reveal = S.phase === "reveal";
    const canNext = S.me === S.hostId || S.me === S.lead;
    const button = el.querySelector(".wp-primary");
    button.hidden = !!description.hideButton;
    button.textContent = reveal ? "Next" : description.button;
    button.disabled =
      !!S.preparing ||
      !!watching(S) ||
      (reveal ? !canNext : !description.ready);
    const reason = S.last?.skipped
      ? S.last.reason
      : reveal
        ? `${watching(S) ? "Round revealed" : `You earned +${S.last?.pts?.[S.me] || 0} points`}${canNext ? "" : " · Waiting for the host"}`
        : watching(S)
          ? "Watching · answers stay private until the reveal."
          : description.status;
    el.querySelector(".wp-status").textContent = S.preparing
      ? "Get ready…"
      : reason;
    const actionKey = phaseKey;
    button.onclick = () => {
      if (phaseKey !== actionKey || root !== el || button.disabled) return;
      if (reveal) send({ next: true });
      else config.submit(context());
    };
    config.patch?.(context());
    paintLiveStrip(scene, S, {
      acted: S.acted || [],
      actors: description.actors,
      roles: description.roles,
      verb: description.verb || "Locked",
      waiting: description.waiting || "Thinking",
      gains: reveal ? S.last?.pts || {} : {},
    });
    config.after?.(context());
    for (const detail of scene.querySelectorAll(":scope > .wp-detail"))
      scene.appendChild(detail);
    if (newPhase && reveal)
      scene.querySelector(".pl-live")?.classList.add("wp-gains");
    syncHudTimer(el, S, api, { totalMs: S.windowMs });
  }

  return {
    styles: [
      "/css/party-scenes.css",
      "/css/word-party.css",
      `/css/${config.id}.css`,
    ],
    ownsTimer: true,
    render,
    dispose(el) {
      const target = el || root;
      stopHudTimer(target);
      target?.querySelectorAll("input,textarea,button,svg").forEach((node) => {
        node.onclick = node.oninput = node.onkeydown = null;
        node.onpointerdown =
          node.onpointermove =
          node.onpointerup =
          node.onpointercancel =
            null;
      });
      if (target)
        target.onpointerdown =
          target.onpointermove =
          target.onpointerup =
          target.onpointercancel =
          target.onlostpointercapture =
            null;
      root = state = api = null;
      phaseKey = "";
      local = {};
    },
  };
}

export function setHtml(node, html) {
  if (node.innerHTML !== html) node.innerHTML = html;
}
