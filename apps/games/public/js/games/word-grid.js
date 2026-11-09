import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound, setHtml } from "./word-party-kit.js";
function adjacent(a, b) {
  return (
    a !== b &&
    Math.abs((a % 4) - (b % 4)) <= 1 &&
    Math.abs(Math.floor(a / 4) - Math.floor(b / 4)) <= 1
  );
}
export default partyRound({
  id: "word-grid",
  prefix: "wg3",
  name: "Word Grid",
  family: "create",
  field: (S) =>
    `<div class="wg3-longest" hidden></div><div class="wg3-grid" aria-label="Letter tiles">${(S.grid || []).map((letter, i) => `<button class="gk-choice wg3-tile" data-tile="${i}" aria-label="Tile ${i + 1}: ${esc(letter)}">${esc(letter)}</button>`).join("")}</div><div class="wp-composer"><input data-input name="word" aria-label="Your grid word" placeholder="Type a word…" autocomplete="off" inputmode="text" maxlength="24" spellcheck="false"><button type="button" class="tb-btn tb-chip wg3-clear">Clear</button></div><div class="wg3-bottom"><span class="wg3-count"></span><button class="tb-btn tb-chip wg3-done" type="button">Done finding</button></div>`,
  bind({ el, local, refresh }) {
    local.path = [];
    function add(at) {
      if (
        !Number.isInteger(at) ||
        local.path.includes(at) ||
        (local.path.length && !adjacent(local.path.at(-1), at))
      )
        return;
      local.path.push(at);
      local.text = local.path
        .map((i) => el.querySelector(`[data-tile="${i}"]`).textContent)
        .join("");
      el.querySelector("[data-input]").value = local.text;
      refresh();
    }
    el.onpointerdown = (event) => {
      const tile = event.target.closest("[data-tile]");
      if (!tile || tile.disabled) return;
      event.preventDefault();
      el.setPointerCapture(event.pointerId);
      local.dragging = true;
      local.dragMoved = false;
      local.lastPointer = Number(tile.dataset.tile);
      add(local.lastPointer);
    };
    el.onpointermove = (event) => {
      if (!local.dragging) return;
      const tile = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-tile]");
      if (
        tile &&
        !tile.disabled &&
        Number(tile.dataset.tile) !== local.lastPointer
      ) {
        local.dragMoved = true;
        local.lastPointer = Number(tile.dataset.tile);
        add(local.lastPointer);
      }
    };
    el.onpointerup =
      el.onpointercancel =
      el.onlostpointercapture =
        () => {
          local.dragging = false;
        };
    // Keyboard users can trace with Enter/Space, as well as type a word.
    for (const tile of el.querySelectorAll("[data-tile]"))
      tile.onclick = (event) => {
        if (event.detail === 0 && !tile.disabled)
          add(Number(tile.dataset.tile));
      };
    el.querySelector("[data-input]").oninput = () => {
      local.path = [];
      local.text = el.querySelector("[data-input]").value;
      refresh();
    };
  },
  describe({ S, local, watching }) {
    return {
      title:
        S.phase === "reveal"
          ? "Keep the words only you found"
          : "Follow a trail of letters",
      phase: S.phase === "reveal" ? "Results" : "Find",
      progress: `${S.mine?.length || 0} found`,
      button: "Save word",
      ready: !watching && !S.myLocked && local.text.trim().length >= 3,
      status: S.myLocked
        ? "Words locked. Wait for the others."
        : S.myFeedback ||
          "Trace touching tiles or type. Shared words cancel.",
    };
  },
  patch({ el, S, local, send, refresh, watching }) {
    const disabled = watching || S.myLocked || S.phase !== "find";
    const reveal = S.phase === "reveal";
    const longest = el.querySelector(".wg3-longest");
    longest.hidden = !reveal;
    if (reveal)
      setHtml(
        longest,
        `<b>Five longest possible words</b><ul>${S.last.longest.map((word) => `<li>${esc(word)}</li>`).join("")}</ul>`,
      );
    el.querySelector(".wp-composer").classList.toggle("wp-invisible", reveal);
    el.querySelector(".wg3-bottom").classList.toggle("wp-invisible", reveal);
    for (const tile of el.querySelectorAll("[data-tile]")) {
      tile.disabled = disabled;
      tile.classList.toggle(
        "is-selected",
        local.path?.includes(Number(tile.dataset.tile)) || false,
      );
      tile.setAttribute(
        "aria-pressed",
        String(local.path?.includes(Number(tile.dataset.tile)) || false),
      );
    }
    el.querySelector("[data-input]").disabled = disabled;
    el.querySelector(".wg3-count").textContent =
      S.phase === "reveal"
        ? `Your word score: ${S.last.totals[S.me] || 0}`
        : `${S.mine?.length || 0} words saved`;
    const clear = el.querySelector(".wg3-clear");
    clear.disabled = disabled;
    clear.onclick = () => {
      local.text = "";
      local.path = [];
      el.querySelector("[data-input]").value = "";
      refresh();
    };
    const done = el.querySelector(".wg3-done");
    done.disabled = disabled;
    done.onclick = () => {
      if (!done.disabled) send({ done: true });
    };
  },
  submit({ el, local, send }) {
    send({
      word: local.text,
      ...(local.path?.length ? { path: local.path } : {}),
    });
    local.text = "";
    local.path = [];
    el.querySelector("[data-input]").value = "";
  },
  after({ el, S }) {
    let detail = el.querySelector(".wg3-words");
    if (!detail) {
      detail = document.createElement("details");
      detail.className = "wp-detail wg3-words";
      detail.open = S.phase === "reveal";
      el.querySelector(".word-party").append(detail);
    }
    setHtml(
      detail,
      S.phase === "reveal"
        ? `<summary>Word trails and longest finds</summary><p>Five longest: ${S.last.longest.map(esc).join(" · ")}</p>${(S.players || []).map((p) => `<div class="wp-face">${faceHtml(S, p.id, { name: true })}</div><p>${(S.last.words[p.id] || []).map((w) => (w.shared ? `<s>${esc(w.word)}</s> (shared)` : `${esc(w.word)} +${w.points}`)).join(" · ") || "No words found"}</p>`).join("")}`
        : `<summary>Your saved words (${S.mine?.length || 0})</summary><p>${(S.mine || []).map(esc).join(" · ") || "Find your first word on the tray."}</p>`,
    );
  },
});
