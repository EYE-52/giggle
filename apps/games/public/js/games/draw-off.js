import { nameOf } from "../util.js";
import { faceHtml } from "../kit.js";
import { batchView, html, chip, watch } from "./b6-kit.js";
import { drawingInput, paintInk } from "./b6-drawing.js";

export default batchView({
  id: "draw-off",
  prefix: "do",
  name: "Draw Off",
  family: "create",
  field: `<div class="b6-stage do-easel"><canvas width="900" height="540" tabindex="0" aria-label="Drawing canvas"></canvas><span class="do-gallery-label"></span></div><div class="b6-tools do-tools"></div>`,
  mount(c) {
    let current = c;
    const canvas = c.el.querySelector("canvas");
    const input = drawingInput(canvas, () => ({
      ...current,
      tools: true,
      enabled:
        current.S.phase === "draw" &&
        !current.S.myReady &&
        !watch(current.S) &&
        !current.S.preparing,
      color: current.local.color || "#2563eb",
      tool: current.local.tool || "pen",
      size: current.local.tool === "eraser" ? 24 : 7,
    }));
    return {
      update(S, api, context) {
        current = context;
        input.update();
        if (S.phase !== "draw")
          paintInk(canvas, S.gallery?.[current.local.gallery]?.strokes || []);
      },
      dispose() {
        input.dispose();
        current = null;
      },
    };
  },
  patch({ el, S, local, send, refresh }) {
    local.gallery = Math.max(
      0,
      Math.min(local.gallery, (S.gallery?.length || 1) - 1),
    );
    const g = S.gallery?.[local.gallery],
      reveal = S.phase === "reveal";
    el.querySelector(".do-gallery-label").textContent =
      S.phase === "draw"
        ? S.myReady
          ? "Canvas sealed"
          : "Your private canvas"
        : g
          ? `${local.gallery + 1} / ${S.gallery.length} · ${reveal ? nameOf(S, g.pid) : g.mine ? "Your drawing" : "Mystery artist"}`
          : "The gallery has no drawings this round";
    let tools;
    if (S.phase === "draw") {
      const disabled = S.myReady || watch(S) ? "disabled" : "";
      tools = `<div class="b6-scroll" role="group" aria-label="Drawing tools">${[
        ["#2563eb", "Blue"],
        ["#db2777", "Pink"],
        ["#111111", "Black"],
      ]
        .map(([color, label]) =>
          chip(
            `<span class="do-swatch" style="background:${color}"></span>`,
            `data-color="${color}" aria-label="${label} pen" aria-pressed="${(local.color || "#2563eb") === color && local.tool !== "eraser"}" ${disabled}`,
          ),
        )
        .join("")}
        ${chip("Eraser", `data-eraser aria-pressed="${local.tool === "eraser"}" ${disabled}`)}${chip("Undo", `data-undo ${disabled}`)}${chip("Clear", `data-clear ${disabled}`)}</div>`;
    } else
      tools = `<div class="do-gallery-nav">${chip("←", 'data-prev aria-label="Previous drawing"')}<span class="do-gallery-note">${g ? (reveal ? `${faceHtml(S, g.pid, { name: true })} · ${S.last?.counts?.[g.aid] || 0} votes` : g.mine ? "Your drawing · choose another to vote" : S.myVote === g.aid ? "Your vote ✓" : "Browse, then vote for this drawing") : "Draw next round to fill the gallery."}</span>${chip("→", 'data-next aria-label="Next drawing"')}</div>`;
    html(el.querySelector(".do-tools"), tools);
    for (const b of el.querySelectorAll("[data-color]"))
      b.onclick = () => {
        local.color = b.dataset.color;
        local.tool = "pen";
        refresh();
      };
    const eraser = el.querySelector("[data-eraser]");
    if (eraser)
      eraser.onclick = () => {
        local.tool = "eraser";
        refresh();
      };
    for (const type of ["undo", "clear"]) {
      const b = el.querySelector(`[data-${type}]`);
      if (b)
        b.onclick = () =>
          send({
            [type]: true,
            inkNonce: S.inkNonce,
            inkRevision: S.inkRevision,
          });
    }
    const browse = (direction) => {
      if (S.gallery?.length)
        local.gallery =
          (local.gallery + direction + S.gallery.length) % S.gallery.length;
      refresh();
    };
    const prev = el.querySelector("[data-prev]"),
      next = el.querySelector("[data-next]");
    if (prev) prev.onclick = () => browse(-1);
    if (next) next.onclick = () => browse(1);
    const status =
      S.phase === "draw"
        ? S.myReady
          ? "Your canvas is sealed. Waiting for the other artists."
          : "Draw the prompt, then press Done. Your drawing stays private."
        : reveal
          ? S.last.winners.length > 1
            ? "It’s a tie! Favourite drawings each earn 100."
            : S.last.winners.length
              ? "The room’s favourite earns 100 points."
              : "No votes this round."
          : S.myVote
            ? "Vote locked. Browse the gallery while the others choose."
            : !g
              ? "No drawings yet. The next round starts after the vote timer."
              : g.mine
                ? "This is yours. Browse to another drawing to vote."
                : "Choose your favourite. Names appear at the reveal.";
    return {
      title: S.prompt,
      phase: reveal ? "Gallery" : S.phase === "draw" ? "Draw" : "Vote",
      progress:
        S.phase === "draw"
          ? `${S.ready.length} ready`
          : `${S.voted.length} votes`,
      ready:
        S.phase === "draw"
          ? !S.myReady
          : S.phase === "vote" && !!g && !g.mine && !S.myVote,
      button: S.phase === "draw" ? "Done drawing" : "Vote for this drawing",
      status,
      acted: S.phase === "draw" ? S.ready : S.voted,
      waiting: S.phase === "draw" ? "Drawing" : "Choosing",
    };
  },
  submit({ S, local, send }) {
    send(
      S.phase === "draw"
        ? { ready: true }
        : { vote: S.gallery[local.gallery].aid },
    );
  },
});
