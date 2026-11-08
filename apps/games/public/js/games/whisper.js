import {
  partyGame,
  name as seatLabel,
  people,
  choices,
  person,
  esc,
  stamp,
  result,
} from "./b2-party-kit.js";
export default partyGame({
  id: "whisper",
  prefix: "whisp",
  title: "Whisper",
  progress: (S) => {
    if (S.phase === "pick") return "1 Whisperer";
    if (S.phase === "flip") return "Coin in flight";
    if (S.phase === "reveal") return S.last.skipped ? "Round skipped" : S.last.coin === "heads" ? "Heads" : "Tails";
    const callers = people(S).filter((p) => p.id !== S.whisperer);
    return `${callers.filter((p) => S.acted?.includes(p.id)).length}/${callers.length} calls`;
  },
  describe({ S, local, send }) {
    const mine = S.me === S.whisperer;
    const shown = S.phase === "reveal" ? S.last.coin : null;
    const ticket = S.chosen
      ? stamp("The chosen name", person(S, S.chosen))
      : stamp("The Whisperer", person(S, S.whisperer));
    const outcomes = `<div class="whisp-outcomes"><div><b>Heads</b><span>The question opens</span></div><div><b>Tails</b><span>The secret stays sealed</span></div></div>`;
    const piece = `<div class="whisp-envelope"><span class="whisp-coin${S.phase === "flip" ? " is-flipping" : ""}">${shown === "heads" ? "H" : shown === "tails" ? "T" : "?"}</span>${ticket}</div>`;
    if (S.phase === "reveal")
      return {
        title: S.last.skipped
          ? "The whisper waited too long"
          : S.last.coin === "heads"
            ? "Heads. The question opens."
            : "Tails. A secret kept.",
        piece,
        message: S.last.skipped
          ? result(S, S.last.reason)
          : `<div class="b2-result"><strong class="t-title">${esc(S.last.question || "The question stays sealed forever.")}</strong></div>`,
      };
    if (S.phase === "pick")
      return {
        title: mine ? S.question : "A secret question is being read",
        piece,
        options: mine
          ? choices(
              S,
              people(S).map((p) => p.id),
            )
          : [],
        message: !mine
          ? `<div class="whisp-sealed" aria-label="Sealed question">?<span>A private question. One name to come.</span></div>`
          : "",
        ready: mine && local.selected !== null,
        button: "Whisper this name",
        status: mine
          ? "Pick a player who fits. Keep the question to yourself."
          : `${seatLabel(S, S.whisperer)} is choosing a name.`,
        action: () => send({ pick: local.selected }),
      };
    if (S.phase === "flip")
      return {
        title: "The coin is in the air",
        piece,
        message: outcomes,
        button: "Coin flipping",
        status: "The coin lands in a moment.",
      };
    return {
      title: "Will the question escape?",
      piece,
      options: !mine
        ? [
            { value: "heads", label: "Heads · Reveal it" },
            { value: "tails", label: "Tails · Keep it" },
          ]
        : [],
      message: outcomes,
      locked: !!S.myGuess || mine,
      ready: !mine && !S.myGuess && local.selected !== null,
      button: "Call the coin",
      status: mine
        ? "Name picked: +100. Others are calling the coin."
        : S.myGuess
          ? "Your call is locked. Waiting for the coin."
          : "Call heads or tails before the flip. A correct call earns 100.",
      action: () => send({ guess: local.selected }),
    };
  },
});
