import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound, setHtml } from "./word-party-kit.js";

const symbols = { right: "✓", present: "•", absent: "×" };
function board(rows, mini = false) {
  return Array.from(
    { length: 6 },
    (_, row) =>
      `<div class="ll-row">${Array.from({ length: 5 }, (_, col) => {
        const mark = rows[row]?.marks[col];
        return `<span class="ll-tile ${mark ? "is-" + mark : ""}" aria-label="${mark || "Empty"}">${mini ? (mark ? symbols[mark] : "") : esc(rows[row]?.word?.[col]?.toUpperCase() || "")}<i>${mini ? "" : symbols[mark] || ""}</i></span>`;
      }).join("")}</div>`,
  ).join("");
}
export default partyRound({
  id: "letter-lock",
  prefix: "ll",
  name: "Letter Lock",
  family: "create",
  field: () =>
    '<div class="ll-lock" aria-label="Your six guesses"></div><div class="wp-composer"><input data-input name="guess" aria-label="Five-letter guess" placeholder="Five-letter word…" maxlength="5" autocomplete="off" autocapitalize="characters" inputmode="text" spellcheck="false"><p class="wp-cue ll-result" hidden></p></div>',
  describe({ S, local, watching }) {
    const solved = S.solved?.includes(S.me),
      used = S.myRows?.length || 0;
    return {
      title:
        S.phase === "reveal"
          ? `The word was ${S.last.answer.toUpperCase()}`
          : "Crack the five-letter lock",
      phase: S.phase === "reveal" ? "Results" : "Solve",
      progress: `${used} / 6 tries`,
      button: "Check word",
      ready: !watching && !solved && used < 6 && /^[a-z]{5}$/i.test(local.text),
      status: solved
        ? "Solved. Watch the other boards."
        : used >= 6
          ? "Your six rows are full. Wait for the reveal."
          : S.myFeedback ||
            "Type five letters. ✓ right · • elsewhere · × absent",
    };
  },
  patch({ el, S, watching }) {
    setHtml(el.querySelector(".ll-lock"), board(S.myRows || []));
    const locked =
      watching ||
      S.phase !== "solve" ||
      S.solved?.includes(S.me) ||
      S.myRows?.length >= 6;
    const input = el.querySelector("[data-input]");
    input.disabled = !!locked;
    input.hidden = !!locked;
    const result = el.querySelector(".ll-result");
    result.hidden = !locked;
    result.textContent =
      S.phase === "reveal"
        ? `✓ ${S.last.answer.toUpperCase()} · Answer revealed`
        : watching
          ? "Watch the marks. Letters stay private."
          : S.solved?.includes(S.me)
            ? "✓ Lock opened · Watch the other boards"
            : "Six tries used · Waiting for the others";
  },
  submit({ send, local, el }) {
    send({ guess: local.text });
    local.text = "";
    el.querySelector("[data-input]").value = "";
  },
  after({ el, S }) {
    let detail = el.querySelector(".ll-others");
    if (!detail) {
      detail = document.createElement("details");
      detail.className = "wp-detail ll-others";
      el.querySelector(".word-party").append(detail);
    }
    setHtml(
      detail,
      `<summary>Other players’ boards · marks only</summary><div class="ll-minis">${(
        S.players || []
      )
        .filter((p) => p.id !== S.me)
        .map(
          (p) =>
            `<div><div class="wp-face">${faceHtml(S, p.id, { name: true })}</div><div class="ll-mini" aria-label="${esc(p.name)}’s marks">${board(S.boards?.[p.id] || [], true)}</div></div>`,
        )
        .join("")}</div>`,
    );
  },
});
