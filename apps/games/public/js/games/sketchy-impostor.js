import { esc, nameOf } from "../util.js";
import { faceHtml } from "../kit.js";
import { batchView, html, chip, watch } from "./b6-kit.js";
import { drawingInput } from "./b6-drawing.js";

export default batchView({
  id: "sketchy-impostor",
  prefix: "si",
  name: "Sketchy Impostor",
  family: "create",
  field: `<div class="b6-stage si-sketchbook"><canvas class="si-canvas" width="900" height="900" tabindex="0" aria-label="Shared drawing canvas"></canvas><span class="si-page-label"></span></div><div class="b6-tools si-tools"></div>`,
  mount(c) {
    let current = c;
    const input = drawingInput(c.el.querySelector("canvas"), () => ({
      ...current,
      enabled:
        current.S.phase === "draw" &&
        current.S.turnPid === current.S.me &&
        !watch(current.S) &&
        !current.S.preparing,
      color: current.S.colors?.[current.S.me],
      size: 7,
    }));
    return {
      update(S, api) {
        current = { ...c, S, api };
        input.update();
      },
      dispose() {
        input.dispose();
        current = null;
      },
    };
  },
  patch({ el, S, local, send, refresh }) {
    const reveal = S.phase === "reveal",
      mine = S.turnPid === S.me;
    el.querySelector(".si-page-label").textContent =
      S.phase === "draw"
        ? `Lap ${S.lap} / 2 · ${mine ? "Your one stroke" : nameOf(S, S.turnPid) + " is drawing"}`
        : `${S.category} · ${S.phase === "vote" ? "Who is bluffing?" : "Look at the clues"}`;
    let tools = "";
    if (S.phase === "vote")
      tools = `<div class="b6-scroll" role="group" aria-label="Suspects">${(
        S.players || []
      )
        .filter((p) => p.id !== S.me && !S.gone.includes(p.id))
        .map((p) =>
          chip(
            faceHtml(S, p.id, { name: true }),
            `data-vote="${esc(p.id)}" aria-pressed="${local.vote === p.id}" ${S.myVote || watch(S) ? "disabled" : ""}`,
          ),
        )
        .join("")}</div>`;
    else if (S.phase === "guess")
      tools = `<input class="si-guess" aria-label="Guess the secret word" placeholder="One guess at the secret word" maxlength="80" ${S.role === "impostor" && !watch(S) ? "" : "disabled"}>`;
    else if (reveal)
      tools = `<p>${faceHtml(S, S.impostor, { name: true })} was the Impostor${S.last?.guess ? ` · guessed “${esc(S.last.guess)}”` : ""}.</p>`;
    else
      tools = `<p>${S.role === "impostor" ? "You see the category. Blend in with one stroke." : watch(S) ? "The word stays with the artists." : "Keep the word secret. Draw a clue with one stroke."}</p>`;
    html(el.querySelector(".si-tools"), tools);
    for (const b of el.querySelectorAll("[data-vote]"))
      b.onclick = () => {
        local.vote = b.dataset.vote;
        refresh();
      };
    const input = el.querySelector(".si-guess");
    if (input) {
      input.value = local.text;
      input.oninput = () => {
        local.text = input.value;
        refresh();
      };
      input.onkeydown = (e) => {
        if (e.key === "Enter" && !e.isComposing)
          el.querySelector(".b6-primary").click();
      };
    }
    const ready =
      S.phase === "vote"
        ? !!local.vote && !S.myVote
        : S.phase === "guess" && S.role === "impostor" && !!local.text.trim();
    const status =
      S.phase === "draw"
        ? mine
          ? "Drag one continuous stroke. Lift to pass the pen."
          : `Wait for ${nameOf(S, S.turnPid)} to lift the pen.`
        : S.phase === "vote"
          ? S.myVote
            ? "Vote locked. Waiting for the other artists."
            : "Choose a suspect, then lock your vote."
          : S.phase === "guess"
            ? S.role === "impostor"
              ? "You were caught. One correct guess steals 150 points."
              : "Waiting for the Impostor’s one guess."
            : S.last.correct
              ? "The Impostor guessed it and stole 150 points."
              : S.last.caught
                ? "Caught! Correct voters earn 100 each."
                : "Nobody caught the Impostor. They earn 150.";
    return {
      title: reveal
        ? `The word was ${S.word}`
        : S.phase === "guess"
          ? "The Impostor gets one guess"
          : S.role === "impostor"
            ? `${S.category} · You are the Impostor`
            : S.word
              ? `${S.category} · ${S.word}`
              : `${S.category} · Watch the sketch`,
      phase:
        S.phase === "draw"
          ? "Draw"
          : S.phase === "vote"
            ? "Vote"
            : S.phase === "guess"
              ? "Guess"
              : "Reveal",
      progress:
        S.phase === "draw" ? `Lap ${S.lap}/2` : `${S.voted.length} votes`,
      ready,
      button:
        S.phase === "guess"
          ? "Guess word"
          : S.phase === "draw"
            ? "Lift to end your stroke"
            : "Lock vote",
      status,
      roles: S.phase === "draw" ? { [S.turnPid]: "Drawing" } : {},
      waiting: S.phase === "vote" ? "Voting" : false,
    };
  },
  submit({ S, local, send }) {
    send(
      S.phase === "guess" ? { guess: local.text.trim() } : { vote: local.vote },
    );
  },
});
