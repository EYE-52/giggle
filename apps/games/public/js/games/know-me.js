import { esc, nameOf } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound, setHtml } from "./party-round-kit.js";

export default partyRound({
  id: "know-me",
  prefix: "knowme",
  name: "Know Me",
  field(S) {
    return `<div class="knowme-seat"><span class="knowme-kicker">IN THE HOT SEAT</span><div class="knowme-spotlight">${faceHtml(S, S.lead)}</div><div class="knowme-sofa" aria-hidden="true"><i></i></div><strong>${esc(nameOf(S, S.lead))}</strong></div>
      <div class="knowme-options" role="group" aria-label="Four choices">${(S.question?.options || []).map((option, i) => `<button type="button" class="gk-choice knowme-option knowme-option-${i}" data-pick="${i}" aria-pressed="false"><span class="knowme-letter">${"ABCD"[i]}</span><span class="knowme-option-text">${esc(option)}</span><span class="knowme-pick"></span><span class="knowme-verdict"></span></button>`).join("")}</div><div class="knowme-predictors"></div>`;
  },
  describe({ S, local }) {
    const lead = S.me === S.lead;
    return {
      title: S.question?.q || "",
      phase: S.phase === "pick" ? "Predict" : S.phase,
      roles: { [S.lead]: "Hot seat" },
      button:
        S.myPick != null
          ? "✓ Choice locked"
          : lead
            ? "Lock my answer"
            : "Lock prediction",
      ready: S.myPick == null && local.selected != null,
      status:
        S.myPick != null
          ? "✓ Choice locked · waiting for the others."
          : lead
            ? "Pick what is true for you. Will your friends know?"
            : `Pick the answer you think ${nameOf(S, S.lead)} will choose.`,
    };
  },
  submit({ local, send }) {
    send({ pick: local.selected });
  },
  patch({ el, S, local, watching, refresh }) {
    const reveal = S.phase === "reveal";
    const picked = S.myPick ?? local.selected;
    for (const button of el.querySelectorAll("[data-pick]")) {
      const index = Number(button.dataset.pick);
      const correct = reveal && !S.last?.skipped && index === S.last?.answer;
      button.setAttribute("aria-pressed", String(index === picked));
      button.classList.toggle("is-selected", index === picked);
      button.classList.toggle("is-correct", correct);
      button.classList.toggle("round-pop", correct);
      button.disabled = watching || S.myPick != null || reveal || !!S.preparing;
      setHtml(
        button.querySelector(".knowme-pick"),
        index === picked
          ? `<span class="knowme-tab">${faceHtml(S, S.me)} Your pick</span>`
          : "",
      );
      button.querySelector(".knowme-verdict").textContent = correct
        ? "✓ True answer"
        : "";
      button.onclick = () => {
        if (button.disabled) return;
        local.selected = index;
        refresh();
      };
    }
    const correct = (S.players || []).filter(
      (player) => player.id !== S.lead && S.last?.pts?.[player.id] === 100,
    );
    setHtml(
      el.querySelector(".knowme-predictors"),
      reveal && !S.last?.skipped
        ? `<b>They knew it!</b><div>${correct.map((player) => faceHtml(S, player.id, { name: true })).join("") || "<span>No correct predictions this time.</span>"}</div>`
        : "",
    );
  },
});
