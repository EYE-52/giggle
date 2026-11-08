/* Normalized Draw Phone / Doodle Guess stroke transport: live previews,
 * revision + nonce, gesture identity and overlapping chunks of <=200 points.
 * A continuous gesture can span many chunks without becoming two strokes. */
export function paintInk(canvas, strokes = [], live = null) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of [...strokes, ...(live ? [live] : [])]) {
    if (!s.pts?.length) continue;
    ctx.strokeStyle = s.tool === "eraser" ? "#ffffff" : s.color;
    ctx.lineWidth = (s.size * canvas.width) / 900;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    s.pts.forEach((p, i) =>
      ctx[i ? "lineTo" : "moveTo"](p[0] * canvas.width, p[1] * canvas.height),
    );
    ctx.stroke();
  }
}
export function drawingInput(canvas, get) {
  let token = "",
    gesture = 0,
    chunk = 0,
    sample = 0,
    held = null,
    pts = [],
    ink = null;
  let pending = [],
    previewAt = 0,
    disposed = false;
  const bound = [];
  const on = (target, event, fn) => {
    target.addEventListener(event, fn);
    bound.push([target, event, fn]);
  };
  function abandon() {
    const id = held;
    held = null;
    pts = [];
    ink = null;
    if (id !== null)
      try {
        canvas.releasePointerCapture(id);
      } catch {
        /* already released */
      }
  }
  function sync() {
    const c = get(),
      S = c.S;
    const next = [
      S.instanceId,
      S.round,
      S.turnNo || 0,
      S.inkNonce,
      S.inkRevision,
    ].join(":");
    if (next !== token) {
      abandon();
      pending = [];
      token = next;
      gesture = S.lastGestureId || 0;
    }
    gesture = Math.max(gesture, S.lastGestureId || 0);
    if (!c.enabled) abandon();
    const acknowledged = new Set(
      (S.strokes || []).map((s) => `${s.gestureId}:${s.chunk}`),
    );
    pending = pending.filter(
      (s) => !acknowledged.has(`${s.gestureId}:${s.chunk}`),
    );
    paintInk(
      canvas,
      [...(S.strokes || []), ...pending],
      pts.length
        ? { ...ink, pts: pts.length > 1 ? pts : [pts[0], pts[0]] }
        : null,
    );
    canvas.style.cursor = c.enabled ? "crosshair" : "default";
    canvas.setAttribute("aria-disabled", String(!c.enabled));
  }
  function position(e) {
    const r = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  }
  function metadata() {
    const { S } = get();
    return {
      inkNonce: S.inkNonce,
      inkRevision: S.inkRevision,
      gestureId: gesture,
      chunk,
      turnNo: S.turnNo,
    };
  }
  function commit(finished) {
    if (!pts.length) return;
    const stroke = {
      ...ink,
      pts: pts.length > 1 ? pts.map((p) => [...p]) : [pts[0], pts[0]],
    };
    pending.push({ ...stroke, gestureId: gesture, chunk });
    get().send({ ...metadata(), stroke, finished });
    chunk++;
    sample = 0;
  }
  function up(e) {
    if (held === null || (e?.pointerId !== undefined && e.pointerId !== held))
      return;
    if (get().enabled) commit(true);
    abandon();
    sync();
  }
  on(canvas, "pointerdown", (e) => {
    const c = get();
    if (
      disposed ||
      !c.enabled ||
      held !== null ||
      (e.button !== undefined && e.button !== 0) ||
      e.isPrimary === false
    )
      return;
    e.preventDefault();
    held = e.pointerId;
    gesture++;
    chunk = sample = 0;
    pts = [position(e)];
    ink = {
      color: c.color || "#2563eb",
      size: c.size || 7,
      tool: c.tool || "pen",
    };
    try {
      canvas.setPointerCapture(held);
    } catch {
      /* window release also works */
    }
    sync();
  });
  on(canvas, "pointermove", (e) => {
    if (held !== e.pointerId || !get().enabled) return;
    e.preventDefault();
    pts.push(position(e));
    if (pts.length >= 180) {
      const last = pts.at(-1);
      commit(false);
      pts = [last];
    } else if (pts.length > 1 && performance.now() - previewAt > 80) {
      get().send({
        ...metadata(),
        preview: { ...ink, pts: pts.map((p) => [...p]) },
        sample: ++sample,
      });
      previewAt = performance.now();
    }
    sync();
  });
  on(window, "pointerup", up);
  on(canvas, "pointercancel", up);
  on(canvas, "lostpointercapture", up);
  on(window, "blur", () => up());
  on(document, "visibilitychange", () => {
    if (document.hidden) up();
  });
  on(canvas, "keydown", (e) => {
    const c = get();
    if (
      c.enabled &&
      c.tools &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "z"
    ) {
      e.preventDefault();
      abandon();
      pending = [];
      c.send({
        undo: true,
        inkNonce: c.S.inkNonce,
        inkRevision: c.S.inkRevision,
      });
    }
  });
  return {
    update: sync,
    dispose() {
      disposed = true;
      abandon();
      for (const [t, e, fn] of bound) t.removeEventListener(e, fn);
      pending = [];
      token = "";
    },
  };
}
