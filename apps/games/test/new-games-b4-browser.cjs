"use strict";
/* Full production practice rooms, browser controls, Day/Night, 390/1280.
 * Deadlines can be advanced by a test-only server clock. Client clocks and
 * actions stay real; no game state, answers or DOM layout are injected. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { IDS } = require("./new-games-b4-harness");
const PHASE_LABELS = {
  "math-dash": { sprint: "Sprint", reveal: "Results" },
  "emoji-spotter": { spot: "Spot", reveal: "Results" },
  "echo-pads": { show: "Echo", repeat: "Echo", reveal: "Results" },
  "color-clash": { card: "Cards", reveal: "Results" },
  "hot-potato": { pass: "Pass", reveal: "Results" },
};
const root = path.resolve(__dirname, "..");
const artifacts =
  process.env.B4_ARTIFACTS || path.join(root, "artifacts", "b4", "browser");
fs.mkdirSync(artifacts, { recursive: true });
let server,
  browser,
  scratch,
  port,
  logs = "",
  seq = 0;
const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (frame) => frame.evaluate(() => window.__b4State);
const framesFor = (page) =>
  page
    .frames()
    .filter((f) => /[?&]practice=/.test(f.url()) && /[?&]seat=/.test(f.url()))
    .sort(
      (a, b) =>
        Number(new URL(a.url()).searchParams.get("seat")) -
        Number(new URL(b.url()).searchParams.get("seat")),
    );
async function advance() {
  const token = ++seq;
  await new Promise((resolve) => {
    const receive = (message) => {
      if (message.type === "b4-clock-ready" && message.seq === token) {
        server.off("message", receive);
        resolve();
      }
    };
    server.on("message", receive);
    server.send({ type: "b4-deadline", seq: token });
  });
  await wait(75);
}
async function geometry(frame) {
  await frame.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return frame.evaluate(() => {
    const box = (n) => {
      const r = n.getBoundingClientRect();
      return {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    };
    return {
      game: document.body.dataset.game,
      phase: window.__b4State.phase,
      turnKey: JSON.stringify([window.__b4State.round, window.__b4State.passNo, window.__b4State.holder]),
      phaseLabel: document.querySelector(".gk-hud-phase").textContent.trim(),
      boxes: [
        ".party-hud",
        ".b4-field",
        ".b4-action-slot",
        ".pl-live",
        ...Array.from(
          { length: document.querySelectorAll(".pl-seat").length },
          (_, i) => `.pl-seat:nth-child(${i + 1})`,
        ),
      ].map((s) => box(document.querySelector(s))),
      blockedTargets: [
        ...document.querySelectorAll(
          ".b4-stage button:not(:disabled), .b4-stage input:not(:disabled)",
        ),
      ]
        .filter(
          (n) =>
            getComputedStyle(n).visibility === "visible" &&
            n.getClientRects().length,
        )
        .filter((n) => {
          const r = n.getBoundingClientRect();
          const x = r.x + r.width / 2,
            y = r.y + r.height / 2;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
            return false;
          for (let parent = n.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), r = parent.getBoundingClientRect();
            if (/auto|scroll|hidden/.test(style.overflowY) && (y < r.top || y >= r.bottom)) return false;
          }
          const top = document.elementFromPoint(x, y);
          return top !== n && !n.contains(top);
        })
        .map((n) => n.className),
      viewportHeight: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      controls: [...document.querySelectorAll(".b4-stage button")]
        .filter((n) => n.getClientRects().length)
        .map((n) => ({ text: n.textContent, ...box(n) })),
      clipped: [...document.querySelectorAll(".b4-title,.b4-status,.b4-field")]
        .filter(
          (n) =>
            n.scrollHeight > n.clientHeight + 2 &&
            !["visible", "auto"].includes(getComputedStyle(n).overflowY),
        )
        .map((n) => n.className),
    };
  });
}
function assertPhaseLabel(screen, label) {
  const expected = PHASE_LABELS[screen.game]?.[screen.phase];
  assert(expected, `${label}: known game phase ${screen.game}/${screen.phase}`);
  assert.equal(
    screen.phaseLabel,
    expected,
    `${label}: HUD shows the game phase`,
  );
}
function stable(before, after, label) {
  assertPhaseLabel(after, label);
  assert(!after.overflow, label + " horizontal overflow");
  assert.deepEqual(after.clipped, [], label + " clipping");
  assert.deepEqual(
    after.blockedTargets,
    [],
    label + " controls covered by floating UI",
  );
  // Results and new turns may change content. Within one active turn,
  // typing and peer updates must keep every action and score slot fixed.
  const slots = before.phase === after.phase && before.turnKey === after.turnKey ? before.boxes.length : 0;
  for (let i = 0; i < slots; i++)
    for (const key of ["x", "y", "width", "height"])
      assert(
        Math.abs(before.boxes[i][key] - after.boxes[i][key]) <= 1,
        `${label}: slot ${i}.${key} moved ${before.boxes[i][key]} -> ${after.boxes[i][key]}`,
      );
  assert(
    after.controls.every((c) => c.height >= 43 && c.width >= 43),
    label +
      " small targets " +
      JSON.stringify(
        after.controls.filter((c) => c.height < 43 || c.width < 43),
      ),
  );
}
async function seat(page, frame) {
  await page
    .locator("#practiceTab" + new URL(frame.url()).searchParams.get("seat"))
    .click();
}
async function shot(page, frame, prefix, phase) {
  await seat(page, frame);
  await frame.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: path.join(artifacts, prefix + "-" + phase + ".png"),
    fullPage: true,
  });
  const max = await frame.evaluate(
    () => document.documentElement.scrollHeight - innerHeight,
  );
  if (max > 20) {
    await frame.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    await page.screenshot({
      path: path.join(artifacts, prefix + "-" + phase + "-bottom.png"),
      fullPage: true,
    });
    await frame.evaluate(() => scrollTo(0, 0));
  }
}
async function playCase(id, viewport, theme) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "reduce",
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });
  await context.addInitScript((theme) => {
    localStorage.setItem("pb_theme", theme);
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      const match = String(value).match(/^Player ([1-4])$/);
      if (String(key).endsWith("pb_name") && match)
        value = ["Asha", "Bo", "Cam", "Dev"][Number(match[1]) - 1];
      return write.call(this, key, value);
    };
    const params = new URL(location.href).searchParams;
    const session = params.get("practice"),
      seat = params.get("seat");
    if (session && seat) {
      const name = ["Asha", "Bo", "Cam", "Dev"][Number(seat) - 1];
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
        this.addEventListener("message", (event) => {
          try {
            const m = JSON.parse(event.data);
            if (m.t === "state") {
              window.__b4State = { ...m, me: m.you };
              if (m.phase === "show") {
                window.__b4Echo ||= {};
                const key = `${m.round}:${m.level}`;
                window.__b4Echo[key] ||= [];
                window.__b4Echo[key][m.showIndex] = m.activePad;
              }
            }
          } catch {}
        });
      }
    };
  }, theme);
  const page = await context.newPage(),
    errors = [],
    prefix = `${id}-${viewport.width}-${theme}`;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push(m.text() + " " + (m.location().url || ""));
  });
  const result = {
    id,
    viewport,
    theme,
    phases: [],
    checks: 0,
    clock: "production Room deadlines advanced by test IPC",
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
    const frames = framesFor(page),
      host = frames[0];
    assert.equal(frames.length, 4);
    if (id !== "hot-potato") {
      await host.locator("#howtoCustom").click();
      await host.locator("#df-" + id + "-rounds").evaluate((n) => {
        n.value = "2";
        n.dispatchEvent(new Event("input", { bubbles: true }));
        n.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await host.locator("#dlgSave").click();
      await host.locator("#dlgSave").waitFor({ state: "detached" });
    }
    if (!(await host.locator("#howtoGo").isVisible()))
      await host
        .locator('[data-how="' + id + '"]')
        .first()
        .click();
    await host.locator("#howtoGo:not([disabled])").click();
    await host.waitForFunction(
      () =>
        window.__b4State &&
        !window.__b4State.preparing &&
        document.querySelector(".b4-stage"),
      null,
      { timeout: 20000 },
    );
    await Promise.all(frames.map((frame) => frame.waitForFunction(() => window.__b4State?.you)));
    const frameByPlayer = new Map(await Promise.all(frames.map(async (frame) => [(await state(frame)).you, frame])));
    if (id === "hot-potato") {
      const watcher = await context.newPage();
      await watcher.goto(new URL(new URL(host.url()).pathname, `http://127.0.0.1:${port}`).href);
      await watcher.locator("#nm").fill("Watcher");
      await watcher.locator("#bJoin").click();
      await watcher.waitForFunction(() => window.__b4State?.spectator && document.querySelector(".b4-input"));
      assert(await watcher.locator(".b4-input").isDisabled(), "late spectator cannot type");
      assert(await watcher.locator(".b4-primary").isDisabled(), "late spectator cannot pass");
      await watcher.screenshot({ path: path.join(artifacts, prefix + "-spectator.png") });
      result.spectator = true;
      await watcher.close();
    }
    await seat(page, host);
    await wait(800);
    const baseline = await geometry(host);
    assertPhaseLabel(baseline, prefix + " initial");
    assert(!baseline.overflow);
    assert(
      baseline.boxes[2].y + baseline.boxes[2].height <=
        baseline.viewportHeight + 1,
      prefix + " primary below first screen",
    );
    const seen = new Set();
    let loops = 0,
      answeredRound = 0,
      passRound = 0;
    const remembered = new Map();
    while (loops++ < 300) {
      const S = await state(host);
      if (S.phase === "done") break;
      if (id === "hot-potato" && !result.knockoutWatching) {
        for (const frame of frames) {
          const own = await state(frame);
          if (own.phase !== "pass" || own.lives[own.you] > 0) continue;
          assert(await frame.locator(".b4-input").isDisabled(), "knocked-out seat cannot type");
          assert(await frame.locator(".b4-primary").isDisabled(), "knocked-out seat cannot pass");
          await shot(page, frame, prefix, "knocked-out");
          result.knockoutWatching = true;
          await seat(page, host);
          break;
        }
      }
      stable(baseline, await geometry(host), prefix + " " + S.phase);
      result.checks++;
      const shotTag =
        id === "emoji-spotter" && S.size === 8 ? S.phase + "-8x8" : S.phase;
      if (!seen.has(shotTag)) {
        seen.add(shotTag);
        result.phases.push(shotTag);
        await shot(page, host, prefix, shotTag);
      }
      if (S.phase === "reveal") {
        assert(
          await host.locator(".b4-result").isVisible(),
          "round result is visible",
        );
        if (!result.motion) {
          const title = host.locator(".b4-title");
          assert.equal(
            await title.evaluate((n) => getComputedStyle(n).animationName),
            "none",
          );
          await page.emulateMedia({ reducedMotion: "no-preference" });
          const motion = await title.evaluate((n) => ({
            name: getComputedStyle(n).animationName,
            properties: n
              .getAnimations()
              .flatMap((a) =>
                a.effect.getKeyframes().flatMap((k) => Object.keys(k)),
              )
              .filter(
                (k) =>
                  !["offset", "computedOffset", "easing", "composite"].includes(
                    k,
                  ),
              ),
          }));
          assert.equal(motion.name, "b4-pop");
          assert(
            motion.properties.every((k) =>
              ["transform", "opacity"].includes(k),
            ),
          );
          await page.emulateMedia({ reducedMotion: "reduce" });
          result.motion = true;
        }

        await seat(page, host);
        await host.locator(".b4-primary").click();
        await wait(120);
        continue;
      }
      if (id === "math-dash") {
        if (answeredRound !== S.round) {
          answeredRound = S.round;
          // Solve only the current visible arithmetic, using the actual pad.
          const problem = S.problem
            .replace(/×/g, "*")
            .replace(/÷/g, "/")
            .replace(/−/g, "-");
          assert(/^[0-9+*/() \-]+$/.test(problem));
          const answer = String(Function("return (" + problem + ")")());
          for (const digit of answer)
            await host
              .locator(`[data-key="${digit === "-" ? "−" : digit}"]`)
              .click();
          await host.locator(".b4-primary").click();
          await host.waitForFunction(() => window.__b4State.index === 1);
          stable(baseline, await geometry(host), prefix + " correct answer");
          result.checks++;
          // Other-seat update must preserve the input node and draft.
          await host.locator(".b4-input").fill("91");
          await host
            .locator(".b4-input")
            .evaluate((n) => (n.dataset.kept = "yes"));
          await seat(page, frames[1]);
          await frames[1].locator(".b4-input").fill("999");
          await frames[1].locator(".b4-primary").click();
          await seat(page, host);
          assert.equal(await host.locator(".b4-input").inputValue(), "91");
          assert.equal(
            await host.locator(".b4-input").getAttribute("data-kept"),
            "yes",
          );
        }
        await advance();
      } else if (id === "emoji-spotter") {
        const counts = {};
        for (const emoji of S.grid) counts[emoji] = (counts[emoji] || 0) + 1;
        const odd = S.grid.findIndex((e) => counts[e] === 1);
        // Click one wrong tile, then solve with the other three seats.
        for (let i = 0; i < frames.length; i++) {
          await seat(page, frames[i]);
          await frames[i]
            .locator(
              `[data-tile="${i === 0 ? (odd + 1) % S.grid.length : odd}"]`,
            )
            .click();
        }
        await seat(page, host);
        await wait(100);
      } else if (id === "echo-pads") {
        const memoryKey = `${S.round}:${S.level}`;
        if (S.phase === "show") {
          const list = remembered.get(memoryKey) || [];
          list[S.showIndex] = S.activePad;
          remembered.set(memoryKey, list);
          await advance();
        } else {
          const pattern = await host.evaluate(
            (key) => window.__b4Echo[key],
            memoryKey,
          );
          assert(
            pattern && pattern.length === S.length,
            "observe the full sequence before repeating",
          );
          for (let i = 0; i < frames.length; i++) {
            await seat(page, frames[i]);
            const v = await state(frames[i]);
            if (!v.alive.includes(v.me)) continue;
            const pads = S.level === 1 ? pattern : [(pattern[0] + 1) % 4];
            // A real input burst: no server acknowledgement between taps.
            await frames[i].evaluate((pads) => {
              for (const pad of pads)
                document.querySelector(`[data-pad="${pad}"]`).click();
            }, pads);
            await wait(100);
          }
          await seat(page, host);
          await wait(120);
        }
      } else if (id === "color-clash") {
        // Correct answers change live raw scores while all slots stay still.
        for (const frame of frames) {
          await seat(page, frame);
          const v = await state(frame);
          if (!v.myPick)
            await frame
              .locator(`[data-color="${v.card[v.card.mode]}"]`)
              .click();
        }
        await seat(page, host);
        stable(baseline, await geometry(host), prefix + " card scores");
        result.checks++;
        await advance();
      } else {
        if (passRound !== S.round) {
          passRound = S.round;
          const author = frameByPlayer.get(S.holder),
            authorIndex = frames.indexOf(author);
          await seat(page, author);
          const beforeTyping = await geometry(author);
          await author
            .locator(".b4-input")
            .fill(
              S.round === 2 ? "WMWMWMWMWMWMWMWMWMWMWMWMWMWMWM" : "Wooden spoon",
            );
          stable(beforeTyping, await geometry(author), prefix + " holder types on the same turn");
          result.sameTurnTyping = true;
          await author.locator(".b4-primary").click();
          await wait(100);
          let challengeSelector = ".hp-nope";
          if (S.round === 2) {
            await shot(page, author, prefix, "pass-long-answer");
            stable(baseline, await geometry(author), prefix + " long answer");
            const passed = await state(host);
            const challengeId = passed.history.at(-1).id;
            const next = frameByPlayer.get(passed.holder);
            await seat(page, next);
            const beforeRetry = await geometry(next);
            await next.locator(".b4-input").fill(passed.history.at(-1).answer);
            assert(await next.locator(".b4-primary").isDisabled(), "duplicate answer cannot pass");
            stable(beforeRetry, await geometry(next), prefix + " duplicate feedback on the same turn");
            await next.locator(".b4-input").fill("Another fresh answer");
            stable(beforeRetry, await geometry(next), prefix + " fresh draft on the same turn");
            result.sameTurnRetry = true;
            await next.locator(".b4-primary").click();
            await wait(100);
            await shot(page, next, prefix, "pass-older-answer");
            stable(
              baseline,
              await geometry(next),
              prefix + " older long answer",
            );
            assert(
              await next
                .locator(".hp-older")
                .evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
              "one earlier answer fits without sideways scrolling",
            );
            challengeSelector = `[data-nope="${challengeId}"]`;
          }
          // Two of three other seats challenge and bounce it back.
          let count = 0;
          const needed =
            Math.floor(
              (Object.values(S.lives).filter((n) => n > 0).length - 1) / 2,
            ) + 1;
          for (let i = 0; i < frames.length && count < needed; i++)
            if (i !== authorIndex && S.lives[(await state(frames[i])).you] > 0) {
              await seat(page, frames[i]);
              await frames[i].locator(challengeSelector).click();
              count++;
            }
          await wait(100);
          assert.equal((await state(host)).holder, S.holder);
          await seat(page, host);
          stable(baseline, await geometry(host), prefix + " pass and bounce");
          result.checks++;
        }
        await advance();
      }
    }
    assert.equal((await state(host)).phase, "done", prefix + " complete match");
    await seat(page, host);
    await host.locator(".gk-final").waitFor();
    await shot(page, host, prefix, "done");
    assert.deepEqual(errors, []);
    await host.getByRole("button", { name: "Rematch", exact: true }).click();
    await host.waitForFunction(
      () =>
        window.__b4State.phase !== "done" &&
        !window.__b4State.preparing &&
        document.querySelector(".b4-stage"),
      null,
      { timeout: 20000 },
    );
    assert.equal(await host.locator(".b4-stage").count(), 1);
    assertPhaseLabel(await geometry(host), prefix + " rematch");
    result.rematch = true;
    await page.locator("#practiceStop").click();
    result.passed = true;
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    result.passed = false;
    result.error = error.stack;
    result.errors = errors;
    results.push(result);
    await page
      .screenshot({
        path: path.join(artifacts, prefix + "-FAILED.png"),
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
(async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-b4-server-"));
  server = spawn(
    process.execPath,
    ["--require", "./test/new-games-b4-clock.cjs", "server/server.js"],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        GAME_REPORT_DB: path.join(scratch, "reports.sqlite"),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  server.stdout.on("data", (s) => (logs += s));
  server.stderr.on("data", (s) => (logs += s));
  for (let i = 0; i < 200 && !logs.includes("PartyBox on"); i++) {
    if (server.exitCode !== null) throw Error(logs);
    await wait(50);
  }
  assert(logs.includes("PartyBox on"), logs);
  browser = await chromium.launch({ headless: true });
  const sizes = process.env.B4_WIDTH
    ? [
        {
          width: Number(process.env.B4_WIDTH),
          height: Number(process.env.B4_HEIGHT) || (Number(process.env.B4_WIDTH) < 600 ? 844 : 800),
        },
      ]
    : [
        { width: 390, height: 844 },
        { width: 1280, height: 800 },
      ];
  for (const viewport of sizes)
    for (const theme of process.env.B4_THEME
      ? [process.env.B4_THEME]
      : ["day", "night"])
      for (const id of process.env.B4_GAMES?.split(",") || IDS)
        await playCase(id, viewport, theme);
  console.log(
    `NEW_GAMES_B4_BROWSER_PASS: ${results.length} full practice matches; stable controls and score rows within active turns; rematches; no overflow`,
  );
})()
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.writeFileSync(
      path.join(artifacts, "results.json"),
      JSON.stringify({ results, artifacts, serverLog: logs }, null, 2),
    );
    console.log("B4_ARTIFACTS " + artifacts);
    await browser?.close();
    if (server?.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((r) => server.once("exit", r));
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });
