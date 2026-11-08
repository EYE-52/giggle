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
  id: "undercover",
  prefix: "under",
  title: "Undercover",
  describe({ S, local, send }) {
    const piece = stamp(
      "Your word. Your side is unknown.",
      esc(S.word || "Private to each seat"),
      "under-folder",
    );
    if (S.phase === "reveal")
      return {
        title: S.last.caught
          ? "The different words were found"
          : "An Undercover stayed hidden",
        piece,
        message:
          result(S, S.last.pair.join(" / ")) +
          `<p>Undercover: ${S.last.undercover.map((pid) => person(S, pid)).join(" ")}</p>`,
      };
    const log = `<div class="under-clues">${(S.clues || []).map((c) => `<span>${person(S, c.pid)} <b>${esc(c.text || "Passed")}</b></span>`).join("")}</div>`;
    const alive = S.alive?.includes(S.me),
      mine = S.turnPid === S.me;
    if (S.phase === "clue")
      return {
        title: mine ? "Give one careful clue" : "Listen for the different word",
        piece,
        progress: `Cycle ${S.cycle}/3`,
        input: {
          label: "One word clue",
          max: 40,
          help: "One word. No secret words or repeated clues.",
        },
        message: log,
        locked: !mine || !alive,
        ready:
          mine &&
          /^[\p{L}]+(?:['’-][\p{L}]+)*$/u.test(local.text.trim()) &&
          !S.clues?.some(
            (c) => c.text?.toLowerCase() === local.text.trim().toLowerCase(),
          ) &&
          local.text.trim().toLowerCase() !== S.word?.toLowerCase(),
        button: "Share clue",
        status: !alive
          ? "You are out this round. Watch the clues."
          : mine
            ? "Give a new clue. If it matches either secret word, choose another."
            : `${seatLabel(S, S.turnPid)} gives a clue.`,
        action: () => send({ clue: local.text }),
      };
    return {
      title: "Who has a different word?",
      piece,
      progress: `Cycle ${S.cycle}/3`,
      options: choices(
        S,
        people(S)
          .filter((p) => S.alive.includes(p.id) && p.id !== S.me)
          .map((p) => p.id),
      ),
      message: log,
      locked: !alive || !!S.myVote,
      ready: alive && !S.myVote && local.selected !== null,
      button: "Lock vote",
      status: !alive
        ? "You are out this round. Watch the vote."
        : S.myVote
          ? "Vote locked. Waiting for the room."
          : "Scroll through the clues below the choices. Tied votes remove nobody.",
      action: () => send({ vote: local.selected }),
    };
  },
});
