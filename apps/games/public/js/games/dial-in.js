import { esc, nameOf } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound, activePlayers, setHtml } from "./party-round-kit.js";

function point(value, radius = 132) {
  const angle = (value / 100) * Math.PI;
  return [180 - radius * Math.cos(angle), 158 - radius * Math.sin(angle)];
}

function arc(from, to) {
  const a = point(from);
  const b = point(to);
  return `M${a[0]} ${a[1]} A132 132 0 0 1 ${b[0]} ${b[1]}`;
}

// The scoring band is target ±4, clipped to the playable semicircle.
// Trace the outer arc forward and the inner arc backward to close the annulus.
function targetBand(target) {
  const start = Math.max(0, target - 4);
  const end = Math.min(100, target + 4);
  const outerStart = point(start, 151);
  const outerEnd = point(end, 151);
  const innerEnd = point(end, 113);
  const innerStart = point(start, 113);
  return {
    start,
    end,
    marker: point(target),
    path: `M${outerStart.join(" ")} A151 151 0 0 1 ${outerEnd.join(" ")} L${innerEnd.join(" ")} A113 113 0 0 0 ${innerStart.join(" ")} Z`,
  };
}

function needle(value, seat = -1) {
  const [x, y] = point(value, 111);
  return `<line class="dial-needle ${seat >= 0 ? "pl-c" + (seat % 5) : "dial-own"}" x1="180" y1="158" x2="${x}" y2="${y}"/>`;
}

function mayGuess(S, watching) {
  return (
    !watching &&
    !S.preparing &&
    S.phase === "guess" &&
    S.me !== S.lead &&
    S.myGuess == null
  );
}

export default partyRound({
  id: "dial-in",
  prefix: "dial",
  name: "Dial In",
  field(S) {
    return `<div class="dial-machine"><span class="dial-brand">TUNE INTO THEIR MIND</span>
      <div class="dial-instrument"><svg class="dial-face" viewBox="0 0 360 184" role="img" aria-label="Spectrum dial">
        <path class="dial-rim" d="${arc(0, 100)}"/>
        ${["sun", "melon", "teal", "sky", "sun"].map((color, i) => `<path class="dial-band" style="stroke:var(--${color})" d="${arc(i * 20, (i + 1) * 20)}"/>`).join("")}
        <g class="dial-target"></g><g class="dial-needles"></g><circle class="dial-hub" cx="180" cy="158" r="18"/><circle class="dial-knob" cx="180" cy="158" r="8"/>
      </svg><div class="dial-tips"></div></div>
      <div class="dial-ends"><span>${esc(S.spectrum?.[0] || "")}</span><output class="dial-value">?</output><span>${esc(S.spectrum?.[1] || "")}</span></div>
    </div>
    <div class="dial-message"><div class="dial-speech"><p class="dial-clue"></p><label class="dial-composer"><span>Your secret clue · 1–40 characters</span><input data-input maxlength="40" autocomplete="off" aria-label="Clue" placeholder="What belongs here?"></label></div>
    <label class="dial-slider-label"><span>Drag the dial or use this slider</span><input class="dial-slider picker-range" type="range" min="0" max="100" value="50" aria-label="Guess on the spectrum"></label></div>
    <div class="dial-results"></div>`;
  },
  describe({ S, local }) {
    const clue = S.phase === "clue";
    const lead = S.me === S.lead;
    const total = clue
      ? 1
      : activePlayers(S).filter((p) => p.id !== S.lead).length;
    const locked = clue ? !!S.clue : S.myGuess != null;
    return {
      title: clue
        ? "One clue. A whole spectrum."
        : S.phase === "reveal"
          ? "Were you on their wavelength?"
          : "Where does the clue belong?",
      total,
      phase: clue ? "Clue" : S.phase,
      actors: clue
        ? [S.lead]
        : activePlayers(S)
            .filter((p) => p.id !== S.lead)
            .map((p) => p.id),
      roles: { [S.lead]: lead ? "You are the Dialer" : "Dialer" },
      hideButton: clue ? !lead : S.phase === "guess" && lead,
      button: locked ? "✓ Locked in" : clue ? "Send clue" : "Lock guess",
      ready: clue
        ? lead &&
          local.text.trim().length > 0 &&
          local.text.trim().length <= 40 &&
          !locked
        : !lead && !locked,
      status: clue
        ? lead
          ? "Only you see the glowing target. Give a clue, not a number."
          : `Waiting for ${nameOf(S, S.lead)} to send a clue.`
        : lead
          ? `Your clue is out · ${S.acted?.length || 0} of ${total} guessed`
          : locked
            ? "✓ Guess locked · waiting for the others."
            : "Drag the chunky needle, then lock your guess.",
    };
  },
  submit({ S, local, send }) {
    send(
      S.phase === "clue"
        ? { clue: local.text.trim() }
        : { guess: local.selected ?? 50 },
    );
  },
  bind(ctx) {
    const svg = ctx.el.querySelector(".dial-face");
    const slider = ctx.el.querySelector(".dial-slider");
    function choose(value) {
      // Read the newest state after every snapshot; pointer listeners live for the phase.
      if (slider.disabled) return;
      ctx.local.selected = value;
      slider.value = value;
      ctx.refresh();
    }
    function move(event) {
      const box = svg.getBoundingClientRect();
      const x = ((event.clientX - box.left) * 360) / box.width;
      const y = ((event.clientY - box.top) * 184) / box.height;
      const angle = Math.atan2(Math.max(0, 158 - y), 180 - x);
      choose(Math.round(Math.max(0, Math.min(100, (angle / Math.PI) * 100))));
    }
    slider.oninput = () => choose(Number(slider.value));
    svg.onpointerdown = (event) => {
      if (slider.disabled) return;
      svg.setPointerCapture(event.pointerId);
      move(event);
    };
    svg.onpointermove = (event) => {
      if (svg.hasPointerCapture(event.pointerId)) move(event);
    };
    svg.onpointerup = svg.onpointercancel = (event) => {
      if (svg.hasPointerCapture(event.pointerId))
        svg.releasePointerCapture(event.pointerId);
    };
  },
  patch({ el, S, local, watching }) {
    const clue = S.phase === "clue";
    const reveal = S.phase === "reveal";
    const target = clue ? S.target : reveal ? S.last?.target : null;
    const value = S.myGuess ?? local.selected ?? 50;
    el.querySelector(".dial-composer").hidden = !(
      clue &&
      S.me === S.lead &&
      !watching
    );
    el.querySelector("[data-input]").disabled =
      watching || !!S.preparing || !clue;
    el.querySelector(".dial-clue").textContent = clue
      ? S.me === S.lead
        ? `Secret target · ${target}`
        : "A clue is on its way…"
      : `“${S.clue || "No clue this round"}”`;
    const slider = el.querySelector(".dial-slider");
    slider.disabled = !mayGuess(S, watching);
    el.querySelector(".dial-slider-label").hidden =
      S.phase !== "guess" || S.me === S.lead || watching;
    el.querySelector(".dial-value").textContent =
      target != null
        ? target
        : S.phase === "guess" && S.me !== S.lead && !watching
          ? value
          : "?";
    const band = target == null ? null : targetBand(target);
    const wedge = band
      ? `<path class="dial-wedge" d="${band.path}"/>
      <g class="dial-target-marker" transform="translate(${band.marker.join(" ")})" aria-label="Target ${target}"><circle r="11"/><circle class="dial-bullseye" r="4"/></g>`
      : "";
    setHtml(el.querySelector(".dial-target"), wedge);
    el.querySelector(".dial-target").classList.toggle(
      "dial-wedge-enter",
      reveal,
    );
    const guesses = Object.entries(S.last?.guesses || {});
    setHtml(
      el.querySelector(".dial-needles"),
      reveal
        ? guesses
            .map(([pid, n]) =>
              needle(
                n,
                S.players.findIndex((p) => p.id === pid),
              ),
            )
            .join("")
        : S.phase === "guess" && S.me !== S.lead && !watching
          ? needle(value)
          : "",
    );
    // Equal guesses share a fan of avatar tips, so no player disappears underneath another.
    const tipGroups = new Map();
    for (const [pid, guess] of guesses) {
      if (!tipGroups.has(guess)) tipGroups.set(guess, []);
      tipGroups.get(guess).push(pid);
    }
    setHtml(
      el.querySelector(".dial-tips"),
      reveal
        ? [...tipGroups]
            .map(([guess, players]) => {
              const [x, y] = point(guess, 111);
              return `<span class="dial-tip" style="left:${x / 3.6}%;top:${y / 1.84}%">${players.map((pid) => `<span title="${esc(nameOf(S, pid))}: ${guess}">${faceHtml(S, pid)}</span>`).join("")}</span>`;
            })
            .join("")
        : "",
    );
    setHtml(
      el.querySelector(".dial-results"),
      reveal
        ? guesses
            .map(
              ([pid, n]) =>
                `<span class="dial-result">${faceHtml(S, pid, { name: true })}<b>${n}</b><small>+${S.last.pts?.[pid] || 0}</small></span>`,
            )
            .join("")
        : "",
    );
  },
});
