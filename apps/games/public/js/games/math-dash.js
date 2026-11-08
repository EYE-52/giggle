import { speedStage } from "./b4-speed-stage.js";
export default speedStage({
  id: "math-dash",
  name: "Math Dash",
  prefix: "md",
  phase: "Sprint",
  field: `<div class="md-machine"><div class="md-ticket"><span class="md-count"></span><strong class="md-problem"></strong></div>
    <label class="b4-label" for="mdAnswer">Your answer</label><input id="mdAnswer" class="b4-input" inputmode="none" type="text" maxlength="6" autocomplete="off">
    <div class="md-keys">${["1", "2", "3", "4", "5", "6", "7", "8", "9", "−", "0", "⌫"].map((key) => `<button class="tb-btn tb-secondary md-key" data-key="${key}" type="button">${key}</button>`).join("")}</div></div>`,
  bind({ el, local }, refresh) {
    for (const button of el.querySelectorAll("[data-key]"))
      button.onclick = () => {
        if (button.disabled) return;
        const input = el.querySelector(".b4-input"),
          key = button.dataset.key;
        local.text =
          key === "⌫"
            ? local.text.slice(0, -1)
            : key === "−"
              ? local.text.startsWith("-")
                ? local.text.slice(1)
                : "-" + local.text
              : (local.text + key).slice(0, 6);
        input.value = local.text;
        refresh();
      };
  },
  progress: (S) => `${S.counts?.[S.me] || 0} solved`,
  roles: (S) =>
    Object.fromEntries(
      (S.players || []).map((p) => [
        p.id,
        S.gone?.includes(p.id) ? "Left" : `${S.counts?.[p.id] || 0} solved`,
      ]),
    ),
  result: ({ S, watch }) => ({
    mark: "＋ × ÷",
    value: watch
      ? Math.max(0, ...Object.values(S.last.counts))
      : S.last.counts[S.me] || 0,
    label: watch ? S.strings.topCount : S.strings.solvedLabel,
  }),
  patch({ el, S, local, watch, now }) {
    if (local.problemKey !== `${S.round}:${S.index}`) {
      local.problemKey = `${S.round}:${S.index}`;
      local.text = "";
      el.querySelector(".b4-input").value = "";
    }
    const locked = now < S.lockedUntil,
      open = S.phase === "sprint" && !watch && !S.preparing;
    el.querySelector(".md-machine").classList.toggle("is-locked", locked);
    el.querySelector(".md-problem").textContent =
      S.problem || (S.phase === "reveal" ? "✓" : "＋ × ÷");
    el.querySelector(".md-count").textContent =
      S.phase === "reveal"
        ? `${S.last?.counts?.[S.me] || 0} solved`
        : S.difficulty;
    el.querySelector(".b4-input").disabled = !open || locked;
    for (const b of el.querySelectorAll("[data-key]"))
      b.disabled = !open || locked;
    const status = watch
      ? S.strings.watch
      : S.phase === "reveal"
        ? `You earned +${S.last?.pts?.[S.me] || 0} points. Waiting for the next sprint.`
        : locked
          ? S.strings.lock
          : "Type the answer, then check it.";
    return {
      title: S.phase === "reveal" ? S.strings.reveal : S.strings.sprint,
      status,
      button: S.strings.check,
      ready: open && !locked && /^-?\d+$/.test(local.text),
    };
  },
  submit({ S, local, send }) {
    send({ answer: Number(local.text), index: S.index });
  },
});
