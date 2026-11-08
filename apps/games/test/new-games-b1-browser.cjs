"use strict";
/* Real production practice rooms, real seat inputs and WebSocket state.
 * Run with Playwright available (NODE_PATH may point to an existing install).
 * Evidence goes to a task-owned temp folder, never a production service. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium, webkit } = require("playwright");
const { IDS } = require("./new-games-b1-harness");
const root = path.resolve(__dirname, "..");
const artifacts =
  process.env.B1_ARTIFACTS ||
  fs.mkdtempSync(path.join(os.tmpdir(), "giggle-b1-browser-"));
fs.mkdirSync(artifacts, { recursive: true });
const rows = [];
const dialTargets = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let scratch;
let server,
  browser,
  port,
  logs = "";
const selected = process.env.B1_GAMES?.split(",") || IDS;
const framesFor = (page) =>
  page
    .frames()
    .filter((f) => {
      try {
        return (
          new URL(f.url()).searchParams.has("practice") &&
          new URL(f.url()).searchParams.has("seat")
        );
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        Number(new URL(a.url()).searchParams.get("seat")) -
        Number(new URL(b.url()).searchParams.get("seat")),
    );
async function state(frame) {
  return frame.evaluate(() => window.__b1State);
}
async function settle(frame) {
  await frame.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function geometry(frame) {
  await settle(frame);
  return frame.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      const r = node.getBoundingClientRect();
      if (!node.getClientRects().length)
        return { x: 0, y: 0, width: 0, height: 0 };
      return {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    };
    return {
      viewportHeight: innerHeight,
      status: box(".round-status"),
      input: document.querySelector("[data-input]")
        ? box("[data-input]")
        : null,
      hud: box(".party-hud"),
      primary: box(".round-primary"),
      scores: box(".pl-live"),
      field: box(".round-play"),
      who: document.querySelector(".who-match")
        ? [".who-notes", ".who-match", ".who-names", ".who-count"].map(box)
        : null,
      rows: [...document.querySelectorAll(".pl-seat")].map((node) => {
        const r = node.getBoundingClientRect();
        return {
          x: r.x + scrollX,
          y: r.y + scrollY,
          width: r.width,
          height: r.height,
        };
      }),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      clipped: [
        ...document.querySelectorAll(".round-play,.who-names,.who-note"),
      ].some(
        (node) =>
          node.scrollHeight > node.clientHeight + 2 &&
          getComputedStyle(node).overflowY !== "visible",
      ),
      scoreDebug: [...document.querySelectorAll(".pl-seat")].map((node) => ({
        outer: node.getBoundingClientRect().toJSON(),
        points: node
          .querySelector(".pl-points")
          .getBoundingClientRect()
          .toJSON(),
        gain: node.querySelector(".pl-gain").getBoundingClientRect().toJSON(),
      })),
      scoreContentFits: [...document.querySelectorAll(".pl-seat")].every(
        (node) => {
          const outer = node.getBoundingClientRect();
          return [...node.querySelectorAll(".pl-points,.pl-gain")].every(
            (child) => {
              const r = child.getBoundingClientRect();
              return (
                r.left >= outer.left &&
                r.right <= outer.right + 1 &&
                r.bottom <= outer.bottom + 1
              );
            },
          );
        },
      ),
      controls: [
        ...document.querySelectorAll(
          ".party-round button,.party-round input,.party-round textarea",
        ),
      ]
        .filter((node) => node.getClientRects().length)
        .map((node) => ({
          label: node.textContent || node.getAttribute("aria-label"),
          h: node.getBoundingClientRect().height,
        })),
    };
  });
}
function sameBoxes(before, after, label, samePhase = true) {
  assert(!after.overflow, label + " horizontal overflow");
  assert(!after.clipped, label + " clipped playfield");
  assert(
    after.scoreContentFits,
    label +
      " score/gain text leaves its card " +
      JSON.stringify(after.scoreDebug),
  );
  // Content grows between phases; updates within a phase must never move controls or scores.
  for (const slot of samePhase
    ? ["hud", "primary", "scores", "field"]
    : ["hud"]) {
    for (const key of ["x", "y", "width", "height"])
      assert(
        Math.abs(before[slot][key] - after[slot][key]) <= 1,
        `${label} ${slot}.${key} moved: ${before[slot][key]} -> ${after[slot][key]} ` +
          JSON.stringify({
            before: {
              field: before.field,
              who: before.who,
              status: before.status,
              input: before.input,
              primary: before.primary,
            },
            after: {
              field: after.field,
              who: after.who,
              status: after.status,
              input: after.input,
              primary: after.primary,
            },
          }),
      );
  }
  if (samePhase)
    for (let i = 0; i < before.rows.length; i++) {
      for (const key of ["x", "y", "width", "height"])
        assert(
          Math.abs(before.rows[i][key] - after.rows[i][key]) <= 1,
          `${label} scoreboard row ${i} moved`,
        );
    }
  assert(
    after.controls.every((control) => control.h >= 43),
    label +
      " tap target under 44px: " +
      JSON.stringify(after.controls.filter((control) => control.h < 43)),
  );
  if (after.primary.height) {
    assert(after.primary.height >= 55, label + " primary under 56px");
    assert(
      after.primary.y >= -1 &&
        after.primary.y + after.primary.height <= after.viewportHeight + 1,
      label +
        " primary below the first viewport: " +
        JSON.stringify({
          button: after.primary,
          viewportHeight: after.viewportHeight,
        }),
    );
  }
}
async function chooseSeat(page, frame) {
  await page
    .locator("#practiceTab" + new URL(frame.url()).searchParams.get("seat"))
    .click();
}
async function playCase(id, viewport, theme) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "reduce",
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
    deviceScaleFactor: 1,
  });
  await context.addInitScript((theme) => {
    // The practice launcher writes Player N while it creates each iframe.
    // Seed named identities there, before the real clients join the server.
    const storeValue = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      const match = String(value).match(/^Player ([1-4])$/);
      if (String(key).endsWith("pb_name") && match)
        value = ["Asha", "Bo", "Charlie", "Dev"][Number(match[1]) - 1];
      return storeValue.call(this, key, value);
    };
    localStorage.setItem("pb_theme", theme);
    const params = new URL(location.href).searchParams;
    const session = params.get("practice"),
      seat = params.get("seat");
    if (session && seat) {
      const name = ["Asha", "Bo", "Charlie", "Dev"][Number(seat) - 1];
      sessionStorage.setItem(
        "practice:" + session + ":seat" + seat + ":pb_name",
        name,
      );
      params.set("name", name);
      history.replaceState(null, "", location.pathname + "?" + params);
    }
    const Native = WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (e) => {
          try {
            const m = JSON.parse(e.data);
            if (m.t === "state") window.__b1State = m;
          } catch {}
        });
      }
    };
  }, theme);
  const page = await context.newPage(),
    errors = [],
    expectedCoverErrors = [];
  const missingCovers = IDS.filter(
    (game) =>
      !fs.existsSync(path.join(root, "public/img/games", game + ".png")) &&
      !fs.existsSync(path.join(root, "public/img/games", game + ".webp")),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url || "";
    if (
      /Failed to load resource.*404/.test(m.text()) &&
      missingCovers.some(
        (game) =>
          url.endsWith("/img/games/" + game + ".png") ||
          url.endsWith("/img/games/" + game + ".webp"),
      )
    )
      expectedCoverErrors.push(url);
    else errors.push(m.text());
  });
  const prefix = `${id}-${viewport.width}-${theme}`;
  const result = {
    id,
    viewport,
    theme,
    engine: process.env.B1_ENGINE || "chromium",
    phases: [],
    geometryChecks: 0,
  };
  try {
    await page.goto(`http://127.0.0.1:${port}/practice/?game=${id}`);
    await page.waitForFunction(
      () => !document.getElementById("practiceStart").disabled,
    );
    await page.evaluate(() => {
      const n = document.getElementById("practiceCount");
      n.value = "4";
      n.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("practiceSetup").requestSubmit();
    });
    await page.waitForFunction(
      () =>
        document
          .getElementById("practiceStatus")
          .textContent.startsWith("4 seats ready"),
      null,
      { timeout: 25000 },
    );
    const frames = framesFor(page);
    assert.equal(frames.length, 4);
    const host = frames[0];
    await host.locator("#howtoCustom").click();
    await host.locator("#df-" + id + "-rounds").evaluate((input) => {
      input.value = "2";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await host.locator("#dlgSave").click();
    await host.locator("#dlgSave").waitFor({ state: "detached" });
    if (!(await host.locator("#howtoGo").isVisible()))
      await host
        .locator('[data-how="' + id + '"]')
        .first()
        .click();
    await host.locator("#howtoGo:not([disabled])").click();
    for (const f of frames)
      await f.waitForFunction(
        () =>
          window.__b1State &&
          !window.__b1State.preparing &&
          document.querySelector(".party-round"),
        null,
        { timeout: 20000 },
      );
    await chooseSeat(page, host);
    await page.waitForTimeout(2800);
    assert.deepEqual(
      (await state(host)).players.map((player) => player.name).sort(),
      ["Asha", "Bo", "Charlie", "Dev"].sort(),
    );
    const baseline = await geometry(host);
    assert(!baseline.overflow);
    const seen = new Set();
    let phaseBaseline = baseline,
      priorPhase = "";
    const shot = async (f) => {
      const s = await state(f),
        tag =
          s.phase +
          (["clue", "guess"].includes(s.phase)
            ? (s.me || s.you) === s.lead
              ? "-dialer"
              : "-guesser"
            : "");
      const fit = await geometry(f);
      sameBoxes(fit, fit, prefix + " " + tag + " primary visibility");
      if (fit.primary.height)
        result.primaryViewportChecks = (result.primaryViewportChecks || 0) + 1;
      if (id === "who-wrote" && s.phase === "match") {
        const layout = await f.evaluate(() => ({
          columns: getComputedStyle(
            document.querySelector(".who-notes"),
          ).gridTemplateColumns.split(" ").length,
          upright: [
            ...document.querySelectorAll(".who-note,.who-note p"),
          ].every(
            (node) =>
              getComputedStyle(node).transform === "none" &&
              getComputedStyle(node).rotate === "none",
          ),
        }));
        assert.equal(layout.columns, viewport.width < 600 ? 2 : 4);
        assert(layout.upright, "note text must remain upright");
      }
      if (seen.has(tag)) return;
      seen.add(tag);
      await f.evaluate(() => scrollTo(0, 0));
      await settle(f);
      await page.screenshot({
        path: path.join(artifacts, prefix + "-" + tag + ".png"),
        fullPage: true,
      });
      const scrollMax = await f.evaluate(
        () => document.documentElement.scrollHeight - innerHeight,
      );
      for (
        let offset = 600, index = 1;
        offset < scrollMax + 600;
        offset += 600, index++
      ) {
        await f.evaluate((y) => scrollTo(0, y), Math.min(offset, scrollMax));
        await settle(f);
        await page.screenshot({
          path: path.join(
            artifacts,
            prefix + "-" + tag + "-scroll" + index + ".png",
          ),
          fullPage: true,
        });
      }
      await f.evaluate(() => scrollTo(0, 0));
      result.phases.push(tag);
    };
    let rounds = 0;
    while (rounds++ < 40) {
      const S = await state(host);
      if (S.phase === "done") break;
      const phaseKey = S.round + ":" + S.phase;
      if (phaseKey !== priorPhase) {
        phaseBaseline = await geometry(host);
        priorPhase = phaseKey;
      }
      sameBoxes(
        baseline,
        await geometry(host),
        prefix + " round " + S.round + " " + S.phase,
        false,
      );
      result.geometryChecks++;
      await shot(host);
      if (id === "dial-in") {
        const total =
          S.phase === "clue"
            ? 1
            : S.players.filter(
                (p) => !S.gone?.includes(p.id) && p.id !== S.lead,
              ).length;
        assert.equal(
          await host.locator(".gk-hud-progress").textContent(),
          `${S.acted?.length || 0} / ${total} locked`,
        );
      }
      if (S.phase === "reveal") {
        if (id === "who-wrote") {
          await host.waitForFunction(
            () => window.__b1State.revealIndex >= 4,
            null,
            { timeout: 10000 },
          );
          sameBoxes(
            phaseBaseline,
            await geometry(host),
            prefix + " author reveal",
          );
          result.geometryChecks++;
          await page.screenshot({
            path: path.join(artifacts, prefix + "-authors-open.png"),
            fullPage: true,
          });
        }
        if (viewport.width === 1280 && theme === "day" && !result.motion) {
          const selectors = {
            "dial-in": ".dial-wedge-enter",
            ballpark: ".ballpark-truth",
            "think-alike": ".think-pile.is-biggest",
            "who-wrote": ".who-flip .who-assigned .pl-voter",
            "know-me": ".knowme-option.is-correct",
          };
          const target = host.locator(selectors[id]).first();
          assert.equal(
            await target.evaluate(
              (node) => getComputedStyle(node).animationName,
            ),
            "none",
          );
          await page.emulateMedia({ reducedMotion: "no-preference" });
          const motion = await target.evaluate((node) => {
            const animation = node.getAnimations()[0];
            return {
              name: getComputedStyle(node).animationName,
              properties: [
                ...new Set(
                  animation.effect
                    .getKeyframes()
                    .flatMap((keyframe) => Object.keys(keyframe))
                    .filter(
                      (key) =>
                        ![
                          "offset",
                          "computedOffset",
                          "easing",
                          "composite",
                        ].includes(key),
                    ),
                ),
              ],
            };
          });
          assert.notEqual(motion.name, "none");
          assert(
            motion.properties.every((property) =>
              ["transform", "opacity"].includes(property),
            ),
          );
          await page.emulateMedia({ reducedMotion: "reduce" });
          assert.equal(
            await target.evaluate(
              (node) => getComputedStyle(node).animationName,
            ),
            "none",
          );
          result.motion = { ...motion, reducedMotionSafe: true };
        }
        await chooseSeat(page, host);
        await host.locator(".round-primary").click();
        await host.waitForFunction(
          (r) =>
            window.__b1State.round !== r || window.__b1State.phase === "done",
          S.round,
        );
        continue;
      }
      const oldPhase = S.phase,
        oldRound = S.round;
      if (id === "who-wrote" && oldPhase === "match")
        assert.equal(
          await host.locator(".round-primary").textContent(),
          "Lock matches",
          "writing a note must not label an unfinished match grid locked",
        );
      for (const f of frames) {
        const v = await state(f);
        if (v.phase !== oldPhase || v.round !== oldRound) break;
        const me = v.me || v.you;
        if (
          id === "dial-in" &&
          ((v.phase === "clue" && me !== v.lead) ||
            (v.phase === "guess" && me === v.lead))
        )
          continue;
        await chooseSeat(page, f);
        await shot(f);
        if (id === "dial-in") {
          if (v.phase === "clue")
            await f
              .getByLabel("Clue", { exact: true })
              .fill("A friendly kettle");
          else {
            const slider = f.getByRole("slider");
            await slider.focus();
            await slider.press("Home");
            await slider.press("ArrowRight");
            assert.equal(await slider.inputValue(), "1");
            await slider.fill(
              String(
                [18, 42, 65, 87][
                  Number(new URL(f.url()).searchParams.get("seat")) - 1
                ],
              ),
            );
          }
        } else if (id === "ballpark")
          await f
            .getByLabel("Your number", { exact: true })
            .fill(
              String(
                [18, 42, 65, 87][
                  Number(new URL(f.url()).searchParams.get("seat")) - 1
                ],
              ),
            );
        else if (id === "think-alike")
          await f
            .getByLabel("Your answer", { exact: true })
            .fill(
              oldRound === 1
                ? "The apples"
                : ["Apple", "Banana", "Pear", "Grape"][
                    Number(new URL(f.url()).searchParams.get("seat")) - 1
                  ],
            );
        else if (id === "who-wrote") {
          if (v.phase === "write")
            await f
              .getByLabel("Your note", { exact: true })
              .fill(
                oldRound === 1
                  ? "I enjoy walks and puzzles. Seat " +
                      new URL(f.url()).searchParams.get("seat")
                  : (
                      "I would bring a tiny telescope, a notebook, and homemade snacks on a long train ride. I like finding funny shapes in clouds and making up names for them. " +
                      new URL(f.url()).searchParams.get("seat")
                    ).slice(0, 160),
              );
          else {
            if (oldRound === 2) {
              const selectedNote = f.locator(
                '[data-note][aria-pressed="true"]',
              );
              await selectedNote.click();
              await f.locator(".who-reader[open]").waitFor();
              assert(
                (await f.locator(".who-reader p").textContent()).length > 100,
              );
              await f
                .getByRole("button", { name: "Close note", exact: true })
                .click();
            }
            for (let i = 0; i < v.notes.filter((n) => !n.mine).length; i++)
              await f.locator("[data-author]:not([disabled])").first().click();
          }
        } else if (id === "know-me") await f.locator('[data-pick="1"]').click();
        // The composer survives other seats' snapshots; counts must not move it.
        if (
          f === host &&
          ["ballpark", "think-alike", "who-wrote"].includes(id) &&
          oldPhase !== "match"
        ) {
          const input = f.locator("[data-input]");
          const old = await input.inputValue();
          await input.focus();
          await input.evaluate((n) => {
            n.dataset.b1Kept = "yes";
          });
          await settle(f);
          assert.equal(await input.inputValue(), old);
          assert.equal(await input.getAttribute("data-b1-kept"), "yes");
        }
        await f.locator(".round-primary:not([disabled])").click();
        await f.waitForFunction(
          ({ phase, round, me }) => {
            const s = window.__b1State;
            return (
              s.phase !== phase ||
              s.round !== round ||
              s.acted.includes(me) ||
              s.clue
            );
          },
          { phase: oldPhase, round: oldRound, me },
        );
        await chooseSeat(page, host);
        if ((await state(host)).phase !== "done") {
          sameBoxes(
            phaseBaseline,
            await geometry(host),
            prefix + " count/score change",
            (await state(host)).phase === oldPhase &&
              (await state(host)).round === oldRound,
          );
          result.geometryChecks++;
        }
      }
      await host.waitForFunction(
        ({ phase, round }) =>
          window.__b1State.phase !== phase || window.__b1State.round !== round,
        { phase: oldPhase, round: oldRound },
        { timeout: 10000 },
      );
    }
    await chooseSeat(page, host);
    assert.equal((await state(host)).phase, "done");
    await host.locator(".gk-final").waitFor();
    const rematchFit = await host
      .getByRole("button", { name: "Rematch", exact: true })
      .evaluate((node) => {
        const r = node.getBoundingClientRect();
        return {
          bottom: r.bottom + scrollY,
          top: r.top + scrollY,
          height: innerHeight,
        };
      });
    assert(
      rematchFit.top >= -1 && rematchFit.bottom <= rematchFit.height + 1,
      prefix +
        " final Rematch below first viewport " +
        JSON.stringify(rematchFit),
    );
    result.primaryViewportChecks = (result.primaryViewportChecks || 0) + 1;
    await page.screenshot({
      path: path.join(artifacts, prefix + "-done.png"),
      fullPage: true,
    });
    assert.equal(
      await host.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    // A same-game rematch proves module caches/listeners were reset.
    await host.getByRole("button", { name: "Rematch", exact: true }).click();
    await host.waitForFunction(
      () =>
        window.__b1State.phase !== "done" &&
        !window.__b1State.preparing &&
        document.querySelector(".round-primary"),
      null,
      { timeout: 20000 },
    );
    assert.equal(await host.locator(".party-round").count(), 1);
    result.rematch = true;
    await page.locator("#practiceStop").click();
    await page.waitForFunction(
      () =>
        document.getElementById("practiceStatus").textContent ===
        "Practice ended",
    );
    assert.deepEqual(errors, []);
    result.errors = errors;
    result.expectedMissingCovers = [
      ...new Set(expectedCoverErrors.map((url) => new URL(url).pathname)),
    ];
    result.passed = true;
    rows.push(result);
    console.log(JSON.stringify(result));
  } catch (e) {
    const debugFrame = framesFor(page)[0];
    if (debugFrame)
      await debugFrame
        .evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
        .catch(() => {});
    result.passed = false;
    result.error = e.stack;
    result.errors = errors;
    rows.push(result);
    await page
      .screenshot({
        path: path.join(artifacts, prefix + "-FAILED.png"),
        fullPage: true,
      })
      .catch(() => {});
    console.error(JSON.stringify(result));
    throw e;
  } finally {
    await context.close();
  }
}
async function checkDialTargets() {
  for (const theme of ["day", "night"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.goto(`http://127.0.0.1:${port}/games/dial-in/`);
      for (const sheet of [
        "style",
        "game-ui",
        "skins",
        "party-scenes",
        "party-round",
        "dial-in",
      ])
        await page.addStyleTag({
          url: `http://127.0.0.1:${port}/css/${sheet}.css`,
        });
      await page.evaluate(async (theme) => {
        document.documentElement.dataset.theme = theme;
        document.body.dataset.game = "dial-in";
        document.body.innerHTML = '<main id="gbody"></main>';
        await document.fonts.ready;
      }, theme);
      for (const target of [0, 2, 50, 98, 100]) {
        const geometry = await page.evaluate(async (target) => {
          const view = (await import("/js/games/dial-in.js")).default;
          const S = {
            instanceId: "target-fixture",
            me: "a",
            hostId: "a",
            lead: "a",
            phase: "reveal",
            round: 1,
            rounds: 2,
            players: [
              { id: "a", name: "Asha" },
              { id: "b", name: "Bo" },
              { id: "c", name: "Charlie" },
              { id: "d", name: "Dev" },
            ],
            scores: {},
            acted: ["b", "c", "d"],
            spectrum: ["Freezing", "Boiling"],
            clue: "A friendly kettle",
            last: { target, guesses: { b: 18, c: 50, d: 87 }, pts: {} },
          };
          view.render(document.querySelector("#gbody"), S, {
            send() {},
            now: () => Date.now(),
            announce() {},
          });
          const band = document.querySelector(".dial-wedge"),
            marker = document.querySelector(".dial-target-marker");
          const fill = getComputedStyle(band).fill;
          const stroke = getComputedStyle(band).stroke;
          const box = band.getBBox();
          const circle = marker.querySelector("circle").getBoundingClientRect();
          const dial = document
            .querySelector(".dial-face")
            .getBoundingClientRect();
          return {
            target,
            path: band.getAttribute("d"),
            fill,
            stroke,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
            markerInside:
              circle.left >= dial.left &&
              circle.right <= dial.right &&
              circle.top >= dial.top &&
              circle.bottom <= dial.bottom,
          };
        }, target);
        assert.equal(geometry.stroke, "rgb(255, 255, 255)");
        const channels = geometry.fill.match(/[\d.]+/g).map(Number);
        assert(
          Math.max(...channels.slice(0, 3)) > 150,
          "target must be bright, not the dark card fill",
        );
        assert(
          geometry.box.width > 0 &&
            geometry.box.height > 0 &&
            geometry.box.y >= 6.9 &&
            geometry.box.y + geometry.box.height <= 158.1,
        );
        assert(
          geometry.markerInside,
          "bullseye must stay within the dial at endpoints",
        );
        await page.locator(".dial-machine").screenshot({
          path: path.join(artifacts, `dial-target-${target}-${theme}.png`),
        });
        dialTargets.push({ ...geometry, theme, passed: true });
      }
    } finally {
      await context.close();
    }
  }
  console.log(
    "B1_DIAL_TARGET_BROWSER_PASS: 10 bright bands and bullseyes at 0, 2, 50, 98, 100 in Day and Night",
  );
}
(async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-b1-server-"));
  server = spawn(process.execPath, ["server/server.js"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: os.tmpdir(),
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
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
  browser = await (
    process.env.B1_ENGINE === "webkit" ? webkit : chromium
  ).launch({ headless: true });
  const sizes = process.env.B1_WIDTH
    ? [
        {
          width: Number(process.env.B1_WIDTH),
          height: Number(process.env.B1_WIDTH) < 600 ? 844 : 800,
        },
      ]
    : [
        { width: 390, height: 844 },
        { width: 1280, height: 800 },
      ];
  for (const size of process.env.B1_TARGETS_ONLY ? [] : sizes)
    for (const theme of process.env.B1_THEME
      ? [process.env.B1_THEME]
      : ["day", "night"])
      for (const id of selected) await playCase(id, size, theme);
  if (!process.env.B1_GAMES || selected.includes("dial-in"))
    await checkDialTargets();
  console.log(
    "NEW_GAMES_B1_BROWSER_PASS: " +
      rows.length +
      " full practice games; primary inside first viewport in every phase; stable HUD and update geometry; upright note previews; no overflow; rematches",
  );
})()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.writeFileSync(
      path.join(artifacts, "results.json"),
      JSON.stringify({ rows, dialTargets, artifacts }, null, 2),
    );
    console.log("B1_ARTIFACTS " + artifacts);
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => server.once("exit", r)),
        wait(2000),
      ]);
    }
    if (scratch && (!server || server.exitCode !== null))
      fs.rmSync(scratch, { recursive: true, force: true });
  });
