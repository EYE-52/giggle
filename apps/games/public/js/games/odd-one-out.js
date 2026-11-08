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
  id: "odd-one-out",
  prefix: "odd",
  title: "Odd One Out",
  progress: (S) => S.phase === "talk"
    ? "Ask out loud"
    : S.phase === "lastChance" ? "One final guess"
    : S.phase === "reveal" ? "Place revealed"
    : `${S.acted?.length || 0}/${people(S).length} votes`,
  describe({ S, local, watching, send, refresh }) {
    const isOutsider = !!S.card?.outsider,
      guessing = isOutsider && (local.guessMode || S.phase === "lastChance");
    if (S.phase === "reveal")
      return {
        title: "The secret place opens",
        piece: stamp("The place", esc(S.last.place)),
        message:
          result(
            S,
            S.last.reason === "caught"
              ? "The Outsider was caught."
              : S.last.reason === "escaped"
                ? "The Outsider slipped away."
                : S.last.reason === "found"
                  ? "The place was found."
                  : S.last.reason === "wrong"
                    ? "That was the wrong place."
                    : "The round ended early.",
          ) + `<p>${person(S, S.last.outsider)} was the Outsider.</p>`,
      };
    const piece =
      stamp(
        isOutsider ? "Your secret identity" : "Your place card",
        isOutsider
          ? "The Outsider"
          : S.card
            ? esc(S.card.place)
            : "Sealed for players",
        "odd-passport",
      ) +
      `<p class="b2-piece-note">${S.card?.role ? esc(S.card.role) : isOutsider ? "Listen closely. Blend in." : "Watch the questions unfold."}</p>`;
    if (guessing)
      return {
        title: "Which place is it?",
        piece,
        options: S.places.map((label, i) => ({ value: String(i), label })),
        ready: local.selected !== null,
        button: "Guess the place",
        status: S.phase === "lastChance"
          ? "One last guess. Find the place to earn 100."
          : "One guess. A wrong early guess gives everyone else 100.",
        action: () => send({ place: Number(local.selected) }),
      };
    const tools = [];
    if (isOutsider)
      tools.push({
        label: "I know the place",
        action: () => {
          local.guessMode = true;
          refresh();
        },
      });
    if (S.phase === "talk") {
      tools.push({
        label: S.called ? "Vote already called" : "Call a vote",
        disabled: S.called,
        action: () => send({ callVote: true }),
      });
      if (S.me === S.hostId)
        tools.push({
          label: "End talk",
          action: () => send({ endTalk: true }),
        });
      const mine = S.asker === S.me;
      return {
        title: mine ? "Who will you ask?" : "Listen for a clue",
        piece,
        options: choices(
          S,
          people(S)
            .filter((p) => p.id !== S.me)
            .map((p) => p.id),
        ),
        locked: !mine,
        ready: mine && local.selected !== null,
        button: "Ask this player",
        tools,
        message: `<p class="t-caption">Turn order: ${(S.order || []).map((pid) => person(S, pid)).join(" ")}</p>`,
        status: mine
          ? "Choose a player. Ask out loud, then pass them the turn."
          : `${seatLabel(S, S.asker)} asks next. Anyone may call a vote.`,
        action: () => send({ ask: local.selected }),
      };
    }
    return {
      title:
        S.phase === "lastChance"
          ? "One last chance to find the place"
          : "Who is the Outsider?",
      piece,
      options:
        S.phase === "vote"
          ? choices(
              S,
              people(S)
                .filter((p) => p.id !== S.me)
                .map((p) => p.id),
            )
          : [],
      tools,
      locked: !!S.myVote || S.phase !== "vote",
      ready: S.phase === "vote" && !S.myVote && local.selected !== null,
      button: S.phase === "lastChance" ? "Waiting for the Outsider" : "Lock vote",
      message: S.phase === "lastChance"
        ? '<div class="odd-last-call"><strong class="t-title">One place. One final guess.</strong><p>The Outsider has until the timer ends to name the place.</p></div>'
        : "",
      status:
        S.phase === "lastChance"
          ? "The Outsider has a last place guess."
          : S.myVote
            ? "Vote locked. Waiting for the room."
            : "One top suspect catches them. A tied vote lets them escape.",
      action: () => send({ vote: local.selected }),
    };
  },
});
