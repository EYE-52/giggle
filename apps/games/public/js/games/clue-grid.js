import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound, setHtml } from "./word-party-kit.js";
const label = (kind) =>
  ({ red: "R", blue: "B", neutral: "–", trap: "×" })[kind] || "";
export default partyRound({
  id: "clue-grid",
  prefix: "cg",
  name: "Clue Grid",
  family: "create",
  field: () =>
    '<div class="cg-clue"><input data-input name="clue" aria-label="One-word clue" placeholder="One-word clue…" maxlength="30" autocomplete="off" inputmode="text" spellcheck="false"><div class="picker-step cg-picker" role="group" aria-label="Target count"><button type="button" class="picker-btn" data-target-step="-1" aria-label="Decrease target count">−</button><input class="cg-number picker-value" name="targets" autocomplete="off" aria-label="Number of targets" type="number" inputmode="numeric" min="0" max="9" step="1" value="1"><button type="button" class="picker-btn" data-target-step="1" aria-label="Increase target count">+</button></div><div class="cg-meta wp-face"></div></div><div class="cg-grid" aria-label="Word grid"></div><div class="cg-tools"></div>',
  describe({ S, local, watching }) {
    const lead = S.me === S.lead,
      team = S.teams?.[S.team]?.includes(S.me);
    const guesser =
      team &&
      (!lead ||
        S.teams[S.team].filter((p) => !S.gone?.includes(p)).length === 1);
    return {
      title:
        S.phase === "setup"
          ? S.coop
            ? "One team. Nine hidden targets."
            : "Meet your clue crew"
          : S.phase === "reveal"
            ? S.last.winner
              ? `${S.last.winner === "red" ? "Red" : "Blue"} found the way`
              : "Round complete"
            : S.phase === "clue"
              ? `${S.team === "red" ? "Red" : "Blue"} Spymaster: give a clue`
              : `${S.clue?.word || ""} · ${S.clue?.number ?? ""}`,
      phase:
        S.phase === "setup"
          ? "Teams"
          : S.phase === "reveal"
            ? "Results"
            : S.phase === "clue"
              ? "Clue"
              : "Guess",
      progress: S.coop
        ? `${S.turns || 0} / 8 turns`
        : `${S.cards?.filter((c) => c.open).length || 0} / 25 open`,
      button:
        S.phase === "setup"
          ? "Start round"
          : S.phase === "clue"
            ? "Send clue"
            : "Pass turn",
      ready:
        !watching &&
        (S.phase === "setup"
          ? S.me === S.hostId
          : S.phase === "clue"
            ? lead &&
              Number.isInteger(Number(local.targets ?? 1)) &&
              Number(local.targets ?? 1) >= 0 &&
              Number(local.targets ?? 1) <= 9 &&
              local.targets !== "" &&
              /^[a-z]{1,30}$/i.test(local.text.trim()) &&
              !S.cards.some(
                (c) => c.word.toLowerCase() === local.text.trim().toLowerCase(),
              )
            : guesser && S.picks >= 1),
      status:
        S.phase === "setup"
          ? "The host can reshuffle teams. Spymasters rotate each round."
          : S.phase === "reveal"
            ? S.last.reason
            : S.phase === "clue"
              ? lead
                ? "One word, away from the grid words. Pick a number from 0 to 9."
                : "Wait for the Spymaster’s clue."
              : guesser
                ? `Tap a card. Up to ${(S.clue?.number || 0) + 1} picks; pass after one.`
                : "Watch your team follow the clue.",
      actors: Object.values(S.leads || {}).filter(Boolean),
      roles: Object.fromEntries(
        Object.values(S.leads || {})
          .filter(Boolean)
          .map((p) => [p, "Spymaster"]),
      ),
    };
  },
  patch({ el, S, local, send, watching, refresh }) {
    const lead = S.me === S.lead,
      setup = S.phase === "setup",
      reveal = S.phase === "reveal";
    const clueInput = el.querySelector("[data-input]"),
      number = el.querySelector(".cg-number");
    clueInput.disabled = number.disabled =
      watching || S.phase !== "clue" || !lead || !!S.preparing;
    const writing = S.phase === "clue" && lead && !watching;
    clueInput.classList.toggle("wp-invisible", !writing);
    el.querySelector(".cg-picker").classList.toggle("wp-invisible", !writing);
    number.oninput = () => {
      local.targets = number.value;
      refresh();
    };
    for (const button of el.querySelectorAll("[data-target-step]")) {
      const by = Number(button.dataset.targetStep);
      button.disabled = number.disabled ||
        (number.value !== "" && (by < 0 ? Number(number.value) <= 0 : Number(number.value) >= 9));
      button.onclick = () => {
        if (button.disabled || number.disabled) return;
        number.value = String(Math.max(0, Math.min(9, Math.round(Number(number.value) || 0) + by)));
        local.targets = number.value;
        refresh();
      };
    }
    const meta = el.querySelector(".cg-meta");
    meta.hidden = writing;
    setHtml(
      meta,
      setup
        ? "25 words · one hidden trap"
        : `${faceHtml(S, S.lead, { name: true })}<span>Spymaster</span>`,
    );
    const guesser =
      S.teams?.[S.team]?.includes(S.me) &&
      (!lead ||
        S.teams[S.team].filter((p) => !S.gone?.includes(p)).length === 1);
    const grid = el.querySelector(".cg-grid");
    grid.classList.toggle("is-setup", setup);
    setHtml(
      grid,
      setup
        ? ["red", ...(S.coop ? [] : ["blue"])]
            .map(
              (t) =>
                `<div class="cg-team is-${t}"><h4>${t === "red" ? "Red" : "Blue"} ${S.coop ? "co-op crew" : "team"}</h4>${S.teams[t].map((p) => `<div class="wp-face">${faceHtml(S, p, { name: true })}${S.leads[t] === p ? '<span class="cg-role">Spymaster</span>' : ""}</div>`).join("")}</div>`,
            )
            .join("")
        : (S.cards || [])
            .map(
              (c, i) =>
                `<button class="gk-choice cg-word ${c.kind ? "is-" + c.kind : ""}${c.open ? " is-open" : ""}" data-card="${i}" ${!guesser || watching || S.phase !== "guess" || c.open ? "disabled" : ""} aria-label="${esc(c.word)}${c.kind ? ", " + c.kind : ""}${c.open ? ", opened" : ""}"><span>${esc(c.word)}</span><i>${label(c.kind)}</i></button>`,
            )
            .join(""),
    );
    for (const button of grid.querySelectorAll("[data-card]"))
      button.onclick = () => {
        if (!button.disabled) send({ card: Number(button.dataset.card) });
      };
    const tools = el.querySelector(".cg-tools");
    setHtml(
      tools,
      setup
        ? '<button class="tb-btn tb-chip cg-shuffle">Reshuffle teams</button>'
        : `<span class="cg-key">${S.isSpymaster || reveal ? "R red · B blue · – neutral · × trap" : "The key stays with the Spymasters."}</span>`,
    );
    const shuffle = tools.querySelector(".cg-shuffle");
    if (shuffle) {
      shuffle.disabled = watching || S.me !== S.hostId;
      shuffle.onclick = () => {
        if (!shuffle.disabled) send({ reshuffle: true });
      };
    }
  },
  submit({ S, local, send, el }) {
    if (S.phase === "setup") send({ start: true });
    else if (S.phase === "clue")
      send({
        clue: local.text.trim(),
        number: Number(el.querySelector(".cg-number").value),
      });
    else send({ pass: true });
  },
});
