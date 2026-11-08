import { speedStage } from "./b4-speed-stage.js";
export default speedStage({
  id: "echo-pads",
  name: "Echo Pads",
  prefix: "ep",
  phase: "Echo",
  field: `<div class="ep-console"><div class="ep-head"><div class="ep-counter"></div><button class="tb-btn tb-chip ep-sound" type="button" data-watchok>Sound on</button></div><div class="ep-pads">${["●", "▲", "■", "◆"].map((shape, i) => `<button class="gk-choice ep-pad ep-pad-${i}" type="button" data-pad="${i}"><span class="ep-shape" aria-hidden="true">${shape}</span><span class="ep-name"></span></button>`).join("")}</div></div>`,
  progress: (S) => `Level ${S.level} / 15`,
  roles: (S) =>
    Object.fromEntries(
      (S.players || []).map((p) => [
        p.id,
        S.gone?.includes(p.id)
          ? "Left"
          : S.alive?.includes(p.id)
            ? `${S.reached?.[p.id] || 0} cleared`
            : { text: "Out", tone: "bad" },
      ]),
    ),
  result: ({ S, watch }) => ({
    mark: "● ▲ ■ ◆",
    value: watch
      ? Math.max(0, ...Object.values(S.last.reached))
      : S.last.reached[S.me] || 0,
    label: S.strings.clearedLabel,
  }),
  patch({ el, S, api, local, send, watch, now }) {
    if (!local.bank) {
      local.bank = api.toolkit?.createSoundBank?.();
      local.bank?.setMuted(!local.soundOn);
    }
    const sound = el.querySelector(".ep-sound");
    sound.textContent = local.soundOn ? "Mute sound" : "Sound on";
    sound.onclick = () => {
      local.soundOn = !local.soundOn;
      local.bank?.unlock();
      local.bank?.setMuted(!local.soundOn);
      if (local.soundOn) local.bank?.cue("click");
    };
    const soundKey = `${S.round}:${S.level}:${S.showIndex}`;
    if (S.phase === "show" && local.soundKey !== soundKey && !S.preparing) {
      local.soundKey = soundKey;
      local.bank?.cue(["click", "turn", "tick", "join"][S.activePad]);
    }
    const open =
      S.phase === "repeat" &&
      S.alive.includes(S.me) &&
      !S.acted.includes(S.me) &&
      !watch &&
      !S.preparing;
    el.querySelector(".ep-counter").textContent =
      S.phase === "show"
        ? `${S.showIndex + 1} / ${S.length}`
        : `${S.myStep || 0} / ${S.length}`;
    // Count sent input events so quick taps do not depend on a network
    // round trip. Only the server decides whether any step is correct.
    const attemptKey = `${S.round}:${S.level}:${S.phase}`;
    if (local.attemptKey !== attemptKey) {
      local.attemptKey = attemptKey;
      local.sentStep = S.myStep || 0;
    }
    local.sentStep = Math.max(local.sentStep, S.myStep || 0);
    const start = S.endsAt - S.length * S.stepMs;
    for (const b of el.querySelectorAll("[data-pad]")) {
      const n = Number(b.dataset.pad);
      b.querySelector(".ep-name").textContent = S.strings.padNames[n];
      b.classList.toggle(
        "is-lit",
        S.phase === "show" &&
          n === S.activePad &&
          now - start - S.showIndex * S.stepMs < S.stepMs * 0.65,
      );
      b.disabled = !open;
      b.onclick = () => {
        if (!b.disabled) {
          local.bank?.unlock();
          local.bank?.cue(["click", "turn", "tick", "join"][n]);
          const sent = send({ pad: n, step: local.sentStep, level: S.level });
          if (sent !== false) local.sentStep++;
        }
      };
    }
    return {
      title: S.strings[S.phase] || S.strings.show,
      button: "Tap the pads",
      ready: false,
      status: watch
        ? "Watching the shared sequence."
        : S.phase === "reveal"
          ? `You earned +${S.last?.pts?.[S.me] || 0} points.`
          : S.phase === "show"
            ? S.strings.waiting
            : !S.alive.includes(S.me)
              ? S.strings.out
              : S.acted.includes(S.me)
                ? S.strings.passed
                : `Repeat all ${S.length} steps in order.`,
    };
  },
});
