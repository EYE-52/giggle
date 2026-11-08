import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound, setHtml } from "./word-party-kit.js";
export default partyRound({
  id: "banned-words",
  prefix: "bw",
  name: "Banned Words",
  family: "create",
  field: () =>
    '<div class="wp-card bw-stack"></div><div class="wp-composer"><input data-input name="guess" aria-label="Your target guess" placeholder="Type your guess…" maxlength="80" autocomplete="off" inputmode="text" spellcheck="false"><p class="wp-cue bw-cue" hidden></p><button class="tb-btn tb-chip bw-skip" type="button">Skip</button></div>',
  describe({ S, local, watching }) {
    const lead = S.me === S.lead,
      teammate = S.teams?.[S.team]?.includes(S.me);
    return {
      title:
        S.phase === "reveal"
          ? `${S.last.correct} cards cracked`
          : lead
            ? "Talk around the forbidden four"
            : teammate
              ? "Name the word they describe"
              : "Listen for a banned word",
      phase:
        S.phase === "reveal"
          ? "Results"
          : lead
            ? "Describe"
            : teammate
              ? "Guess"
              : "Listen",
      progress: `${S.correct || 0} correct`,
      button: lead
        ? "Describe the card aloud"
        : teammate
          ? "Guess word"
          : "Buzz",
      ready: !watching && !lead && (teammate ? !!local.text.trim() : !S.coop),
      status: lead
        ? `Speak to your team. ${3 - (S.skips || 0)} skips left.`
        : S.myFeedback ||
          (teammate
            ? "Type a guess. Correct answers deal a fresh card."
            : "Buzz only if the Describer says a banned word."),
      actors: [S.lead],
      roles: Object.fromEntries(
        (S.players || []).map((p) => [
          p.id,
          p.id === S.lead
            ? "Describer"
            : S.teams?.[S.team]?.includes(p.id)
              ? "Guessing"
              : "Buzz watch",
        ]),
      ),
      waiting: teammate ? "Guessing" : "Listening",
    };
  },
  patch({ el, S, send, watching }) {
    const lead = S.me === S.lead,
      teammate = S.teams?.[S.team]?.includes(S.me),
      reveal = S.phase === "reveal";
    setHtml(
      el.querySelector(".bw-stack"),
      reveal
        ? `<span class="bw-stamp">${S.last.correct} ✓</span><h4>Turn complete</h4><p>20 points a card · up to 100</p>`
        : `<div class="wp-face">${faceHtml(S, S.lead, { name: true })}</div><h4>${esc(S.card?.target || (teammate ? "Listen to your Describer" : S.banned?.length ? "Listen for these four" : "Keep your ears open"))}</h4>${S.card || S.banned?.length ? `<div class="bw-banned">${(S.card?.banned || S.banned).map((w) => `<span>× ${esc(w)}</span>`).join("")}</div>` : "<p>The target and banned words stay hidden.</p>"}`,
    );
    const input = el.querySelector("[data-input]");
    input.disabled = watching || lead || !teammate || reveal;
    input.hidden = watching || lead || !teammate || reveal;
    const cue = el.querySelector(".bw-cue");
    cue.hidden = !input.hidden;
    cue.textContent = reveal
      ? `${S.last.team === "red" ? "Red" : "Blue"} ${S.coop ? "crew" : "team"} · ${Math.min(100, 20 * S.last.correct)} points each`
      : lead
        ? "Avoid all four words."
        : watching
          ? "Listen along. The target stays secret."
          : "Target hidden · Listen for the four words";
    const skip = el.querySelector(".bw-skip");
    skip.textContent = `Skip (${3 - (S.skips || 0)})`;
    skip.hidden = !lead || reveal;
    skip.disabled = watching || !lead || reveal || S.skips >= 3;
    skip.onclick = () => {
      if (!skip.disabled) send({ skip: true, cardNo: S.cardNo });
    };
  },
  submit({ S, send, local, el }) {
    if (S.teams[S.team].includes(S.me)) {
      send({ guess: local.text, cardNo: S.cardNo });
      local.text = "";
      el.querySelector("[data-input]").value = "";
    } else send({ buzz: true, cardNo: S.cardNo });
  },
});
