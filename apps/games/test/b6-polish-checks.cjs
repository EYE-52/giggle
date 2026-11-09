"use strict";
// Extra scene/access checks against the real practice launcher. Spectator
// projections are view-only; all kicks below use physical button clicks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const base = process.env.B6_URL || "http://127.0.0.1:8270";
const out = path.resolve(__dirname, "../artifacts/b6-polish");
const results = [];
(async () => {
  const browser = await chromium.launch({
    channel: "chromium",
    ...(process.platform === "darwin" ? { args: ["--use-angle=metal"] } : {}),
  });
  try {
    for (const id of ["penalty-kicks", "block-stack"])
      for (const reduced of [false, true]) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          reducedMotion: reduced ? "reduce" : "no-preference",
        });
        try {
          await context.addInitScript(() => {
            localStorage.setItem("pb_theme", "night");
            const Native = WebSocket;
            window.WebSocket = class extends Native {
              constructor(...args) {
                super(...args);
                this.addEventListener("message", (e) => {
                  try {
                    const m = JSON.parse(e.data);
                    if (m.t === "state") {
                      m.me = m.you;
                      window.__polishState = m;
                    }
                  } catch {}
                });
              }
            };
          });
          const page = await context.newPage(),
            errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(`${base}/practice/?game=${id}`);
          await page.waitForFunction(
            () => !document.querySelector("#practiceStart").disabled,
          );
          await page.locator("#practiceCount").selectOption("2");
          await page.evaluate(() =>
            document.querySelector("#practiceSetup").requestSubmit(),
          );
          await page.waitForFunction(() =>
            document
              .querySelector("#practiceStatus")
              .textContent.startsWith("2 seats ready"),
          );
          const frames = page
              .frames()
              .filter((f) => /[?&]seat=/.test(f.url()))
              .sort(
                (a, b) =>
                  Number(new URL(a.url()).searchParams.get("seat")) -
                  Number(new URL(b.url()).searchParams.get("seat")),
              ),
            host = frames[0];
          await host.locator("#howtoCustom").click();
          await host.locator(`#df-${id}-pace`).evaluate((n) => {
            n.value = "Relaxed";
            n.dispatchEvent(new Event("change", { bubbles: true }));
          });
          await host.locator("#dlgSave").click();
          for (const frame of frames)
            await frame.evaluate(async (id) => {
              const view = (await import(`/js/games/${id}.js`)).default,
                render = view.render;
              window.__polishCues = [];
              view.render = (el, S, api) => {
                api = api.__polishOriginal || api;
                const wrapped = {
                  ...api,
                  __polishOriginal: api,
                  cue: (name, options) => {
                    window.__polishCues.push({ name, ...options });
                    return api.cue?.(name, options);
                  },
                  toolkit: {
                    ...api.toolkit,
                    createThreeView: async (m, h) => {
                      const handle = await api.toolkit.createThreeView(m, h);
                      window.__polishScene = handle;
                      return handle;
                    },
                  },
                };
                window.__polishApi = wrapped;
                return render(el, S, wrapped);
              };
            }, id);
          if (!(await host.locator("#howtoGo").isVisible()))
            await host.locator(`[data-how="${id}"]`).first().click();
          await host.locator("#howtoGo").click();
          await host.waitForFunction(
            () =>
              window.__polishScene?.scene && !window.__polishState.preparing,
          );
          await host.locator(".b6-flat").waitFor({ state: "hidden" });
          const row = { id, reduced };
          if (id === "penalty-kicks") {
            await host.evaluate(async () => {
              const view = (await import("/js/games/penalty-kicks.js")).default;
              view.render(
                document.querySelector("#gbody"),
                {
                  ...window.__polishState,
                  spectator: true,
                  me: "watcher",
                  role: null,
                },
                window.__polishApi,
              );
            });
            assert.equal(await host.locator("[data-zone]:disabled").count(), 6);
            assert.match(
              await host.locator(".b6-status").textContent(),
              /Watching/,
            );
            await host.evaluate(async () => {
              (await import("/js/games/penalty-kicks.js")).default.render(
                document.querySelector("#gbody"),
                window.__polishState,
                window.__polishApi,
              );
            });
            row.watcherZonesDisabled = true;
            const alignment = await host.evaluate(() => {
              const h = window.__polishScene,
                T = h.three,
                canvas = h.canvas.getBoundingClientRect(),
                r = document
                  .querySelector(".pk6-zones")
                  .getBoundingClientRect();
              h.camera.updateMatrixWorld();
              const v = new T.Vector3(-3.12, 3.12, 0).project(h.camera);
              return Math.max(
                Math.abs(r.left - (canvas.x + ((v.x + 1) * canvas.width) / 2)),
                Math.abs(r.top - (canvas.y + ((1 - v.y) * canvas.height) / 2)),
              );
            });
            assert(
              alignment < 2,
              `targets must align to the goal (${alignment}px)`,
            );
            row.targetAlignmentPixels = alignment;
          } else
            await host.waitForFunction(
              () => window.__polishState.phase === "stack",
            );
          const perf = await host.evaluate(
            () =>
              new Promise((resolve) => {
                const samples = [],
                  h = window.__polishScene,
                  k = h.scene.getObjectByName("pk6-keeper"),
                  before = k?.position.toArray();
                let previous = performance.now();
                function sample(now) {
                  samples.push(now - previous);
                  previous = now;
                  if (samples.length < 90) return requestAnimationFrame(sample);
                  samples.sort((a, b) => a - b);
                  resolve({
                    medianMs: samples[45],
                    p95Ms: samples[85],
                    calls: h.renderer.info.render.calls,
                    triangles: h.renderer.info.render.triangles,
                    keeperDistance: k
                      ? Math.hypot(
                          ...k.position.toArray().map((v, i) => v - before[i]),
                        )
                      : null,
                  });
                }
                requestAnimationFrame(sample);
              }),
          );
          row.performance = perf;
          if (reduced && id === "penalty-kicks")
            assert.equal(
              perf.keeperDistance,
              0,
              "reduced motion stops keeper idle sway",
            );
          if (id === "penalty-kicks") {
            async function kick(zone, dive) {
              for (const frame of frames) {
                const s = await frame.evaluate(() => window.__polishState);
                await page
                  .locator(
                    "#practiceTab" +
                      new URL(frame.url()).searchParams.get("seat"),
                  )
                  .click();
                await frame
                  .locator(
                    `[data-zone="${s.role === "shooter" ? zone : dive}"]`,
                  )
                  .click();
                if (s.role === "shooter")
                  await frame.locator('[data-power="hard"]').click();
                await frame.locator(".b6-primary").click();
              }
              await page.locator("#practiceTab1").click();
              await host.waitForFunction(
                () =>
                  window.__polishState.phase === "reveal" &&
                  !window.__polishState.preparing,
              );
            }
            await kick(3, 2);
            await host.waitForFunction(
              () => !document.querySelector(".pk6-banner").hidden,
            );
            await page.waitForTimeout(140);
            const goal = await host.evaluate(() => {
              const s = window.__polishScene,
                n = s.scene.getObjectByName("pk6-net"),
                p = n.geometry.attributes.position.array;
              let min = 0;
              for (let i = 2; i < p.length; i += 3) min = Math.min(min, p[i]);
              return {
                minNetZ: min,
                confetti: s.scene.children.some(
                  (n) => n.isInstancedMesh && n.count === 72 && n.visible,
                ),
                cues: window.__polishCues,
              };
            });
            assert.equal(goal.confetti, !reduced);
            if (!reduced)
              assert(goal.minNetZ < -1.02, "net must bulge on a goal");
            assert(goal.cues.some((c) => c.name === "place"));
            assert(goal.cues.some((c) => c.name === "correct"));
            assert.equal(
              new Set(goal.cues.map((c) => c.id)).size,
              goal.cues.length,
              "effects must sound once",
            );
            row.goalEffects = true;
            row.audioEvents = goal.cues;
            await host.locator(".b6-primary").click();
            await host.waitForFunction(
              () =>
                window.__polishState.phase === "pick" &&
                !window.__polishState.preparing,
            );
            await kick(4, 4);
            await host.waitForFunction(
              () => !document.querySelector(".pk6-banner").hidden,
            );
            if (!reduced)
              assert(
                await host.evaluate(
                  () =>
                    window.__polishScene.scene.getObjectByName("pk6-save-flash")
                      .visible,
                ),
                "save punch must flash",
              );
            row.saveEffects = true;
          }
          assert.deepEqual(errors, []);
          results.push(row);
          console.log(JSON.stringify(row));
        } finally {
          await context.close();
        }
      }
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(out, "scene-checks.json"),
      JSON.stringify(results, null, 2),
    );
  }
  console.log(
    "B6_POLISH_SCENES_PASS: spectator targets, goal alignment, reduced motion, net, confetti, save punch and sound events",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
