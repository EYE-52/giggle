"use strict";
/* Real practice rooms and real seat controls. Run on Mini when Chromium is sandboxed.
 * NODE_PATH may point at an existing Playwright install; the app loads this checkout. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { IDS } = require("./new-games-b3-harness");
const { solve } = require("../games/engines/word-grid-lexicon");
const root = path.resolve(__dirname, "..");
const artifacts =
  process.env.B3_ARTIFACTS || path.join(root, "artifacts", "b3", "latest");
fs.mkdirSync(artifacts, { recursive: true });
const rows = [],
  wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server,
  browser,
  port,
  scratch,
  logs = "";
const framesFor = (page) =>
  page
    .frames()
    .filter((f) => /[?&]practice=/.test(f.url()) && /[?&]seat=/.test(f.url()))
    .sort(
      (a, b) =>
        Number(new URL(a.url()).searchParams.get("seat")) -
        Number(new URL(b.url()).searchParams.get("seat")),
    );
const state = async (f) => {
  const s = await f.evaluate(() => window.__b3State);
  return { ...s, me: s.me || s.you };
};
async function choose(page, f) {
  await page
    .locator("#practiceTab" + new URL(f.url()).searchParams.get("seat"))
    .click();
}
async function geometry(f) {
  await f.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return f.evaluate(() => {
    const box = (node) => {
      const b = node.getBoundingClientRect();
      return {
        x: b.x + scrollX,
        y: b.y + scrollY,
        width: b.width,
        height: b.height,
      };
    };
    const slots = Object.fromEntries(
      [".party-hud", ".wp-primary", ".pl-live", ".wp-play"].map((s) => [
        s,
        box(document.querySelector(s)),
      ]),
    );
    const luminance = (color) => {
      const values = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
      const channels = values
        .map((value) => (color.startsWith("color(") ? value : value / 255))
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
      return channels.reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
    };
    const clueContrast = [
      ...document.querySelectorAll(".cg-word.is-red,.cg-word.is-blue"),
    ].map((node) => {
      const style = getComputedStyle(node),
        values = [
          luminance(style.color),
          luminance(style.backgroundColor),
        ].sort((a, b) => a - b);
      return (values[1] + 0.05) / (values[0] + 0.05);
    });
    const intersects = (a, b) =>
      a.x < b.x + b.width - 1 &&
      a.x + a.width > b.x + 1 &&
      a.y < b.y + b.height - 1 &&
      a.y + a.height > b.y + 1;
    const gameContent = [
      ...document.querySelectorAll(
        ".party-prompt,.wp-play,.wp-status,.wp-primary,.pl-live",
      ),
    ].map(box);
    const coveringControls = [
      ...document.querySelectorAll(
        "#roomMenu > summary,#bGameScreenToggle,.game-report-icon",
      ),
    ]
      .filter(
        (node) =>
          node.getClientRects().length &&
          getComputedStyle(node).visibility !== "hidden" &&
          gameContent.some((content) => intersects(box(node), content)),
      )
      .map((node) => node.id || node.className);
    return {
      slots,
      clueContrast,
      coveringControls,
      disabledReason:
        !document.querySelector(".wp-primary").disabled ||
        !!document.querySelector(".wp-status").textContent.trim(),
      defaultNames: [...document.querySelectorAll(".pl-name,.wp-face")].some(
        (node) => /Player [1-4]\b/.test(node.textContent),
      ),
      rows: [...document.querySelectorAll(".pl-seat")].map(box),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      primaryVisible:
        slots[".wp-primary"].y + slots[".wp-primary"].height <= innerHeight + 1,
      controls: [
        ...document.querySelectorAll(".word-party button,.word-party input"),
      ]
        .filter(
          (n) =>
            n.getClientRects().length &&
            getComputedStyle(n).visibility !== "hidden",
        )
        .map((n) => ({
          label: n.textContent || n.getAttribute("aria-label"),
          ...box(n),
        })),
      clipped: [...document.querySelectorAll(".wp-play,.wp-card,.cg-word")]
        .filter(
          (n) =>
            n.scrollHeight > n.clientHeight + 2 &&
            ["hidden", "clip"].includes(getComputedStyle(n).overflowY),
        )
        .map((n) => n.className),
    };
  });
}
function same(a, b, label) {
  assert(!b.overflow, label + " horizontal overflow");
  assert(
    !b.coveringControls.length,
    label + " room control covers game content: " + b.coveringControls,
  );
  assert(b.disabledReason, label + " disabled primary has no reason");
  assert(!b.defaultNames, label + " real names were replaced by defaults");
  assert(
    b.clueContrast.every((value) => value >= 4.5),
    label +
      " team-card text needs 4.5:1 contrast: " +
      JSON.stringify(b.clueContrast),
  );
  assert(!b.clipped.length, label + " clipped content");
  assert(
    b.primaryVisible,
    label + " primary below viewport " + JSON.stringify(b.slots),
  );
  for (const [slot, box] of Object.entries(a.slots))
    for (const key of ["x", "y", "width", "height"])
      assert(
        Math.abs(box[key] - b.slots[slot][key]) <= 1,
        `${label}: ${slot}.${key} ${box[key]} -> ${b.slots[slot][key]}`,
      );
  assert.equal(a.rows.length, b.rows.length);
  for (let i = 0; i < a.rows.length; i++)
    for (const k of ["x", "y", "width", "height"])
      assert(
        Math.abs(a.rows[i][k] - b.rows[i][k]) <= 1,
        label + " score row moved",
      );
  for (const c of b.controls)
    assert(c.height >= 43, label + " short tap target " + JSON.stringify(c));
}
async function fill(f, label, value) {
  const input = f.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function assertUtilities(f, label) {
  const overlap = await f.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll(
        ".play-title,.game-zoom,#roomMenu > summary,#bGameScreenToggle,.game-report-icon",
      ),
    ].filter((node) => node.getClientRects().length);
    return nodes.some((node, i) =>
      nodes.slice(i + 1).some((other) => {
        const a = node.getBoundingClientRect(),
          b = other.getBoundingClientRect();
        return (
          a.left < b.right - 1 &&
          a.right > b.left + 1 &&
          a.top < b.bottom - 1 &&
          a.bottom > b.top + 1
        );
      }),
    );
  });
  assert(!overlap, label + " header utilities overlap");
}
async function playCase(id, viewport, theme) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "reduce",
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });
  await context.addInitScript(
    ({ theme, longNames }) => {
      const names = longNames
        ? [
            "Alexandra Moon",
            "Benjamin Rivers",
            "Charlotte Dawn",
            "Devanand Sharma",
          ]
        : ["Asha", "Ben", "Chloe", "Dev"];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        const match = /^Player ([1-4])$/.exec(String(value));
        if (String(key).endsWith("pb_name") && match)
          value = names[Number(match[1]) - 1];
        return original.call(this, key, value);
      };
      localStorage.setItem("pb_theme", theme);
      const params = new URL(location.href).searchParams,
        session = params.get("practice"),
        seat = params.get("seat");
      if (session && seat) {
        sessionStorage.setItem(
          "practice:" + session + ":seat" + seat + ":pb_theme",
          theme,
        );
        sessionStorage.setItem(
          "practice:" + session + ":seat" + seat + ":pb_name",
          names[Number(seat) - 1],
        );
        params.set("name", names[Number(seat) - 1]);
        history.replaceState(
          null,
          "",
          location.pathname + "?" + params + location.hash,
        );
      }
      const Native = WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", (e) => {
            try {
              const m = JSON.parse(e.data);
              if (m.t === "state") window.__b3State = m;
            } catch {}
          });
        }
      };
    },
    { theme, longNames: !!process.env.B3_LONG_NAMES },
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text() + " " + m.location().url);
  });
  const row = { id, viewport, theme, phases: [], checks: 0 },
    prefix = `${id}-${viewport.width}-${theme}`;
  const seen = new Set();
  let baseline;
  async function inspect(f, tag) {
    await choose(page, f);
    await f.evaluate(() => scrollTo(0, 0));
    const g = await geometry(f);
    if (!baseline) baseline = g;
    same(baseline, g, prefix + " " + tag);
    row.checks++;
    if (!seen.has(tag)) {
      seen.add(tag);
      row.phases.push(tag);
      await page.screenshot({
        path: path.join(artifacts, prefix + "-" + tag + ".png"),
        fullPage: true,
      });
    }
  }
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
    await host.locator("#howtoCustom").click();
    await host.locator("#df-" + id + "-rounds").fill("1");
    await host.locator('[data-picker-for="df-' + id + '-pace"]')
      .getByRole("radio", { name: "Quick", exact: true }).click();
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
          window.__b3State &&
          !window.__b3State.preparing &&
          document.querySelector(".word-party"),
        null,
        { timeout: 20000 },
      );
    await choose(page, host);
    // Capture the settled game after the setup confirmation has faded.
    await host.locator("#toast").waitFor({ state: "hidden" });
    await inspect(host, "opening");
    // Scrolling must never turn the room/report/fullscreen utilities into overlays.
    const scrollMax = await host.evaluate(
      () => document.documentElement.scrollHeight - innerHeight,
    );
    for (let y = 48; y <= scrollMax + 48; y += 48) {
      await host.evaluate((top) => scrollTo(0, top), Math.min(y, scrollMax));
      same(baseline, await geometry(host), prefix + " scroll " + y);
      row.checks++;
    }
    await host.evaluate(() => scrollTo(0, 0));
    // Exercise the fullscreen slot even when the browser hides that button.
    const fullscreenWasHidden = await host
      .locator("#bGameScreenToggle")
      .evaluate((node) => node.hidden);
    await host.locator("#bGameScreenToggle").evaluate((node) => {
      node.hidden = true;
    });
    await assertUtilities(host, prefix + " compact");
    await host.locator("#bGameScreenToggle").evaluate((node) => {
      node.hidden = false;
    });
    const utilityState = await geometry(host);
    assert(
      utilityState.primaryVisible,
      prefix + " fullscreen slot pushes primary off screen",
    );
    assert(
      !utilityState.coveringControls.length,
      prefix + " fullscreen slot covers game content",
    );
    const utilityOverlap = await host.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll(
          ".play-title,.game-zoom,#roomMenu > summary,#bGameScreenToggle,.game-report-icon",
        ),
      ].filter((node) => node.getClientRects().length);
      return nodes.some((node, i) =>
        nodes.slice(i + 1).some((other) => {
          const a = node.getBoundingClientRect(),
            b = other.getBoundingClientRect();
          return (
            a.left < b.right - 1 &&
            a.right > b.left + 1 &&
            a.top < b.bottom - 1 &&
            a.bottom > b.top + 1
          );
        }),
      );
    });
    assert(
      !utilityOverlap,
      prefix + " header utilities overlap each other or the title",
    );
    await page.screenshot({
      path: path.join(artifacts, prefix + "-utilities.png"),
    });
    await host.locator("#bGameScreenToggle").evaluate((node, hidden) => {
      node.hidden = hidden;
    }, fullscreenWasHidden);
    await inspect(host, "opening-restored");
    const frameFor = async (pid) => {
      for (const f of frames) if ((await state(f)).me === pid) return f;
      throw Error("No seat for " + pid);
    };
    if (id === "clue-grid") {
      await host.locator(".cg-shuffle").click();
      await page.waitForTimeout(150);
      await inspect(host, "reshuffled");
      await host.locator(".wp-primary").click();
      await host.waitForFunction(() => window.__b3State.phase === "clue");
      const s = await state(host),
        spy = await frameFor(s.lead);
      await inspect(spy, "spymaster");
      const compactWords = require("../locales/en/clue-grid.json").words;
      const wideWords = await spy.evaluate((words) => {
        const card = document.querySelector(".cg-word"),
          style = getComputedStyle(card);
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d");
        ctx.font = style.font;
        const width =
          card.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        return words.filter((word) => ctx.measureText(word).width > width);
      }, compactWords);
      assert.deepEqual(
        wideWords,
        [],
        prefix + " grid labels must fit without broken words",
      );
      await spy.getByLabel("One-word clue", { exact: true }).fill("discovery");
      const targets = spy.getByLabel("Number of targets", { exact: true }),
        down = spy.getByRole("button", { name: "Decrease target count", exact: true }),
        up = spy.getByRole("button", { name: "Increase target count", exact: true });
      await down.click();
      assert.equal(await targets.inputValue(), "0");
      assert(await down.isDisabled(), "target count stops at zero");
      await targets.fill("8");
      await up.click();
      assert.equal(await targets.inputValue(), "9");
      assert(await up.isDisabled(), "target count stops at nine");
      assert.equal(await spy.getByLabel("One-word clue", { exact: true }).inputValue(), "discovery");
      await inspect(spy, "target-count");
      await spy.locator(".wp-primary").click();
      await host.waitForFunction(() => window.__b3State.phase === "guess");
      const key = await state(spy),
        guesser = await frameFor(
          key.teams[key.team].find((p) => p !== key.lead),
        );
      await inspect(guesser, "guesser");
      assert(
        (await state(guesser)).cards.every(
          (c) => c.open || c.kind === undefined,
        ),
      );
      for (const [i, c] of key.cards.entries())
        if (c.kind === key.team) {
          await guesser.locator('[data-card="' + i + '"]').click();
          await page.waitForTimeout(80);
          if ((await state(guesser)).phase === "reveal") break;
          await inspect(guesser, "card-open");
        }
    } else if (id === "letter-lock") {
      for (const f of frames) {
        await choose(page, f);
        for (const guess of [
          "crane",
          "sloth",
          "build",
          "merry",
          "panda",
          "ghost",
        ]) {
          const s = await state(f);
          if (s.phase === "reveal" || s.solved.includes(s.me)) break;
          await f.getByLabel("Five-letter guess", { exact: true }).fill(guess);
          await inspect(f, "ready");
          await f
            .getByLabel("Five-letter guess", { exact: true })
            .press("Enter");
          await f.waitForFunction(
            (n) =>
              window.__b3State.myRows.length > n ||
              window.__b3State.phase === "reveal",
            (s.myRows || []).length,
          );
          await inspect(f, "row-" + (s.myRows.length + 1));
        }
      }
    } else if (id === "word-grid") {
      const s = await state(host),
        solutions = solve(s.grid),
        words = Object.keys(solutions);
      const trails = words.filter((w) => solutions[w].length >= 3);
      // A real tap trail and drag trail use the same authoritative path check as typing.
      await choose(page, host);
      for (const at of solutions[trails[0]]) {
        const tile = host.locator(`[data-tile="${at}"]`);
        if (viewport.width < 600) await tile.tap();
        else await tile.click();
      }
      assert.equal(
        await host.getByLabel("Your grid word", { exact: true }).inputValue(),
        trails[0].toUpperCase().replaceAll("QU", "Qu"),
      );
      await inspect(host, "ready");
      await host.locator(".wp-primary").click();
      await host.waitForFunction(
        (w) => window.__b3State.mine.includes(w),
        trails[0],
      );
      await inspect(host, "tap-trail");
      const route = solutions[trails[1]];
      for (let i = 0; i < route.length; i++) {
        const b = await host.locator(`[data-tile="${route[i]}"]`).boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
          steps: 3,
        });
        if (i === 0) await page.mouse.down();
      }
      await page.mouse.up();
      await host.locator(".wp-primary").click();
      await host.waitForFunction(
        (w) => window.__b3State.mine.includes(w),
        trails[1],
      );
      await inspect(host, "drag-trail");
      // A different seat's snapshot must preserve an unfinished composer.
      await host.getByLabel("Your grid word", { exact: true }).fill("draft");
      await host.getByLabel("Your grid word", { exact: true }).evaluate((n) => {
        n.dataset.kept = "yes";
      });
      await choose(page, frames[1]);
      await fill(frames[1], "Your grid word", words[2]);
      await frames[1].waitForFunction(() => window.__b3State.mine.length > 0);
      assert.equal(
        await host.getByLabel("Your grid word", { exact: true }).inputValue(),
        "draft",
      );
      assert.equal(
        await host
          .getByLabel("Your grid word", { exact: true })
          .getAttribute("data-kept"),
        "yes",
      );
      await choose(page, host);
      await host.locator(".wg3-clear").click();
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        await choose(page, f);
        await fill(f, "Your grid word", words[i + 3]);
        await f.waitForFunction(() => window.__b3State.mine.length > 0);
        await inspect(f, "saved");
        await f.locator(".wg3-done").click();
        await f.waitForFunction(
          () =>
            window.__b3State.myLocked || window.__b3State.phase === "reveal",
        );
        await inspect(f, "locked");
      }
    } else if (id === "banned-words") {
      const s = await state(host),
        lead = await frameFor(s.lead),
        guesser = await frameFor(s.teams[s.team].find((p) => p !== s.lead));
      await inspect(lead, "describer");
      await lead.locator(".bw-skip").click();
      await lead.waitForFunction((n) => window.__b3State.cardNo > n, s.cardNo);
      await inspect(lead, "skip");
      await inspect(guesser, "guesser");
      const rival = await frameFor(
        s.players.find((p) => !s.teams[s.team].includes(p.id)).id,
      );
      await inspect(rival, "rival");
      assert.equal(await rival.locator(".bw-banned span").count(), 4);
      assert.equal((await state(rival)).card, null);
      await rival.locator(".wp-primary").click();
      await lead.waitForFunction(
        (n) => window.__b3State.cardNo > n,
        s.cardNo + 1,
      );
      for (let i = 0; i < 5; i++) {
        const v = await state(lead);
        await choose(page, guesser);
        await guesser
          .getByLabel("Your target guess", { exact: true })
          .fill(v.card.target);
        await inspect(guesser, "ready");
        await guesser
          .getByLabel("Your target guess", { exact: true })
          .press("Enter");
        await lead.waitForFunction((n) => window.__b3State.correct > n, i);
        await inspect(lead, "correct-" + (i + 1));
      }
      await host.waitForFunction(
        () => window.__b3State.phase === "reveal",
        null,
        { timeout: 50000 },
      );
    } else {
      const s = await state(host),
        lead = await frameFor(s.lead);
      await inspect(lead, "mouther");
      const phrase = (await state(lead)).phrase;
      for (const f of frames) {
        const v = await state(f);
        if (v.me === v.lead) continue;
        await inspect(f, "guesser");
        await f.getByLabel("Your phrase guess", { exact: true }).fill(phrase);
        await inspect(f, "ready");
        await f.getByLabel("Your phrase guess", { exact: true }).press("Enter");
        await f.waitForFunction(
          () =>
            window.__b3State.myResult === 100 ||
            window.__b3State.phase === "reveal",
        );
        await inspect(f, "matched");
      }
    }
    await host.waitForFunction(() => window.__b3State.phase === "reveal");
    await inspect(host, "reveal");
    if (id === "word-grid") {
      assert.equal(await host.locator(".wg3-longest li").count(), 5);
      assert(await host.locator(".wg3-words").evaluate((node) => node.open));
    }
    if (process.env.B3_DETAIL_CHECKS) {
      // Review the score strip and the full reveal content below the playfield.
      await host.locator(".pl-live").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(artifacts, prefix + "-scores.png"),
      });
      if (id === "letter-lock") {
        await host.locator(".ll-others summary").click();
        assert(await host.locator(".ll-others").evaluate((node) => node.open));
        assert.equal(await host.locator(".ll-mini").count(), 3);
        await host.locator(".ll-others").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(artifacts, prefix + "-other-boards.png"),
        });
      } else if (id === "word-grid") {
        await host.locator(".wg3-words").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(artifacts, prefix + "-word-trails.png"),
        });
      }
      assert(
        await host.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await host.evaluate(() => scrollTo(0, 0));
    }
    // Extra scores and long player names must fit their reserved rows.
    const checks = await host.evaluate(() =>
      [...document.querySelectorAll(".pl-points")].every((n) => {
        const a = n.getBoundingClientRect(),
          b = n.closest(".pl-seat").getBoundingClientRect();
        return a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
      }),
    );
    assert(checks, "score content stays inside seats");
    await choose(page, host);
    await host.locator(".wp-primary").click();
    await host.waitForFunction(() => window.__b3State.phase === "done");
    await host.locator(".gk-final").waitFor();
    await host.locator("#bGameScreenToggle").evaluate((node) => {
      node.hidden = false;
    });
    const finalUtilityOverlap = await host.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll(
          ".play-title,.game-zoom,#roomMenu > summary,#bGameScreenToggle,.game-report-icon",
        ),
      ].filter((node) => node.getClientRects().length);
      return nodes.some((node, i) =>
        nodes.slice(i + 1).some((other) => {
          const a = node.getBoundingClientRect(),
            b = other.getBoundingClientRect();
          return (
            a.left < b.right - 1 &&
            a.right > b.left + 1 &&
            a.top < b.bottom - 1 &&
            a.bottom > b.top + 1
          );
        }),
      );
    });
    assert(
      !finalUtilityOverlap,
      prefix + " final-score header utilities overlap",
    );
    await host.locator("#bGameScreenToggle").evaluate((node) => {
      node.hidden = true;
    });
    await assertUtilities(host, prefix + " compact final scores");
    await host.locator("#bGameScreenToggle").evaluate((node) => {
      node.hidden = false;
    });
    await page.screenshot({
      path: path.join(artifacts, prefix + "-done.png"),
      fullPage: true,
    });
    assert(
      await host.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await host.getByRole("button", { name: "Rematch", exact: true }).click();
    await host.waitForFunction(
      () =>
        window.__b3State.phase !== "done" &&
        !window.__b3State.preparing &&
        document.querySelector(".word-party"),
      null,
      { timeout: 20000 },
    );
    assert.equal(await host.locator(".word-party").count(), 1);
    row.rematch = true;
    await page.locator("#practiceStop").click();
    await page.waitForFunction(
      () =>
        document.getElementById("practiceStatus").textContent ===
        "Practice ended",
    );
    assert.deepEqual(errors, []);
    row.passed = true;
    rows.push(row);
    console.log(JSON.stringify(row));
  } catch (e) {
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
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-b3-server-"));
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
  browser = await chromium.launch({ headless: true });
  const sizes = process.env.B3_WIDTH
    ? [
        {
          width: Number(process.env.B3_WIDTH),
          height: Number(process.env.B3_WIDTH) < 600 ? 844 : 800,
        },
      ]
    : [
        { width: 390, height: 844 },
        { width: 1280, height: 800 },
      ];
  for (const viewport of sizes)
    for (const theme of process.env.B3_THEME
      ? [process.env.B3_THEME]
      : ["day", "night"])
      for (const id of process.env.B3_GAMES?.split(",") || IDS)
        await playCase(id, viewport, theme);
  console.log(
    "NEW_GAMES_B3_BROWSER_PASS: " +
      rows.length +
      " real practice matches; stable HUD, controls and scores across phases; no overflow; rematches",
  );
})()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.writeFileSync(
      path.join(artifacts, "results.json"),
      JSON.stringify({ rows, artifacts }, null, 2),
    );
    console.log("B3_ARTIFACTS " + artifacts);
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
