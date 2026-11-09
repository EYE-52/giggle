import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound } from "./party-round-kit.js";

const number = (value) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 });
function valid(S, text) {
  const value = Number(text);
  return (
    text.trim() !== "" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1e12 &&
    (S.question?.decimals || Number.isInteger(value))
  );
}

function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

function ruler(S) {
  const entries = Object.entries(S.last?.answers || {});
  const answer = S.last?.answer ?? 0;
  const values = [answer, ...entries.map(([, value]) => value)];
  const span =
    Math.max(...values) - Math.min(...values) ||
    Math.max(1, Math.abs(answer) * 0.2);
  // Round the ruler to a "nice" step (1, 2 or 5 × 10^n) and never dip below
  // zero when every value is positive, so ticks read like a real ruler.
  const step = niceStep((span * 1.3) / 4);
  const floor = Math.min(...values) >= 0 ? 0 : -Infinity;
  const low = Math.max(floor, Math.floor((Math.min(...values) - span * 0.15) / step) * step);
  const high = Math.ceil((Math.max(...values) + span * 0.15) / step) * step;
  const ticks = [];
  for (let i = 0; low + i * step <= high + step / 2; i++) ticks.push(Number((low + i * step).toPrecision(12)));
  const percent = (value) => 8 + (84 * (value - low)) / (high - low);
  const best = Math.min(
    ...entries.map(([, value]) => Math.abs(value - answer)),
  );
  return `<div class="ballpark-truth round-pop"><span>★ THE REAL NUMBER</span><strong>${esc(number(answer))}</strong><small>${esc(S.question?.unit || "")}</small></div>
    <div class="ballpark-ruler" style="--pin-count:${Math.max(1, entries.length)}" role="img" aria-label="Estimates and answer on a scaled ruler">
      <div class="ballpark-ticks">${ticks.map((t) => `<span style="left:${percent(t)}%"><i></i><small>${esc(number(t))}</small></span>`).join("")}</div>
      <span class="ballpark-star" style="left:${percent(answer)}%" title="True answer">★</span>
      ${entries.map(([pid, value], i) => `<span class="ballpark-pin ${Math.abs(value - answer) === best ? "is-closest" : ""}" style="left:${percent(value)}%;--lane:${i}">${faceHtml(S, pid)}</span>`).join("")}
    </div>
    <div class="ballpark-estimates">${entries.map(([pid, value]) => `<div class="ballpark-estimate">${faceHtml(S, pid, { name: true })}<b>${esc(number(value))}</b><small>+${S.last.pts?.[pid] || 0}</small></div>`).join("")}</div>
    <aside class="ballpark-fact"><b>Did you know?</b><p>${esc(S.last?.fact || "No estimates arrived this time.")}</p></aside>`;
}

export default partyRound({
  id: "ballpark",
  prefix: "ballpark",
  name: "Ballpark",
  field(S) {
    return S.phase === "reveal"
      ? ruler(S)
      : `<div class="ballpark-ticket"><span class="ballpark-stamp">TAKE A WILDLY EDUCATED GUESS</span><div class="ballpark-entry"><div class="picker-step ballpark-picker"><button type="button" class="picker-btn" data-estimate-step="-1" aria-label="Decrease your estimate">−</button><input class="picker-value" data-input type="number" min="-1000000000000" max="1000000000000" step="${S.question?.decimals ? "any" : "1"}" inputmode="decimal" aria-label="Your number" placeholder="?"><button type="button" class="picker-btn" data-estimate-step="1" aria-label="Increase your estimate">+</button></div><span class="ballpark-unit">${esc(S.question?.unit || "number")}</span></div><div class="ballpark-ticket-ticks" aria-hidden="true"></div><p>Closest gets 100 · Exact gets 150</p></div>`;
  },
  describe({ S, local }) {
    const locked = S.myAnswer != null;
    return {
      title: S.question?.q || "",
      button: locked ? "✓ Number locked" : "Lock number",
      ready: !locked && valid(S, local.text),
      status: locked
        ? "✓ Estimate locked · waiting for the others."
        : local.text && !valid(S, local.text)
          ? `Use ${S.question?.decimals ? "a number" : "a whole number"} between −1 trillion and 1 trillion.`
          : `${S.question?.decimals ? "Enter a number" : "Enter a whole number"} · How close can you get?`,
    };
  },
  submit({ S, local, send }) {
    if (valid(S, local.text)) send({ answer: Number(local.text) });
  },
  patch({ el, S, local, watching, refresh }) {
    const input = el.querySelector("[data-input]");
    if (!input) return;
    input.disabled = watching || S.myAnswer != null || !!S.preparing;
    for (const button of el.querySelectorAll("[data-estimate-step]")) {
      const by = Number(button.dataset.estimateStep);
      const value = input.value === "" ? null : Number(input.value);
      button.disabled = input.disabled || (value != null && (by < 0 ? value <= -1e12 : value >= 1e12));
      button.onclick = () => {
        if (button.disabled || input.disabled) return;
        const next = Number(((Number(input.value) || 0) + by).toPrecision(15));
        local.text = String(Math.max(-1e12, Math.min(1e12, next)));
        input.value = local.text;
        refresh();
      };
    }
  },
});
