import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound } from "./party-round-kit.js";

function piles(S) {
  const groups = S.last?.groups || [];
  const largest = Math.max(0, ...groups.map((group) => group.members.length));
  return (
    groups
      .map((group) => {
        const winner = group.members.length === largest && largest >= 2;
        return `<article class="think-pile ${winner ? "is-biggest round-pop" : ""}"><span class="think-crown">${winner ? "♛ BIGGEST BRAINWAVE" : group.members.length > 1 ? "A LITTLE MIND MELD" : "ONE OF A KIND"}</span>
      <div class="think-faces">${group.members.map((pid) => `<span title="${esc(S.players.find((p) => p.id === pid)?.name || "")}">${faceHtml(S, pid)}</span>`).join("")}</div>
      <h4 class="think-tag">${esc(group.answer)}</h4><p>${group.members.length} ${group.members.length === 1 ? "mind" : "minds"} · +${S.last?.pts?.[group.members[0]] || 0} each</p>
      <div class="think-members">${group.members.map((pid) => faceHtml(S, pid, { name: true })).join("")}</div></article>`;
      })
      .join("") ||
    '<p class="tb-empty">No brainwaves arrived. Try the next one!</p>'
  );
}

export default partyRound({
  id: "think-alike",
  prefix: "think",
  name: "Think Alike",
  family: "create",
  field(S) {
    return S.phase === "reveal"
      ? `<div class="think-piles">${piles(S)}</div>`
      : `<div class="think-cloud"><span class="think-kicker">QUICK, FIRST THOUGHT!</span><label><input data-input maxlength="30" autocomplete="off" aria-label="Your answer" placeholder="We’re thinking…"></label><p>1–30 characters · Can you think like the room?</p><i class="think-dot" aria-hidden="true"></i></div>`;
  },
  describe({ S, local }) {
    const locked = S.myAnswer != null;
    return {
      title: S.prompt || "",
      button: locked ? "✓ Thought locked" : "Lock thought",
      ready:
        !locked &&
        local.text.trim().length > 0 &&
        local.text.trim().length <= 30,
      status: locked
        ? "✓ Thought locked · waiting for the other minds."
        : "Write one short answer. The biggest matching group wins.",
    };
  },
  submit({ local, send }) {
    send({ answer: local.text.trim() });
  },
  patch({ el, S, watching }) {
    const input = el.querySelector("[data-input]");
    if (input) input.disabled = watching || S.myAnswer != null || !!S.preparing;
  },
});
