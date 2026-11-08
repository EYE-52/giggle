import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { speedStage, setHtml } from "./b4-speed-stage.js";
export default speedStage({
  id: "hot-potato",
  name: "Hot Potato",
  prefix: "hp",
  phase: "Pass",
  field: `<div class="hp-table"><div class="hp-potato" aria-hidden="true"><span>● ●</span><i>◡</i></div><div class="hp-holder"></div>
    <label class="b4-label" for="hpAnswer">Name something that fits</label><input class="b4-input" id="hpAnswer" type="text" maxlength="30" autocomplete="off">
    <div class="hp-challenge"><div class="hp-last"></div><button class="tb-btn tb-chip hp-nope" type="button">Nope</button></div><div class="hp-older" aria-label="Earlier answers to challenge"></div></div>`,
  progress: (S) => `${Object.values(S.lives).filter((n) => n > 0).length} left`,
  roles: (S) =>
    Object.fromEntries(
      (S.players || []).map((p) => [
        p.id,
        S.gone?.includes(p.id)
          ? "Left"
          : `${S.lives[p.id] || 0} lives${p.id === S.holder ? " · Holder" : ""}`,
      ]),
    ),
  result: ({ S }) => ({
    mark: "◡",
    value: S.last.lives,
    label: S.strings.livesLabel,
    pid: S.last.victim,
  }),
  patch({ el, S, local, send, watch, now }) {
    const mine = S.holder === S.me,
      alive = (S.lives[S.me] || 0) > 0;
    const open = S.phase === "pass" && mine && alive && !watch && !S.preparing;
    if (local.turn !== S.passNo) {
      local.turn = S.passNo;
      local.text = "";
      el.querySelector(".b4-input").value = "";
    }
    el.querySelector(".b4-input").disabled = !open;
    const holder = el.querySelector(".hp-holder");
    setHtml(
      holder,
      S.phase === "reveal"
        ? `${faceHtml(S, S.last.victim, { name: true })} lost a life`
        : `${faceHtml(S, S.holder, { name: true })} has the potato`,
    );
    el.querySelector(".hp-potato").classList.toggle(
      "is-pop",
      S.phase === "reveal",
    );
    const recent = S.history.at(-1),
      challenge = S.challenges.find((e) => e.id === recent?.id);
    setHtml(
      el.querySelector(".hp-last"),
      recent
        ? `${faceHtml(S, recent.author)} <strong>${esc(recent.answer)}</strong><small class="tb-reason">${recent.bounced ? "Sent back" : challenge && now < challenge.until ? `${challenge.votes} / ${challenge.needed} say Nope` : "Answer passed"}</small>`
        : '<strong>No answers yet</strong><small class="tb-reason">The holder starts the chain.</small>',
    );
    const button = el.querySelector(".hp-nope");
    const canChallenge = (entry) =>
      entry &&
      !entry.bounced &&
      entry.author !== S.me &&
      !entry.myNope &&
      now < entry.until &&
      S.phase === "pass" &&
      alive &&
      !watch &&
      !S.preparing;
    button.disabled = !canChallenge(challenge);
    button.style.visibility =
      canChallenge(challenge) || challenge?.myNope ? "visible" : "hidden";
    button.textContent = challenge?.myNope ? "Voted" : S.strings.nope;
    button.onclick = () => {
      if (!button.disabled) send({ nope: challenge.id });
    };
    const older = S.challenges
      .filter(
        (e) =>
          e.id !== recent?.id &&
          !e.bounced &&
          e.author !== S.me &&
          now < e.until,
      )
      .slice(-3);
    setHtml(
      el.querySelector(".hp-older"),
      older
        .map(
          (e) =>
            `<button class="tb-btn tb-chip" type="button" data-nope="${e.id}"${canChallenge(e) ? "" : " disabled"}><span>${esc(e.answer)}</span><span class="tb-reason">${e.myNope ? "Voted" : S.strings.nope} · ${e.votes}/${e.needed}</span></button>`,
        )
        .join("") ||
        `<span class="hp-challenge-hint">${esc(S.strings.challengeHint)}</span>`,
    );
    for (const b of el.querySelectorAll("[data-nope]"))
      b.onclick = () => {
        if (!b.disabled) send({ nope: Number(b.dataset.nope) });
      };
    const valid =
      [...local.text.trim()].length >= 2 &&
      /^[\p{L}\p{M}\p{N} '\u2019-]+$/u.test(local.text.trim());
    const duplicate = S.usedAnswers.includes(
      local.text
        .normalize("NFKC")
        .toLocaleLowerCase("en")
        .replace(/\s+/gu, " ")
        .trim(),
    );
    return {
      title: S.phase === "reveal" ? S.strings.reveal : S.category,
      button: S.strings.pass,
      ready:
        open &&
        valid &&
        !duplicate &&
        !/(.)\1{7}/u.test(local.text) &&
        !/(?:https?|www)/iu.test(local.text),
      status: watch
        ? S.strings.watch
        : !alive
          ? S.strings.eliminated
          : S.phase === "reveal"
            ? S.strings.revealStatus
            : open
              ? duplicate
                ? "That answer was used. Try a fresh one."
                : S.strings.fresh
              : S.strings.waiting,
    };
  },
  submit({ S, local, send }) {
    send({ answer: local.text, pass: S.passNo });
  },
});
