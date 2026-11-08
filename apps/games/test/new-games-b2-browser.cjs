"use strict";
/* Real production practice rooms. All actions below use rendered controls. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { IDS, start, play } = require("./new-games-b2-harness");
// Readable, silly phrases make the screenshots useful for copy review too.
const nouns = "astronauts/aliens bears/bakers cats/cupcakes dragons/doughnuts elves/engines foxes/fairies goats/ghosts hippos/hedgehogs iguanas/inventors jellyfish/jugglers koalas/kites llamas/lizards monkeys/muffins ninjas/noodles otters/owls penguins/pirates queens/quails robots/rabbits squirrels/spoons turtles/teapots unicorns/umbrellas vampires/volcanoes witches/waffles xylophones/xerus yaks/yetis zebras/zombies".split(" ");
const verbs = "adopt borrow chase deliver enchant follow greet hug inspect juggle kidnap launch move notice outsmart paint question rescue surprise tickle untangle visit wake xerox yank zoom".split(" ");
const adjectives = "absent bouncy curious dizzy enormous fluffy grumpy hungry invisible jolly kind lazy magical noisy odd polite quiet robotic sleepy tiny unusual velvet wobbly x-ray yawning zany".split(" ");
function phrase(letters, seat = 0) {
  return letters.map((letter, i) => {
    const n = letter.charCodeAt(0) - 65;
    if (i < letters.length - 3) return adjectives[n];
    if (i === letters.length - 2) return verbs[n];
    return nouns[n].split("/")[(seat >> (i === letters.length - 1 ? 1 : 0)) & 1];
  }).join(" ");
}
const root = path.resolve(__dirname, "..");
const artifacts =
  process.env.B2_ARTIFACTS ||
  path.join(root, "artifacts/b2/browser");
fs.mkdirSync(artifacts, { recursive: true });
const results = [];
const denseResults = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server,
  browser,
  scratch,
  port,
  logs = "";
const state = async (frame) => {
  const s = await frame.evaluate(() => window.__b2State);
  return { ...s, me: s.me || s.you };
};
function framesFor(page) {
  return page
    .frames()
    .filter((f) => {
      try {
        const p = new URL(f.url()).searchParams;
        return p.has("practice") && p.has("seat");
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        Number(new URL(a.url()).searchParams.get("seat")) -
        Number(new URL(b.url()).searchParams.get("seat")),
    );
}
async function geometry(frame) {
  return frame.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    };
    const slots = {};
    for (const selector of [
      ".party-hud",
      ".b2-prompt",
      ".b2-play",
      ".b2-primary",
      ".pl-live",
    ])
      slots[selector] = box(document.querySelector(selector));
    return {
      slots,
      rows: [...document.querySelectorAll(".pl-seat")].map(box),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      primaryVisible:
        document.querySelector(".b2-primary").getBoundingClientRect().bottom <=
        innerHeight + 1,
      controls: [
        ...document.querySelectorAll(".b2-scene button,.b2-scene input"),
      ]
        .filter((n) => n.getClientRects().length)
        .map((n) => ({
          label: n.textContent || n.getAttribute("aria-label"),
          height: n.getBoundingClientRect().height,
        })),
      scoreFit: [...document.querySelectorAll(".pl-seat")].every((n) => {
        const a = n.getBoundingClientRect();
        return [...n.querySelectorAll(".pl-points,.pl-gain")].every((c) => {
          const b = c.getBoundingClientRect();
          return (
            b.right <= a.right + 1 &&
            b.left >= a.left - 1 &&
            b.bottom <= a.bottom + 1
          );
        });
      }),
      toastSafe: (() => {
        const toast = document.querySelector("#toast:not([hidden])");
        if (!toast) return true;
        const a = toast.getBoundingClientRect();
        return [...document.querySelectorAll(".party-hud,.b2-prompt,.b2-piece,.b2-scene button,.b2-scene input")]
          .filter((n) => n.getClientRects().length)
          .every((n) => {
            const r = n.getBoundingClientRect();
            // A scroll tray's off-screen choices have boxes too. Only its
            // visible part can be covered by a toast.
            const b = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(innerWidth, r.right), bottom: Math.min(innerHeight, r.bottom) };
            for (let p = n.parentElement; p; p = p.parentElement) {
              const s = getComputedStyle(p), clip = p.getBoundingClientRect();
              if (s.overflowX !== "visible") {
                b.left = Math.max(b.left, clip.left);
                b.right = Math.min(b.right, clip.right);
              }
              if (s.overflowY !== "visible") {
                b.top = Math.max(b.top, clip.top);
                b.bottom = Math.min(b.bottom, clip.bottom);
              }
            }
            if (b.right <= b.left || b.bottom <= b.top) return true;
            return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
          });
      })(),
    };
  });
}
function stable(a, b, label) {
  assert(!b.overflow, label + " sideways overflow");
  assert(b.scoreFit, label + " score text leaves its card");
  assert(b.toastSafe, label + " toast covers game content");
  assert(b.primaryVisible, label + " primary below the initial viewport");
  assert(
    b.controls.every((c) => c.height >= 43),
    label + " small controls " + JSON.stringify(b.controls),
  );
  for (const selector of Object.keys(a.slots))
    for (const key of ["x", "y", "width", "height"])
      assert(
        Math.abs(a.slots[selector][key] - b.slots[selector][key]) <= 1,
        `${label} ${selector}.${key}: ${a.slots[selector][key]} -> ${b.slots[selector][key]}`,
      );
  assert.equal(a.rows.length, b.rows.length);
  a.rows.forEach((r, i) => {
    for (const key of ["x", "y", "width", "height"])
      assert(
        Math.abs(r[key] - b.rows[i][key]) <= 1,
        label + " score row moved",
      );
  });
}
async function pick(page, frame, value) {
  await page
    .locator("#practiceTab" + new URL(frame.url()).searchParams.get("seat"))
    .click();
  await frame.locator("[data-choice]").filter({ hasText: "__never__" }).count();
  await frame.locator("[data-choice]").evaluateAll((nodes, value) => {
    const node = nodes.find((n) => n.dataset.choice === value);
    if (!node || node.disabled) throw Error("Unavailable choice: " + value);
    node.click();
  }, String(value));
  await frame.locator(".b2-primary:not([disabled])").click();
}
async function primary(page, frame) {
  await page
    .locator("#practiceTab" + new URL(frame.url()).searchParams.get("seat"))
    .click();
  await frame.locator(".b2-primary:not([disabled])").click();
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
    localStorage.setItem("pb_theme", theme);
    const Native = WebSocket;
    window.WebSocket = class extends Native {
      send(data) {
        // Name the fixture seats when they join the real production room.
        const m = JSON.parse(data), seat = /^Player (\d+)$/.exec(m.name || "");
        if (seat) m.name = ["Asha", "Bo", "Charlie", "Dev", "Eli"][Number(seat[1]) - 1];
        return super.send(JSON.stringify(m));
      }
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (e) => {
          try {
            const m = JSON.parse(e.data);
            if (m.t === "state") window.__b2State = m;
          } catch {}
        });
      }
    };
  }, theme);
  const page = await context.newPage(),
    errors = [],
    seen = new Set();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const prefix = `${id}-${viewport.width}-${theme}`,
    row = { id, viewport, theme, phases: [], checks: 0 };
  try {
    const n = id === "moonlit-village" ? 5 : 4;
    await page.goto(`http://127.0.0.1:${port}/practice/?game=${id}`);
    await page.waitForFunction(
      () => !document.getElementById("practiceStart").disabled,
    );
    await page.evaluate((n) => {
      const input = document.getElementById("practiceCount");
      input.value = String(n);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("practiceSetup").requestSubmit();
    }, n);
    await page.waitForFunction(
      (n) =>
        document
          .getElementById("practiceStatus")
          .textContent.startsWith(n + " seats ready"),
      n,
      { timeout: 25000 },
    );
    const frames = framesFor(page),
      host = frames[0];
    assert.equal(frames.length, n);
    await host.locator("#howtoCustom").click();
    if (id !== "moonlit-village")
      await host.locator("#df-" + id + "-rounds").evaluate((input) => {
        input.value = "1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await host.locator("#df-" + id + "-pace").evaluate((input) => {
      input.value = "Quick";
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
          window.__b2State &&
          !window.__b2State.preparing &&
          document.querySelector(".b2-scene"),
        null,
        { timeout: 20000 },
      );
    await page.waitForTimeout(2000);
    await page.locator("#practiceTab1").click();
    await host.evaluate(async () => (await import("/js/app.js")).toast("Your settings are saved"));
    assert((await state(host)).players.every((p) => !/^Player \d+$/.test(p.name)), "named practice seats reach the game");
    const baseline = await geometry(host);
    stable(baseline, baseline, prefix + " initial");
    const shot = async (frame) => {
      const S = await state(frame),
        tag =
          S.phase +
          (S.card?.outsider ? "-outsider" : "") +
          (S.role ? "-" + S.role : "");
      if (seen.has(tag)) return;
      seen.add(tag);
      row.phases.push(tag);
      await page
        .locator("#practiceTab" + new URL(frame.url()).searchParams.get("seat"))
        .click();
      await frame.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: path.join(artifacts, prefix + "-" + tag + ".png"),
        fullPage: true,
      });
    };
    let steps = 0;
    while (steps++ < 150) {
      let S = await state(host);
      if (S.phase === "done") break;
      await page.locator("#practiceTab1").click();
      await host.evaluate(() => scrollTo(0, 0));
      stable(baseline, await geometry(host), prefix + " " + S.phase);
      row.checks++;
      await shot(host);
      const views = await Promise.all(frames.map(state)),
        frameFor = (pid) => frames[views.findIndex((v) => v.me === pid)];
      const before = S.phase + ":" + S.turnNo;
      if (S.phase === "reveal") await primary(page, host);
      else if (id === "odd-one-out") {
        const outsider = views.find((v) => v.card?.outsider);
        await shot(frameFor(outsider.me));
        if (S.phase === "talk") {
          const f = frameFor(S.asker),
            target = views.find((v) => v.me !== S.asker).me;
          await pick(page, f, target);
          await page.locator("#practiceTab1").click();
          await host
            .getByRole("button", { name: "End talk", exact: true })
            .click();
        } else if (S.phase === "vote") {
          for (const v of views)
            if (!v.myVote)
              await pick(
                page,
                frameFor(v.me),
                v.me === outsider.me
                  ? views.find((x) => x.me !== v.me).me
                  : outsider.me,
              );
        } else {
          const place = views.find((v) => v.card?.place).card.place;
          await pick(
            page,
            frameFor(outsider.me),
            outsider.places.indexOf(place),
          );
        }
      } else if (id === "moonlit-village") {
        const wolf = views.find(
          (v) => v.role === "wolf" && v.alive.includes(v.me),
        );
        for (const v of views) if (!v.ghost) await shot(frameFor(v.me));
        if (S.phase === "night") {
          for (const v of views.filter(
            (v) =>
              ["wolf", "seer", "healer"].includes(v.role) &&
              v.alive.includes(v.me),
          )) {
            const target =
              v.role === "wolf"
                ? views.find(
                    (x) => x.role === "villager" && x.alive.includes(x.me),
                  ).me
                : wolf.me;
            await pick(page, frameFor(v.me), target);
          }
          await host.waitForFunction(
            () => window.__b2State.phase !== "night",
            null,
            { timeout: 35000 },
          );
        } else if (S.phase === "day") {
          const ghost = views.find((v) => v.ghost);
          if (ghost) await shot(frameFor(ghost.me));
          for (const v of views.filter((v) => v.alive.includes(v.me)))
            await primary(page, frameFor(v.me));
        } else if (S.phase === "vote")
          for (const v of views.filter((v) => v.alive.includes(v.me)))
            await pick(
              page,
              frameFor(v.me),
              v.me === wolf.me
                ? views.find((x) => x.role !== "wolf" && x.alive.includes(x.me))
                    .me
                : wolf.me,
            );
      } else if (id === "undercover") {
        if (S.phase === "clue") {
          const frame = frameFor(S.turnPid),
            word = "Clue" + String.fromCharCode(97 + steps);
          await page
            .locator(
              "#practiceTab" + new URL(frame.url()).searchParams.get("seat"),
            )
            .click();
          await frame.locator("[data-input]").fill(word);
          await frame.locator("[data-input]").evaluate((n) => {
            n.dataset.kept = "yes";
          });
          await frame.locator("[data-input]").press("End");
          assert.equal(
            await frame.locator("[data-input]").getAttribute("data-kept"),
            "yes",
          );
          await primary(page, frame);
        } else {
          const counts = {};
          for (const v of views) counts[v.word] = (counts[v.word] || 0) + 1;
          const rare = Object.keys(counts).sort(
              (a, b) => counts[a] - counts[b],
            )[0],
            target = views.find((v) => v.word === rare).me;
          for (const v of views.filter((v) => v.alive.includes(v.me)))
            await pick(
              page,
              frameFor(v.me),
              v.me === target ? views.find((x) => x.me !== target).me : target,
            );
        }
      } else if (id === "backronyms") {
        if (S.phase === "write")
          for (const [i, frame] of frames.entries()) {
            await page.locator("#practiceTab" + (i + 1)).click();
            await frame.locator("[data-input]").fill(phrase(S.letters, i));
            await primary(page, frame);
          }
        else
          for (const v of views)
            await pick(page, frameFor(v.me), v.entries.find((e) => !e.mine).id);
      } else if (id === "whisper") {
        if (S.phase === "pick")
          await pick(page, frameFor(S.whisperer), views[1].me);
        else if (S.phase === "guess")
          for (const v of views.filter((v) => v.me !== S.whisperer))
            await pick(page, frameFor(v.me), "heads");
        else
          await host.waitForFunction(
            () => window.__b2State.phase !== "flip",
            null,
            { timeout: 10000 },
          );
      }
      await host.waitForFunction(
        (before) =>
          window.__b2State.phase + ":" + window.__b2State.turnNo !== before,
        before,
        { timeout: 10000 },
      );
      if ((await state(host)).phase !== "done") {
        await page.locator("#practiceTab1").click();
        await host.evaluate(() => scrollTo(0, 0));
        stable(
          baseline,
          await geometry(host),
          prefix + " after count/score/phase",
        );
        row.checks++;
      }
    }
    await page.locator("#practiceTab1").click();
    assert.equal((await state(host)).phase, "done");
    await host.locator(".gk-final").waitFor();
    await page.screenshot({
      path: path.join(artifacts, prefix + "-done.png"),
      fullPage: true,
    });
    assert(await host.locator("body > #toast").count(), "shared toast restored after the game");
    await host.getByRole("button", { name: "Rematch", exact: true }).click();
    await host.waitForFunction(
      () =>
        window.__b2State.phase !== "done" &&
        !window.__b2State.preparing &&
        document.querySelector(".b2-scene"),
      null,
      { timeout: 20000 },
    );
    assert.equal(await host.locator(".b2-scene").count(), 1);
    row.rematch = true;
    assert.deepEqual(errors, [], prefix + " console errors");
    results.push(row);
    console.log(
      "B2_BROWSER_PASS " + prefix + " " + row.checks + " stable checks",
    );
  } catch (e) {
    await page
      .screenshot({
        path: path.join(artifacts, prefix + "-FAIL.png"),
        fullPage: true,
      })
      .catch(() => {});
    throw e;
  } finally {
    await context.close();
  }
}
function denseFixtures(id) {
  const max = {
    "odd-one-out": 12,
    "moonlit-village": 16,
    undercover: 12,
    backronyms: 20,
    whisper: 20,
  }[id];
  const h = start(id, max),
    snapshots = [],
    seen = new Set();
  const capture = () => {
    if (h.s.phase === "done") return;
    for (const pid of [...h.s.ids, "spectator"]) {
      const v = h.v(pid);
      const tag = [
        v.phase,
        v.ghost,
        v.role,
        v.card?.outsider,
        pid === v.turnPid,
        pid === v.whisperer,
        v.watching,
      ].join(":");
      if (seen.has(tag)) continue;
      seen.add(tag);
      const players = h.ctx.roster.map((p, i) => ({
        ...p,
        name: [
          "Alexandria-Rose Kapoor",
          "Samantha <&> Li",
          "Christopher Fernandes",
          "Dee",
        ][i % 4],
      }));
      snapshots.push({
        ...v,
        game: id,
        instanceId: "dense-" + id,
        players,
        participants: players,
        me: pid,
        you: pid,
        spectator: pid === "spectator",
        preparing: false,
      });
    }
  };
  const act = h.act,
    fire = h.ctx.fire.bind(h.ctx);
  h.act = (pid, action) => {
    act(pid, action);
    capture();
  };
  h.ctx.fire = () => {
    fire();
    capture();
  };
  capture();
  if (id === "whisper") {
    const first = snapshots.find((S) => S.me === S.whisperer);
    for (const question of h.ctx.content(id).questions)
      snapshots.push({ ...first, question });
  }
  if (id === "backronyms") {
    const first = snapshots.find((S) => !S.spectator);
    for (const category of h.ctx.content(id).categories)
      snapshots.push({ ...first, category });
  }
  play(id, max, 1, h);
  return snapshots;
}
async function denseCase(id, viewport, theme) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/b2-layout", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html data-theme="${theme}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/skins.css"><body class="game-playing" data-game="${id}"><main style="padding:16px"><div id="gbody"></div></main></body></html>`,
    }),
  );
  try {
    await page.goto(`http://127.0.0.1:${port}/b2-layout`);
    await page.evaluate(async (id) => {
      window.__b2View = (await import("/js/games/" + id + ".js")).default;
      window.__b2Paint = (S) =>
        window.__b2View.render(document.getElementById("gbody"), S, {
          send: () => true,
          now: () => S.endsAt - 5000,
          announce() {},
        });
    }, id);
    let count = 0,
      baseline;
    for (const S of denseFixtures(id)) {
      await page.evaluate((S) => window.__b2Paint(S), S);
      const before = await geometry(page);
      // Role changes and phase changes must keep the stage and the full score strip still.
      if (!baseline) baseline = before;
      stable(
        baseline,
        before,
        `${id} dense ${viewport.width}/${theme} ${S.phase}`,
      );
      await page.evaluate(() => {
        const input = document.querySelector("[data-input]");
        if (input && !input.disabled) {
          input.value = "A draft that stays";
          input.dataset.kept = "yes";
        }
      });
      await page.evaluate(
        (S) =>
          window.__b2Paint({
            ...S,
            scores: Object.fromEntries(S.players.map((p) => [p.id, 1234])),
            acted: S.players.map((p) => p.id),
          }),
        S,
      );
      stable(before, await geometry(page), id + " dense score/count update");
      assert(
        await page.evaluate(() => {
          const input = document.querySelector("[data-input]");
          return (
            !input ||
            input.disabled ||
            (input.value === "A draft that stays" &&
              input.dataset.kept === "yes")
          );
        }),
        id + " draft survives count/score update",
      );
      if (count++ === 0)
        await page.screenshot({
          path: path.join(
            artifacts,
            `${id}-${viewport.width}-${theme}-maximum-roster.png`,
          ),
          fullPage: true,
        });
    }
    assert.deepEqual(errors, []);
    denseResults.push({ id, viewport, theme, states: count });
    await page.evaluate(() =>
      window.__b2View.dispose(document.getElementById("gbody")),
    );
  } finally {
    await context.close();
  }
}
(async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-b2-server-"));
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
  server.stdout.on("data", (s) => {
    logs += s;
  });
  server.stderr.on("data", (s) => {
    logs += s;
  });
  for (let i = 0; i < 200 && !logs.includes("PartyBox on"); i++) {
    if (server.exitCode !== null) throw Error(logs);
    await wait(50);
  }
  assert(logs.includes("PartyBox on"), logs);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.B2_CHROMIUM ? { executablePath: process.env.B2_CHROMIUM } : {}),
  });
  const sizes = process.env.B2_WIDTH
    ? [
        {
          width: Number(process.env.B2_WIDTH),
          height: Number(process.env.B2_WIDTH) < 600 ? 844 : 800,
        },
      ]
    : [
        { width: 390, height: 844 },
        { width: 1280, height: 800 },
      ];
  for (const viewport of sizes)
    for (const theme of process.env.B2_THEME
      ? [process.env.B2_THEME]
      : ["day", "night"])
      for (const id of process.env.B2_GAMES?.split(",") || IDS) {
        await playCase(id, viewport, theme);
        await denseCase(id, viewport, theme);
      }
  console.log(
    "NEW_GAMES_B2_BROWSER_PASS: " +
      results.length +
      " full practice games; stable primary/HUD/scores across phase and score changes; no overflow; rematches",
  );
})()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.writeFileSync(
      path.join(artifacts, "results.json"),
      JSON.stringify({ results, denseResults, artifacts }, null, 2),
    );
    console.log("B2_ARTIFACTS " + artifacts);
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
