import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound, setHtml, activePlayers } from "./word-party-kit.js";
export default partyRound({
  id: "read-my-lips",
  prefix: "lips",
  name: "Read My Lips",
  family: "create",
  field: () =>
    '<div class="wp-card lips-silent"></div><div class="wp-composer"><input data-input name="guess" aria-label="Your phrase guess" placeholder="Type the phrase…" maxlength="160" autocomplete="off" inputmode="text" spellcheck="false"><p class="wp-cue lips-cue" hidden></p></div>',
  describe({ S, local, watching }) {
    const lead = S.me === S.lead,
      full = S.myResult === 100;
    return {
      title:
        S.phase === "reveal"
          ? S.last.phrase
          : lead
            ? "Your mic off. Your lips on."
            : "Watch closely. What did they say?",
      phase: S.phase === "reveal" ? "Results" : lead ? "Mouth" : "Guess",
      progress: `${S.acted?.length || 0} / ${activePlayers(S).filter((p) => p.id !== S.lead).length} guessed`,
      button: lead ? "Mouth the phrase silently" : "Guess phrase",
      ready: !watching && !lead && !full && !!local.text.trim(),
      status: lead
        ? "Mute your microphone in the call, then mouth the phrase. Nothing is recorded."
        : full
          ? "Every word matched. Wait for the others."
          : S.myFeedback || "Type what you see. Your best guess counts.",
      actors: [S.lead],
      roles: { [S.lead]: "Mouther" },
      waiting: "Reading lips",
    };
  },
  patch({ el, S, watching }) {
    const reveal = S.phase === "reveal",
      lead = S.me === S.lead;
    setHtml(
      el.querySelector(".lips-silent"),
      `<span class="lips-icon" aria-hidden="true">${reveal ? "✓" : '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><path d="M4 24 Q12 12 24 16 Q36 12 44 24 Q36 38 24 34 Q12 38 4 24Z" fill="var(--fam-soft)" stroke="var(--fam)" stroke-width="3"/><path d="M4 24 Q24 29 44 24" fill="none" stroke="var(--fam)" stroke-width="3"/></svg>'}</span><div class="wp-face">${faceHtml(S, S.lead, { name: true })}</div><h4>${esc(reveal ? S.last.phrase : lead ? S.phrase || "" : "Read their lips on video")}</h4><p>${lead && !reveal ? "Microphone muted?" : reveal ? `${Object.values(S.last.results || {}).filter((n) => n === 100).length} full matches` : "The phrase stays with the Mouther."}</p>`,
    );
    const locked = watching || lead || reveal || S.myResult === 100;
    const input = el.querySelector("[data-input]");
    input.disabled = locked;
    input.hidden = locked;
    const cue = el.querySelector(".lips-cue");
    cue.hidden = !locked;
    cue.textContent = reveal
      ? "Full phrase: 100 points · Half the words: 50"
      : lead
        ? "Camera on · Mic off · Repeat slowly"
        : S.myResult === 100
          ? "✓ Full phrase matched"
          : "Watch the Mouther’s video";
  },
  submit({ send, local, el }) {
    send({ guess: local.text });
    local.text = "";
    el.querySelector("[data-input]").value = "";
  },
});
