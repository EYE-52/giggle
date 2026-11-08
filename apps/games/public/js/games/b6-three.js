/* A task-owned scene wrapper: pinned Three helper, abortable loads, one
 * fallback loop and complete cleanup even when leaving during an import. */
export function sceneView(mount, api, build, paint) {
  let state = null,
    liveApi = api,
    handle = null,
    controller = null,
    retired = false;
  let generation = 0,
    raf = 0,
    fallback = true,
    failed = false;
  const flat = mount.querySelector(".b6-flat"),
    gl = mount.querySelector(".b6-gl");
  const field = mount.closest(".b6-field");
  const note = field.querySelector(".b6-view-note");
  const retry = field.querySelector("[data-retry]");
  const recovery = field.querySelector(".b6-recovery");
  const reason = () => {
    mount.closest(".b6-stage").dataset.renderer = failed
      ? "2d"
      : fallback
        ? "loading"
        : "3d";
    if (recovery) recovery.hidden = !failed;
    if (note) {
      note.hidden = !failed;
      note.textContent = failed ? "3D unavailable · playing in 2D" : "";
    }
    if (retry) retry.hidden = !failed;
  };
  const redraw = () => {
    if (retired) return;
    if (fallback && state) paint(flat, state, liveApi);
    raf = requestAnimationFrame(redraw);
  };
  function lose() {
    if (retired) return;
    fallback = failed = true;
    flat.hidden = false;
    gl.hidden = true;
    handle?.dispose?.();
    handle = null;
    reason();
  }
  async function start() {
    const token = ++generation;
    controller?.abort();
    handle?.dispose?.();
    handle = null;
    controller = new AbortController();
    fallback = true;
    failed = false;
    flat.hidden = false;
    gl.hidden = false;
    reason();
    const factory =
      liveApi.toolkit?.createThreeView ||
      (await import("../renderers/three-view.js")).createThreeView;
    if (retired || token !== generation) return;
    const result = await factory(gl, {
      signal: controller.signal,
      build: (T, helper) =>
        build(T, helper, () => ({ S: state, api: liveApi })),
      onContextLost: lose,
    });
    if (retired || token !== generation) {
      result.dispose?.();
      return;
    }
    if (result.fallback) {
      failed = true;
      gl.hidden = true;
      reason();
      return;
    }
    handle = result;
    try {
      await result.firstFrame;
      if (retired || token !== generation || result.disposed?.()) return;
      fallback = failed = false;
      flat.hidden = true;
      reason();
    } catch {
      lose();
    }
  }
  if (retry)
    retry.onclick = () => {
      start().catch(lose);
    };
  reason();
  raf = requestAnimationFrame(redraw);
  start().catch(lose);
  return {
    update(S, nextApi) {
      state = S;
      liveApi = nextApi;
      if (fallback) paint(flat, S, liveApi);
    },
    dispose() {
      retired = true;
      generation++;
      controller?.abort();
      handle?.dispose?.();
      handle = null;
      cancelAnimationFrame(raf);
      if (retry) retry.onclick = null;
      state = liveApi = null;
    },
  };
}

export function canvasSize(canvas) {
  const w = Math.max(1, canvas.clientWidth),
    h = Math.max(1, canvas.clientHeight);
  const dpr = Math.min(1.75, window.devicePixelRatio || 1);
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
