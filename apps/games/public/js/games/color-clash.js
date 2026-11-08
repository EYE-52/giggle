import { speedStage } from "./b4-speed-stage.js";
export default speedStage({
  id: "color-clash",
  name: "Color Clash",
  prefix: "cc",
  phase: "Cards",
  field: `<div class="cc-deck"><div class="cc-card"><span class="cc-word"></span><span class="cc-cue"></span></div><div class="cc-options">${[0, 1, 2, 3].map((i) => `<button type="button" class="gk-choice cc-option cc-color-${i}" data-color="${i}"></button>`).join("")}</div></div>`,
  progress: (S) => `${Math.min(20, S.index + 1)} / 20`,
  result: ({ S, watch }) => ({
    mark: "● ▲ ■ ◆",
    value: watch
      ? Math.max(0, ...Object.values(S.last.raw))
      : S.last.raw[S.me] || 0,
    label: S.strings.cardPointsLabel,
  }),
  patch({ el, S, send, watch }) {
    const word = el.querySelector(".cc-word");
    word.textContent = S.colors.names[S.card.word].toUpperCase();
    word.className = "cc-word cc-ink-" + S.card.ink;
    const marks = S.colors.marks || ["●", "▲", "■", "◆"];
    const cue = el.querySelector(".cc-cue");
    cue.textContent = marks[S.card.ink] + " " + S.strings.inkMark;
    cue.style.visibility = S.card.mode === "ink" ? "visible" : "hidden";
    const open = S.phase === "card" && !S.myPick && !watch && !S.preparing;
    for (const b of el.querySelectorAll("[data-color]")) {
      const n = Number(b.dataset.color);
      b.textContent = marks[n] + " " + S.colors.names[n];
      b.disabled = !open;
      b.classList.toggle("is-selected", S.myPick?.pick === n);
      b.setAttribute("aria-pressed", String(S.myPick?.pick === n));
      b.onclick = () => {
        if (!b.disabled) send({ pick: n, card: S.index });
      };
    }
    // Word mode uses plain written names, so it never depends on seeing ink.
    word.setAttribute(
      "aria-label",
      S.colors.names[S.card.word] + ", ink " + S.colors.names[S.card.ink],
    );
    return {
      title: S.phase === "reveal" ? S.strings.reveal : S.strings[S.card.mode],
      button: "Choose a colour",
      ready: false,
      status: watch
        ? "Watching the same card as everyone."
        : S.phase === "reveal"
          ? `You earned +${S.last?.pts?.[S.me] || 0} points.`
          : S.myPick
            ? S.myPick.correct
              ? S.strings.correct
              : S.strings.wrong
            : S.strings.waiting,
    };
  },
});
