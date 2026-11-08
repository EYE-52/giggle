"use strict";
/* Real practice launcher, production WS rooms and physical mouse/touch
 * gestures. No fake server clock, state writes or direct action injection.
 * B6_PLAYWRIGHT can name an existing Playwright installation on Mini. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require(process.env.B6_PLAYWRIGHT || "playwright");
const IDS = [
  "dice-fibs",
  "sketchy-impostor",
  "draw-off",
  "block-stack",
  "penalty-kicks",
];
const root = path.resolve(__dirname, "..");
const artifacts =
  process.env.B6_ARTIFACTS || path.join(root, "artifacts", "b6");
fs.mkdirSync(artifacts, { recursive: true });
const rows = [];
let server,
  browser,
  port,
  logs = "",
  scratch;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const framesFor = (page) =>
  page
    .frames()
    .filter((f) => /[?&]practice=/.test(f.url()) && /[?&]seat=/.test(f.url()))
    .sort(
      (a, b) =>
        Number(new URL(a.url()).searchParams.get("seat")) -
        Number(new URL(b.url()).searchParams.get("seat")),
    );
const state = (f) => f.evaluate(() => window.__b6State);
async function select(page, frame) {
  await page
    .locator("#practiceTab" + new URL(frame.url()).searchParams.get("seat"))
    .click();
  await frame.evaluate(() => scrollTo(0, 0));
  await frame.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
async function geometry(f) {
  await f.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return f.evaluate(() => {
    const box = (selector) => {
      const n = document.querySelector(selector),
        r = n.getBoundingClientRect();
      return {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    };
    const controls = [
      ...document.querySelectorAll(".b6-world button,.b6-world input"),
    ].filter((n) => n.getClientRects().length);
    return {
      hud: box(".party-hud"),
      primary: box(".b6-primary"),
      scores: box(".pl-live"),
      field: box(".b6-field"),
      meta: {
        zoom: document.querySelector("#gbody").style.zoom,
        font: document.fonts.status,
        tools: box(".b6-tools"),
        prompt: box(".b6-prompt"),
        status: box(".b6-status"),
      },
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      artFits: [
        ...document.querySelectorAll(".df-bid-sticker,.df-cups,.df-hand"),
      ].every((n) => {
        const stage = n.closest(".b6-stage");
        const a = stage.getBoundingClientRect(),
          b = n.getBoundingClientRect();
        const zoom =
          parseFloat(document.querySelector("#gbody").style.zoom) || 1;
        const rim =
          parseFloat(getComputedStyle(stage).borderTopWidth) * zoom + 4;
        return b.top >= a.top + rim && b.bottom <= a.bottom - rim;
      }),
      toolsFit: [...document.querySelectorAll(".do-tools .b6-scroll")].every(
        (n) => n.scrollWidth <= n.clientWidth + 1,
      ),
      viewport: innerHeight,
      overlaps: [
        ...document.querySelectorAll(
          "#roomMenu > summary,#bGameScreenToggle,.game-report-icon",
        ),
      ]
        .filter(
          (n) =>
            n.getClientRects().length &&
            getComputedStyle(n).visibility !== "hidden",
        )
        .flatMap((n) => {
          const a = n.getBoundingClientRect();
          return [
            ...document.querySelectorAll(
              ".b6-prompt,.b6-stage,.b6-tools,.b6-actions,.pl-live,.party-hud",
            ),
          ]
            .filter((c) => {
              const b = c.getBoundingClientRect();
              return (
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
              );
            })
            .map((c) => [n.className, c.className]);
        }),
      overflowDetails: [...document.querySelectorAll(".b6-world,.b6-world *")]
        .map((n) => ({
          cls: n.className,
          r: n.getBoundingClientRect().toJSON(),
        }))
        .filter((n) => n.r.right > innerWidth + 1)
        .slice(0, 12),
      controls: controls.map((n) => ({
        label: n.getAttribute("aria-label") || n.textContent,
        h: n.getBoundingClientRect().height,
      })),
      fits: [...document.querySelectorAll(".pl-seat")].every((n) => {
        const b = n.getBoundingClientRect();
        return [...n.querySelectorAll(".pl-points,.pl-gain")].every((c) => {
          const r = c.getBoundingClientRect();
          return (
            r.left >= b.left - 1 &&
            r.right <= b.right + 1 &&
            r.bottom <= b.bottom + 1 &&
            c.scrollWidth <= c.clientWidth + 1
          );
        });
      }),
    };
  });
}
function compare(a, b, label) {
  assert(
    !b.overflow,
    label + ": sideways overflow " + JSON.stringify(b.overflowDetails),
  );
  assert(b.fits, label + ": score text leaves its card");
  assert(b.artFits, label + ": dice content touches its stage rim");
  assert(b.toolsFit, label + ": drawing tools are clipped");
  assert.equal(
    b.overlaps.length,
    0,
    label + ": floating control covers content " + JSON.stringify(b.overlaps),
  );
  assert(
    b.scores.y + b.scores.height <= b.viewport + 1,
    label + ": player row below first screen " + JSON.stringify(b),
  );
  for (const slot of ["hud", "primary", "scores", "field"])
    for (const key of ["x", "y", "width", "height"]) {
      assert(
        Math.abs(a[slot][key] - b[slot][key]) <= 1,
        `${label}: ${slot}.${key} moved ${a[slot][key]} → ${b[slot][key]} ${JSON.stringify({ a, b })}`,
      );
    }
  assert(
    b.controls.every((c) => c.h >= 43),
    label + ": short tap target " + JSON.stringify(b.controls),
  );
  assert(
    b.primary.y + b.primary.height <= b.viewport + 1,
    label + ": primary below first screen " + JSON.stringify(b),
  );
}
async function draw(page, frame) {
  await select(page, frame);
  const canvas = frame.locator("canvas").first();
  const b = await canvas.boundingBox();
  const before = await state(frame);
  await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.35, b.y + b.height * 0.25, {
    steps: 6,
  });
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, {
    steps: 6,
  });
  await page.mouse.move(b.x + b.width * 0.82, b.y + b.height * 0.35, {
    steps: 6,
  });
  await page.mouse.up();
  await frame.waitForFunction(
    ({ id, turnNo }) => {
      const S = window.__b6State;
      const strokes = S.strokes || [];
      return (
        (S.game === "sketchy-impostor" && S.turnNo !== turnNo) ||
        strokes.some((s) => {
          const xs = s.pts.map((p) => p[0]);
          return Math.max(...xs) - Math.min(...xs) > 0.5;
        })
      );
    },
    { id: before.game, turnNo: before.turnNo },
    { timeout: 3000 },
  );
}
async function primary(f) {
  await f.locator(".b6-primary:not([disabled])").click();
}
async function play(id, viewport, theme, forced2D = false) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: process.env.B6_MOTION === "1" ? "no-preference" : "reduce",
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });
  await context.addInitScript(
    ({ theme, forced2D }) => {
      const originalStore = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        const match = String(value).match(/^Player ([1-4])$/);
        if (String(key).endsWith("pb_name") && match)
          value = ["Asha", "Bo", "Cam", "Dev"][Number(match[1]) - 1];
        return originalStore.call(this, key, value);
      };
      localStorage.setItem("pb_theme", theme);
      const Native = WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", (e) => {
            try {
              const m = JSON.parse(e.data);
              if (m.t === "state") {
                m.me = m.you;
                window.__b6State = m;
              }
            } catch {}
          });
        }
      };
      const params = new URL(location.href).searchParams;
      if (params.has("practice") && params.has("seat")) {
        const seat = Number(params.get("seat")),
          name = ["Asha", "Bo", "Cam", "Dev"][seat - 1];
        sessionStorage.setItem(
          `practice:${params.get("practice")}:seat${seat}:pb_name`,
          name,
        );
        params.set("name", name);
        if (forced2D) params.set("nowebgl", "1");
        history.replaceState(null, "", location.pathname + "?" + params);
      }
    },
    { theme, forced2D },
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const row = { id, viewport, theme, forced2D, phases: [], geometryChecks: 0 };
  const prefix = `${id}-${viewport.width}-${theme}${forced2D ? "-2d" : ""}`;
  try {
    await page.goto(`http://127.0.0.1:${port}/practice/?game=${id}`);
    await page.waitForFunction(
      () => !document.querySelector("#practiceStart").disabled,
    );
    const seats = id === "penalty-kicks" ? 2 : 4;
    await page.evaluate((seats) => {
      const n = document.querySelector("#practiceCount");
      n.value = String(seats);
      n.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("#practiceSetup").requestSubmit();
    }, seats);
    await page.waitForFunction(
      (seats) =>
        document
          .querySelector("#practiceStatus")
          .textContent.startsWith(seats + " seats ready"),
      seats,
    );
    const frames = framesFor(page),
      host = frames[0];
    assert.equal(frames.length, seats);
    await host.locator("#howtoCustom").click();
    await host.locator("#df-" + id + "-pace").evaluate((n) => {
      n.value = "Relaxed";
      n.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (await host.locator("#df-" + id + "-rounds").count())
      await host.locator("#df-" + id + "-rounds").evaluate((n) => {
        n.value = "1";
        n.dispatchEvent(new Event("input", { bubbles: true }));
        n.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await host.locator("#dlgSave").click();
    await host.locator("#dlgSave").waitFor({ state: "detached" });
    if (!(await host.locator("#howtoGo").isVisible()))
      await host.locator(`[data-how="${id}"]`).first().click();
    for (const f of frames)
      await f.evaluate(async (id) => {
        const view = (await import("/js/games/" + id + ".js")).default;
        const render = view.render;
        view.render = (el, S, api) => {
          const wrapped = {
            ...api,
            toolkit: {
              ...api.toolkit,
              createThreeView: async (mount, hooks) => {
                const create =
                  api.toolkit?.createThreeView ||
                  (await import("/js/renderers/three-view.js")).createThreeView;
                const handle = await create(mount, hooks);
                window.__b6Scene = handle;
                return handle;
              },
            },
          };
          window.__b6Api = wrapped;
          return render(el, S, wrapped);
        };
      }, id);
    await host.locator("#howtoGo:not([disabled])").click();
    for (const f of frames)
      await f.waitForFunction(
        () =>
          window.__b6State &&
          !window.__b6State.preparing &&
          document.querySelector(".b6-world"),
      );
    if (id === "block-stack") {
      await host.waitForFunction(() =>
        document.activeElement?.classList.contains("bs-sky"),
      );
      assert.equal((await state(host)).phase, "countdown");
      await host.locator(".bs-countdown").waitFor({ state: "visible" });
      await page.screenshot({
        path: path.join(artifacts, prefix + "-countdown.png"),
        clip: await (await host.frameElement()).boundingBox(),
      });
      for (const key of ["Space", "Enter"]) await page.keyboard.press(key);
      const beforeStart = await state(host);
      assert.equal(beforeStart.phase, "countdown");
      assert.equal(beforeStart.towers[beforeStart.me].height, 0);
      assert.equal(beforeStart.towers[beforeStart.me].out, false);
      assert.equal(await host.locator(".b6-primary").isDisabled(), true);
      await host.waitForFunction(
        () => window.__b6State.phase === "stack" && !window.__b6State.preparing,
      );
      await host.locator(".bs-countdown").waitFor({ state: "hidden" });
      row.countdownIgnoredKeys = ["Space", "Enter"];
    }
    if (id !== "block-stack") await select(page, host);
    await host.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3300);
    if (["block-stack", "penalty-kicks"].includes(id)) {
      await host
        .locator(".b6-flat")
        .waitFor({ state: forced2D ? "visible" : "hidden" });
      assert.equal(
        await host.locator("[data-retry]").isVisible(),
        forced2D,
        prefix + ": recovery controls only appear after WebGL fails",
      );
      if (id === "penalty-kicks") {
        const pitch = await host.locator(".pk6-pitch").boundingBox();
        assert(
          pitch.height >= (viewport.width < 600 ? 220 : 315),
          prefix + ": hero pitch is too short",
        );
        const zones = await host
          .locator("[data-zone]")
          .evaluateAll((nodes) =>
            nodes.map((n) => n.getBoundingClientRect().toJSON()),
          );
        assert(
          zones.slice(0, 3).every((b) => Math.abs(b.y - zones[0].y) < 1) &&
            zones.slice(3).every((b) => Math.abs(b.y - zones[3].y) < 1) &&
            zones[3].y > zones[0].y,
          prefix + ": goal zones must be two rows of three",
        );
      }
    }
    if (id === "block-stack") {
      assert(
        await host.evaluate(() =>
          document.activeElement?.classList.contains("bs-sky"),
        ),
        prefix +
          ": playfield owns focus at start, before any page click " +
          JSON.stringify(
            await host.evaluate(() => ({
              active: document.activeElement?.outerHTML.slice(0, 400),
              focus: document.hasFocus(),
              parentActive:
                window.parent.document.activeElement.outerHTML.slice(0, 300),
              frame: window.frameElement.outerHTML.slice(0, 300),
              frameParent: window.frameElement.parentElement.outerHTML.slice(
                0,
                300,
              ),
              field: document.querySelector(".bs-sky")?.outerHTML.slice(0, 250),
            })),
          ),
      );
      await page.screenshot({
        path: path.join(artifacts, prefix + "-stack-start.png"),
        clip: await (await host.frameElement()).boundingBox(),
      });
      row.initialCameraY = forced2D
        ? null
        : await host.evaluate(() => window.__b6Scene.camera.position.y);
      for (const [level, key] of [
        [0, "Space"],
        [1, "Enter"],
      ]) {
        await host.waitForFunction(
          (level) => {
            const S = window.__b6State,
              t = S.towers[S.me];
            return (
              t.height === level &&
              Math.abs(
                4.5 *
                  Math.sin(
                    Math.max(0, (window.__b6Api.now() - t.startedAt) / 1000) *
                      t.speed -
                      (t.height === 0 ? 0 : Math.PI / 2),
                  ),
              ) < 0.04
            );
          },
          level,
          { polling: "raf", timeout: 15000 },
        );
        await page.keyboard.press(key);
        await host.waitForFunction(
          (level) =>
            window.__b6State.towers[window.__b6State.me].height > level,
          level,
          { timeout: 5000 },
        );
        if (process.env.B6_MOTION === "1" && !forced2D && level === 0) {
          await host.waitForFunction(
            () => !!window.__b6Scene.scene.getObjectByName("bs-own-top"),
          );
          const firstY = await host.evaluate(
            () =>
              window.__b6Scene.scene.getObjectByName("bs-own-top").position.y,
          );
          await page.waitForTimeout(160);
          const nextY = await host.evaluate(
            () =>
              window.__b6Scene.scene.getObjectByName("bs-own-top").position.y,
          );
          assert(
            nextY < firstY - 0.08,
            prefix + ": landed block did not settle",
          );
          row.landingSettles = true;
        }
        const t = (await state(host)).towers[(await state(host)).me];
        if (t.perfect) {
          await host
            .locator(".bs-perfect")
            .waitFor({ state: "visible", timeout: 500 });
          row.perfectBurst = true;
          await page.screenshot({
            path: path.join(artifacts, prefix + "-perfect.png"),
            clip: await (await host.frameElement()).boundingBox(),
          });
        }
      }
      row.keyboardStart = ["Space", "Enter"];
      for (const type of ["input", "textarea", "div"]) {
        await host.evaluate((type) => {
          const input = document.createElement(type);
          input.id = "b6-focus-test";
          if (type === "div") input.contentEditable = "true";
          document.body.append(input);
          input.focus();
        }, type);
        const before = (await state(host)).towers[(await state(host)).me]
          .height;
        await page.keyboard.press("Space");
        await page.keyboard.press("Enter");
        await host.evaluate(async () => {
          const S = window.__b6State,
            view = (await import("/js/games/block-stack.js")).default;
          view.render(document.querySelector("#gbody"), S, window.__b6Api);
        });
        assert(
          await host.evaluate(
            () => document.activeElement?.id === "b6-focus-test",
          ),
          prefix + ": text focus was stolen",
        );
        assert.equal(
          (await state(host)).towers[(await state(host)).me].height,
          before,
          prefix + ": typing caused a drop",
        );
        await host.evaluate(() =>
          document.querySelector("#b6-focus-test").remove(),
        );
      }
      row.textFocusProtected = 3;
      await host.locator(".bs-sky").focus();
    }
    const baseline = await geometry(host);
    compare(baseline, baseline, prefix);
    row.baseline = baseline;
    const initialInstance = (await state(host)).instanceId;
    const seen = new Set();
    let capturedInk = false;
    async function captureInk(frame) {
      if (capturedInk) return;
      const live = await state(frame);
      if (live.phase !== "draw") return;
      if (live.game === "sketchy-impostor")
        frame =
          frames.find((_, i) => live.players[i]?.id === live.turnPid) || frame;
      await select(page, frame);
      await page.screenshot({
        path: path.join(artifacts, prefix + "-draw.png"),
        clip: await (await frame.frameElement()).boundingBox(),
      });
      capturedInk = true;
    }
    async function inspect(f) {
      await select(page, f);
      const S = await state(f);
      if (S.phase === "done") return;
      const g = await geometry(f);
      compare(baseline, g, prefix + " " + S.phase);
      row.geometryChecks++;
      // Explicit score/count update stress using a cloned *view* only. It
      // cannot change Room authority or feed the legal gameplay below.
      await f.evaluate(async () => {
        const S = structuredClone(window.__b6State),
          view = (await import("/js/games/" + S.game + ".js")).default;
        const el = document.querySelector("#gbody");
        const api = window.__b6Api;
        S.scores = Object.fromEntries(S.players.map((p) => [p.id, 9999]));
        view.render(el, S, api);
      });
      const stress = await geometry(f);
      compare(g, stress, prefix + " score update");
      row.geometryChecks++;
      await f.evaluate(async () => {
        const S = window.__b6State,
          view = (await import("/js/games/" + S.game + ".js")).default;
        view.render(document.querySelector("#gbody"), S, window.__b6Api);
      });
      if (["sketchy-impostor", "draw-off"].includes(id) && S.phase !== "draw") {
        const ink = await f
          .locator("canvas")
          .first()
          .evaluate((canvas) => {
            const ctx = canvas.getContext("2d");
            const pixels = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let left = canvas.width,
              right = 0,
              top = canvas.height,
              bottom = 0;
            for (let y = 0; y < canvas.height; y++)
              for (let x = 0; x < canvas.width; x++) {
                const i = 4 * (y * canvas.width + x);
                if (
                  pixels[i] < 235 ||
                  pixels[i + 1] < 235 ||
                  pixels[i + 2] < 235
                ) {
                  left = Math.min(left, x);
                  right = Math.max(right, x);
                  top = Math.min(top, y);
                  bottom = Math.max(bottom, y);
                }
              }
            return {
              x: (right - left) / canvas.width,
              y: (bottom - top) / canvas.height,
            };
          });
        assert(
          ink.x > 0.5 && ink.y > 0.2,
          prefix + ": saved drawing must remain visible " + JSON.stringify(ink),
        );
        row.inkChecks = (row.inkChecks || 0) + 1;
      }
      if (!seen.has(S.phase)) {
        if (
          id === "penalty-kicks" &&
          S.phase === "reveal" &&
          process.env.B6_MOTION === "1" &&
          !forced2D
        ) {
          const first = await f.evaluate(() =>
            window.__b6Scene.scene
              .getObjectByName("pk6-ball")
              .position.toArray(),
          );
          await page.waitForTimeout(500);
          const next = await f.evaluate(() =>
            window.__b6Scene.scene
              .getObjectByName("pk6-ball")
              .position.toArray(),
          );
          assert(
            Math.hypot(...next.map((n, i) => n - first[i])) > 0.2,
            prefix + ": kick did not animate",
          );
          row.kickAnimates = true;
          await page.waitForTimeout(1000);
        }
        seen.add(S.phase);
        row.phases.push(S.phase);
        const clip = await (await f.frameElement()).boundingBox();
        await page.screenshot({
          path: path.join(
            artifacts,
            prefix +
              "-" +
              S.phase +
              (S.phase === "draw" || S.phase === "stack" ? "-start" : "") +
              ".png",
          ),
          clip,
        });
      }
    }
    // Inspect once per phase. Later actions also compare normal snapshots.
    let priorPhase = "";
    for (let guard = 0; guard < 260; guard++) {
      const S = await state(host);
      if (S.phase === "done") break;
      if (S.phase !== priorPhase) {
        await inspect(host);
        priorPhase = S.phase;
      }
      const fresh = await state(host);
      if (
        fresh.phase !== S.phase ||
        fresh.round !== S.round ||
        fresh.turnNo !== S.turnNo ||
        fresh.kick !== S.kick
      )
        continue;
      if (S.phase === "reveal") {
        const leader = frames.find(
          (_, i) => fresh.players[i]?.id === fresh.hostId,
        );
        assert(leader, "elected host has a practice seat");
        await select(page, leader);
        if ((await state(leader)).phase !== "reveal") continue;
        await leader
          .locator(".b6-primary:not([disabled])")
          .click({ timeout: 2000 });
        continue;
      }
      if (id === "dice-fibs") {
        const turn = frames.find((_, i) => S.players[i]?.id === S.turnPid);
        await select(page, turn);
        const live = await state(turn);
        if (live.phase !== "bid" || live.turnPid !== live.me) continue;
        try {
          await turn
            .locator(
              live.bid
                ? "[data-liar]:not([disabled])"
                : ".b6-primary:not([disabled])",
            )
            .click({ timeout: 2000 });
        } catch (error) {
          const after = await state(turn);
          if (after.phase !== live.phase || after.turnNo !== live.turnNo)
            continue;
          throw error;
        }
      } else if (id === "sketchy-impostor") {
        if (S.phase === "draw") {
          const turn = frames.find((_, i) => S.players[i]?.id === S.turnPid);
          await draw(page, turn);
          await captureInk(turn);
        } else if (S.phase === "vote") {
          const views = await Promise.all(frames.map(state));
          const imp = views.find((v) => v.role === "impostor").me;
          for (const f of frames) {
            const v = await state(f);
            if (v.phase !== "vote" || v.myVote) continue;
            await select(page, f);
            const target =
              v.me === imp ? v.players.find((p) => p.id !== imp).id : imp;
            await f.locator(`[data-vote="${target}"]`).click();
            await primary(f);
          }
        } else if (S.phase === "guess") {
          const f = frames.find((_, i) => S.players[i]?.id === S.impostor);
          await select(page, f);
          await f.locator(".si-guess").fill("a wrong guess");
          await primary(f);
        }
      } else if (id === "draw-off") {
        if (S.phase === "draw")
          for (const f of frames) {
            const v = await state(f);
            if (v.phase !== "draw" || v.myReady) continue;
            await draw(page, f);
            await captureInk(f);
            await primary(f);
          }
        else
          for (const f of frames) {
            let v = await state(f);
            if (v.phase !== "vote" || v.myVote) continue;
            await select(page, f);
            if (v.gallery[0]?.mine) await f.locator("[data-next]").click();
            await primary(f);
          }
      } else if (id === "block-stack") {
        for (const f of frames) {
          const v = await state(f),
            t = v.towers[v.me];
          if (v.phase !== "stack" || t.out) continue;
          await select(page, f);
          await f.waitForFunction(
            () => {
              const S = window.__b6State,
                t = S.towers[S.me];
              const delta = Math.abs(
                4.5 *
                  Math.sin(
                    Math.max(0, (window.__b6Api.now() - t.startedAt) / 1000) *
                      t.speed -
                      (t.height === 0 ? 0 : Math.PI / 2),
                  ),
              );
              return t.height < (S.me === S.hostId ? 4 : 2)
                ? delta < 0.06
                : delta > Math.max(t.width, t.depth) + 0.15;
            },
            null,
            { polling: "raf", timeout: 10000 },
          );
          await primary(f);
          await f.waitForFunction(
            (level) => {
              const S = window.__b6State,
                t = S.towers[S.me];
              return S.phase !== "stack" || t.out || t.height > level;
            },
            t.height,
            { timeout: 5000 },
          );
          const after = await state(f),
            tower = after.towers[after.me];
          if (
            after.me === after.hostId &&
            after.phase === "stack" &&
            tower.height >= 4 &&
            !tower.out &&
            !row.heroCaptured
          ) {
            await page.waitForTimeout(300);
            await page.screenshot({
              path: path.join(artifacts, prefix + "-stack.png"),
              clip: await (await f.frameElement()).boundingBox(),
            });
            if (!forced2D) {
              row.raisedCameraY = await f.evaluate(
                () => window.__b6Scene.camera.position.y,
              );
              assert(
                row.raisedCameraY > row.initialCameraY + 0.4,
                prefix + ": camera did not rise with the towers",
              );
              const platformWidth = await f.evaluate(() => {
                const h = window.__b6Scene,
                  T = h.three,
                  platform = h.scene.getObjectByName("bs-own-platform");
                platform.updateWorldMatrix(true, true);
                h.camera.updateMatrixWorld();
                const box = new T.Box3().setFromObject(platform),
                  xs = [];
                for (const x of [box.min.x, box.max.x])
                  for (const y of [box.min.y, box.max.y])
                    for (const z of [box.min.z, box.max.z])
                      xs.push(new T.Vector3(x, y, z).project(h.camera).x);
                return (
                  ((Math.max(...xs) - Math.min(...xs)) *
                    h.canvas.getBoundingClientRect().width) /
                  2
                );
              });
              assert(
                platformWidth > 85,
                prefix + ": own tower platform is too distant " + platformWidth,
              );
              row.ownPlatformPixels = platformWidth;
            }
            row.heroCaptured = true;
          }
        }
      } else {
        const shooter = frames.find((_, i) => S.players[i]?.id === S.shooter),
          keeper = frames.find((_, i) => S.players[i]?.id === S.keeper);
        for (const [f, zone] of [
          [shooter, 3],
          [keeper, S.shooter === S.players[0].id ? 2 : 3],
        ]) {
          const v = await state(f);
          if (v.phase !== "pick" || v.myChoice) continue;
          await select(page, f);
          await f.locator(`[data-zone="${zone}"]`).click();
          if (f === shooter) await f.locator('[data-power="hard"]').click();
          await primary(f);
        }
      }
      await page.waitForTimeout(50);
      const after = await state(host);
      if (after.phase !== "done") {
        await select(page, host);
        compare(
          baseline,
          await geometry(host),
          prefix + " normal " + after.phase,
        );
        row.geometryChecks++;
      }
    }
    await host.waitForFunction(() => window.__b6State.phase === "done", null, {
      timeout: 12000,
    });
    row.scores = (await state(host)).scores;
    assert(
      Object.values(row.scores).some((n) => n > 0),
      prefix + ": full match earned points",
    );
    await select(page, host);
    await page.screenshot({
      path: path.join(artifacts, prefix + "-done.png"),
      clip: await (await host.frameElement()).boundingBox(),
    });
    await host.getByRole("button", { name: "Rematch", exact: true }).click();
    await host.waitForFunction(
      (old) =>
        window.__b6State.instanceId !== old &&
        !window.__b6State.preparing &&
        document.querySelector(".b6-world"),
      initialInstance,
    );
    assert.equal(await host.locator(".b6-world").count(), 1);
    if (["block-stack", "penalty-kicks"].includes(id)) {
      assert.equal(await host.locator(".b6-flat").count(), 1);
      await page.waitForTimeout(500);
      row.renderMode = (await host.locator(".b6-flat").isVisible())
        ? "2d"
        : "3d";
      if (forced2D) assert.equal(row.renderMode, "2d");
      else
        assert.equal(
          row.renderMode,
          "3d",
          prefix + ": normal WebGL path must draw a frame",
        );
      if (!forced2D) {
        await host.evaluate(() => {
          const canvas = document.querySelector('canvas[data-gl="three"]');
          const gl = canvas.getContext("webgl2");
          gl.getExtension("WEBGL_lose_context").loseContext();
        });
        await host.locator(".b6-flat").waitFor({ state: "visible" });
        await host.locator("[data-retry]").waitFor({ state: "visible" });
        await host.locator("[data-retry]").click();
        await host.locator(".b6-flat").waitFor({ state: "hidden" });
        assert.equal(await host.locator('canvas[data-gl="three"]').count(), 1);
        assert.equal(await host.locator("[data-retry]").isVisible(), false);
        row.contextRecovery = true;
      }
      for (let i = 0; i < Number(process.env.B6_RESTARTS || 0); i++) {
        const previous = (await state(host)).instanceId;
        await host.locator("#roomMenu > summary").click();
        await host.locator("#bLobby").click();
        await host.locator("#bEndConfirm").click();
        await host.waitForFunction(() => window.__b6State.phase === "done");
        await host
          .getByRole("button", { name: "Rematch", exact: true })
          .click();
        await host.waitForFunction(
          (old) =>
            window.__b6State.instanceId !== old &&
            !window.__b6State.preparing &&
            document.querySelector(".b6-world"),
          previous,
        );
        await host
          .locator(".b6-flat")
          .waitFor({ state: forced2D ? "visible" : "hidden" });
        assert.equal(await host.locator(".b6-world").count(), 1);
        assert.equal(
          await host.locator('canvas[data-gl="three"]').count(),
          forced2D ? 0 : 1,
        );
      }
      row.extraRestarts = Number(process.env.B6_RESTARTS || 0);
    }
    await page.locator("#practiceStop").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#practiceStatus").textContent ===
        "Practice ended",
    );
    assert.deepEqual(errors, []);
    row.passed = true;
    row.errors = errors;
    rows.push(row);
    console.log(JSON.stringify(row));
  } catch (e) {
    row.debug = await Promise.all(
      framesFor(page).map((f) =>
        f
          .evaluate(() => ({
            S: window.__b6State,
            primary: document.querySelector(".b6-primary")?.outerHTML,
            status: document.querySelector(".b6-status")?.textContent,
          }))
          .catch(() => null),
      ),
    );
    row.passed = false;
    row.error = e.stack;
    row.errors = errors;
    rows.push(row);
    await page
      .screenshot({
        path: path.join(artifacts, prefix + "-FAILED.png"),
        fullPage: true,
      })
      .catch(() => {});
    console.error(JSON.stringify(row));
    throw e;
  } finally {
    await context.close();
  }
}
(async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-b6-server-"));
  server = spawn(process.execPath, ["server/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      GAME_REPORT_DB: path.join(scratch, "reports.sqlite"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (s) => (logs += s));
  server.stderr.on("data", (s) => (logs += s));
  for (let i = 0; i < 200 && !logs.includes("PartyBox on"); i++) {
    if (server.exitCode !== null) throw Error(logs);
    await wait(50);
  }
  assert(logs.includes("PartyBox on"), logs);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.B6_CHROMIUM
      ? { executablePath: process.env.B6_CHROMIUM }
      : {}),
  });
  const sizes = process.env.B6_WIDTH
    ? [
        {
          width: Number(process.env.B6_WIDTH),
          height: Number(process.env.B6_WIDTH) < 600 ? 844 : 800,
        },
      ]
    : [
        { width: 390, height: 844 },
        { width: 1280, height: 800 },
      ];
  for (const viewport of sizes)
    for (const theme of process.env.B6_THEME
      ? [process.env.B6_THEME]
      : ["day", "night"])
      for (const id of process.env.B6_GAMES?.split(",") || IDS)
        await play(id, viewport, theme, process.env.B6_2D === "1");
  if (!process.env.B6_GAMES && !process.env.B6_2D)
    for (const id of ["block-stack", "penalty-kicks"])
      await play(id, { width: 390, height: 844 }, "night", true);
  console.log(
    `NEW_GAMES_B6_BROWSER_PASS: ${rows.length} full practice matches, stable HUD/primary/scores across phases, no overflow, real seat inputs and clean rematches`,
  );
})()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.writeFileSync(
      path.join(artifacts, "results.json"),
      JSON.stringify({ rows, logs }, null, 2),
    );
    console.log("B6_ARTIFACTS " + artifacts);
    await browser?.close();
    if (server?.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => server.once("exit", r)),
        wait(2000),
      ]);
    }
    if (scratch && server?.exitCode !== null)
      fs.rmSync(scratch, { recursive: true, force: true });
  });
