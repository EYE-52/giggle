import { partyGame, esc, person, result } from "./b2-party-kit.js";
export default partyGame({
  id: "backronyms",
  prefix: "back",
  title: "Backronyms",
  describe({ S, local, send }) {
    const piece = `<div class="back-rack" aria-label="Letters ${esc(S.letters.join(" "))}">${S.letters.map((letter) => `<span>${esc(letter)}</span>`).join("")}</div>`;
    if (S.phase === "reveal")
      return {
        title: S.category,
        piece,
        revealHint: (S.last.entries || []).length > 2
          ? "Scroll above for every phrase." : "",
        message:
          result(
            S,
            S.last.skipped
              ? "No phrases this round"
              : S.last.winners.length > 1
                ? "It's a tie"
                : "The room has a favourite",
          ) +
          (S.last.entries || [])
            .map(
              (e) =>
                `<p>${person(S, e.pid)} <b>${esc(e.text)}</b> +${S.last.pts[e.pid] || 0}</p>`,
            )
            .join(""),
      };
    if (S.phase === "write") {
      const words = local.text.trim().split(/\s+/),
        valid =
          words.length === S.letters.length &&
          words.every(
            (w, i) =>
              /^[\p{L}]+(?:['’-][\p{L}]+)*[.!?,]?$/u.test(w) &&
              w[0]?.toUpperCase() === S.letters[i],
          );
      return {
        title: S.category,
        piece,
        input: {
          label: "Your phrase",
          max: 80,
          help: `Use ${S.letters.join(" · ")} in that order. One word per letter.`,
        },
        ready: !S.myPhrase && valid,
        locked: !!S.myPhrase,
        button: "Lock phrase",
        status: S.myPhrase
          ? "Phrase sealed. Waiting for the room."
          : "Make each word start with its matching tile.",
        action: () => send({ phrase: local.text }),
      };
    }
    const options = S.entries.map((e) => ({
      value: e.id,
      label: e.text + (e.mine ? " · Yours" : ""),
      disabled: e.mine,
    }));
    return {
      title: "Which phrase gets your vote?",
      piece,
      options,
      locked: !!S.myVote,
      ready: !S.myVote && local.selected !== null,
      button: "Lock vote",
      status: S.myVote
        ? "Vote locked. Waiting for the room."
        : "Your own phrase is marked unavailable. Pick another favourite.",
      action: () => send({ vote: local.selected }),
    };
  },
});
