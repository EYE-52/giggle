import { esc, nameOf } from "../util.js";
import { faceHtml } from "../kit.js";
import { batchView, watch, html, chip } from "./b6-kit.js";

const faces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const die = (n) =>
  `<span class="df-die" role="img" aria-label="${n}">${faces[n - 1]}</span>`;
export default batchView({
  id: "dice-fibs",
  prefix: "df",
  name: "Dice Fibs",
  family: "board",
  field: `<div class="b6-stage df-felt"><div class="df-bid-sticker"></div><div class="df-cups"></div><div class="df-hand" aria-label="Your dice"></div></div>
    <div class="b6-tools df-tools"><div class="df-quantity"></div><div class="df-faces" role="group" aria-label="Bid face"></div><div class="df-call"></div></div>`,
  reset({ S, local }) {
    local.quantity = S.bid?.quantity || 1;
    local.face = S.bid ? (S.bid.face < 6 ? S.bid.face + 1 : 1) : 2;
    if (S.bid?.face === 6) local.quantity++;
  },
  patch({ el, S, local, send, refresh }) {
    const mine = S.phase === "bid" && S.turnPid === S.me && !watch(S),
      reveal = S.phase === "reveal";
    const max = Object.values(S.counts || {}).reduce((a, b) => a + b, 0);
    const legal =
      local.quantity >= 1 &&
      local.quantity <= max &&
      (!S.bid ||
        local.quantity > S.bid.quantity ||
        (local.quantity === S.bid.quantity && local.face > S.bid.face));
    html(
      el.querySelector(".df-bid-sticker"),
      S.bid
        ? `<small>${reveal ? "The challenged bid" : "Current bid"}</small><strong>${S.bid.quantity} × ${die(S.bid.face)}</strong><span>${faceHtml(S, S.bid.pid, { name: true })}</span>`
        : "<small>No bid yet</small><strong>Shake. Peek. Bluff.</strong><span>How many are under every cup?</span>",
    );
    html(
      el.querySelector(".df-cups"),
      (S.players || [])
        .map(
          (
            p,
          ) => `<div class="df-cup-seat ${p.id === S.turnPid ? "is-turn" : ""}">
      <span class="df-cup" aria-hidden="true">${S.counts[p.id] || 0}</span>${faceHtml(S, p.id, { name: true })}
      <span class="df-mini-dice">${reveal ? (S.last.dice[p.id] || []).map(die).join("") : `${S.counts[p.id] || 0} hidden dice`}</span></div>`,
        )
        .join(""),
    );
    html(
      el.querySelector(".df-hand"),
      watch(S)
        ? "<span>Watching · cups stay private</span>"
        : S.myDice?.length
          ? `<span class="df-peek">Your cup</span>${S.myDice.map(die).join("")}`
          : "<span>Your cup is empty. Watch the remaining players.</span>",
    );
    html(
      el.querySelector(".df-quantity"),
      `${chip("−", `data-step="-1" aria-label="One fewer die" ${mine ? "" : "disabled"}`)}<b aria-label="Bid quantity">${local.quantity}</b>${chip("+", `data-step="1" aria-label="One more die" ${mine ? "" : "disabled"}`)}`,
    );
    html(
      el.querySelector(".df-faces"),
      faces
        .map((f, i) =>
          chip(
            f,
            `data-face="${i + 1}" aria-label="Bid ${i + 1}s" aria-pressed="${local.face === i + 1}" ${mine ? "" : "disabled"}`,
          ),
        )
        .join(""),
    );
    html(
      el.querySelector(".df-call"),
      chip("Call Liar", `data-liar ${mine && S.bid ? "" : "disabled"}`),
    );
    for (const b of el.querySelectorAll("[data-step]"))
      b.onclick = () => {
        local.quantity = Math.max(
          1,
          Math.min(max, local.quantity + Number(b.dataset.step)),
        );
        refresh();
      };
    for (const b of el.querySelectorAll("[data-face]"))
      b.onclick = () => {
        local.face = Number(b.dataset.face);
        refresh();
      };
    el.querySelector("[data-liar]").onclick = () =>
      send({ liar: true, turnNo: S.turnNo });
    const status = reveal
      ? `${nameOf(S, S.last.loser)} loses a die. ${S.last.actual} matched.`
      : !S.counts?.[S.me]
        ? "Your cup is empty. Stay for the final places."
        : mine
          ? !S.bid
            ? "Pick quantity and face. Liar unlocks after the first bid."
            : legal
              ? "Raise the bid, or call Liar."
              : "Raise quantity, or keep it and raise face."
          : `Waiting for ${nameOf(S, S.turnPid)} to bid or call Liar.`;
    return {
      title: reveal
        ? S.last.held
          ? "The bid holds!"
          : "That was a fib!"
        : mine
          ? "Your turn to raise the stakes"
          : `${nameOf(S, S.turnPid)} has the cup`,
      round: `Cup round ${S.round}`,
      phase: reveal ? "Reveal" : "Bid",
      progress: `${max} dice`,
      ready: mine && legal,
      button: "Raise bid",
      status,
      waiting: false,
      roles: Object.fromEntries(
        (S.players || []).map((p) => [p.id, `${S.counts[p.id] || 0} dice`]),
      ),
    };
  },
  submit({ S, local, send }) {
    send({
      bid: { quantity: local.quantity, face: local.face },
      turnNo: S.turnNo,
    });
  },
});
