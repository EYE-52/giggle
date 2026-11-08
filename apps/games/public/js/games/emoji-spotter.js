import { esc } from "../util.js";
import { speedStage, setHtml } from "./b4-speed-stage.js";
export default speedStage({
  id: "emoji-spotter",
  name: "Emoji Spotter",
  prefix: "es",
  phase: "Spot",
  field:
    '<div class="es-board"><div class="es-grid" role="group" aria-label="Emoji grid"></div></div>',
  progress: (S) => `${S.acted?.length || 0} locked`,
  roles: (S) =>
    Object.fromEntries(
      (S.players || [])
        .filter((p) => S.wrong.includes(p.id))
        .map((p) => [p.id, { text: "Missed", tone: "bad" }]),
    ),
  result: ({ S }) => ({
    mark: "◎",
    value: S.grid[S.last.odd],
    label: S.strings.oddLabel,
  }),
  patch({ el, S, local, send, watch }) {
    const grid = el.querySelector(".es-grid");
    if (local.gridRound !== S.round) {
      local.gridRound = S.round;
      grid.style.setProperty("--es-size", S.size);
      setHtml(
        grid,
        S.grid
          .map(
            (emoji, i) =>
              `<button class="tb-btn es-tile" type="button" data-tile="${i}" aria-label="Row ${Math.floor(i / S.size) + 1}, column ${(i % S.size) + 1}: ${esc(emoji)}">${esc(emoji)}</button>`,
          )
          .join(""),
      );
    }
    const open =
      S.phase === "spot" && !S.myHit && !S.myWrong && !watch && !S.preparing;
    for (const b of grid.querySelectorAll("[data-tile]")) {
      b.disabled = !open;
      b.classList.toggle(
        "is-correct",
        S.phase === "reveal" && Number(b.dataset.tile) === S.last?.odd,
      );
      b.onclick = () => {
        if (!b.disabled) send({ tap: Number(b.dataset.tile), round: S.round });
      };
    }
    return {
      title: S.phase === "reveal" ? S.strings.reveal : S.strings.spot,
      status: watch
        ? S.strings.watch
        : S.phase === "reveal"
          ? `You earned +${S.last?.pts?.[S.me] || 0} points.`
          : S.myWrong
            ? S.strings.wrong
            : S.myHit
              ? S.strings.hit
              : S.strings.waiting,
      button: "Tap the odd emoji",
      ready: false,
    };
  },
});
