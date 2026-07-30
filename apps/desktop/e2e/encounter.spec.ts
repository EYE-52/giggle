import { expect, test, type Browser, type Page } from "@playwright/test";

test.setTimeout(240_000);

const viewportMatrix = [
  ["compact-phone", 320, 568],
  ["phone", 390, 844],
  ["large-phone", 430, 932],
  ["phone-landscape", 844, 390],
  ["small-tablet", 768, 1024],
  ["tablet", 834, 1194],
  ["laptop", 1280, 800],
  ["desktop", 1440, 900],
  ["wide", 1728, 1117],
] as const;

const fixtureCounts = [1, 2, 3, 4, 8] as const;

function fixtureMember(side: "mine" | "theirs", index: number) {
  const local = side === "mine" && index === 0;
  return {
    memberId: `${side}-member-${index + 1}`,
    userId: local ? "fixture-user" : `${side}-user-${index + 1}`,
    uid: (side === "mine" ? 100 : 200) + index,
    displayName: local ? "Maya" : `${side === "mine" ? "Squadmate" : "Opponent"} ${index + 1}`,
    role: index === 0 ? "leader" : "member",
    ready: true,
    inLobbyVideo: false,
    inEncounterVideo: true,
    online: true,
  };
}

function fixtureEncounter(encounterId: string, count: number) {
  return {
    encounterId,
    status: "active",
    squadAId: "fixture-squad",
    squadAName: "Night Owls",
    squadACover: null,
    squadAMembers: Array.from({ length: count }, (_, index) => fixtureMember("mine", index)),
    squadBId: "fixture-opponents",
    squadBName: "Chaos Club",
    squadBCover: null,
    squadBMembers: Array.from({ length: count }, (_, index) => fixtureMember("theirs", index)),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

async function installEncounterFixture(page: Page) {
  const user = {
    id: "fixture-user",
    email: "fixture@giggle.local",
    name: "Maya",
    isPremium: false,
    isApproved: true,
    ageConfirmed: true,
    isAdult: true,
  };
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    email: user.email,
    name: user.name,
    ageConfirmed: true,
    isAdult: true,
  })).toString("base64url");
  await page.addInitScript(({ sessionValue }) => {
    localStorage.setItem("giggle.session", sessionValue);
    localStorage.setItem("giggle.theme", "dark");
  }, { sessionValue: JSON.stringify({ token: `e30.${payload}.fixture`, user }) });

  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const encounterMatch = path.match(/^\/api\/matchmaking\/encounters\/(fixture-(\d+)v\2)$/);
    if (encounterMatch) {
      const count = Number(encounterMatch[2]);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: fixtureEncounter(encounterMatch[1], count) }),
      });
      return;
    }
    if (path === "/api/squads/fixture-squad/encounter-video") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { memberId: "mine-member-1", inEncounterVideo: true } }),
      });
      return;
    }
    if (path === "/api/encounters/token") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: { code: "fixture_media", message: "Fixture media is intentionally unavailable." } }),
      });
      return;
    }
    if (path === "/api/encounters/disconnect") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { encounterId: "fixture", disconnected: true } }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "fixture_missing", message: `No fixture for ${path}` } }),
    });
  });
}

async function openFixture(page: Page, count: number) {
  await page.goto(`/encounter?squad=fixture-squad&enc=fixture-${count}v${count}`);
  const stage = page.getByTestId("encounter-stage");
  const controls = page.getByTestId("call-controls");
  await expect(stage).toBeVisible();
  await expect(controls).toBeVisible();
  await expect.poll(() => controls.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
  await dismiss.waitFor({ state: "visible", timeout: 750 }).then(() => dismiss.click()).catch(() => {});
  return { stage, controls };
}

async function enterQueue(page: Page) {
  await page.goto("/home", { waitUntil: "domcontentloaded", timeout: 15_000 });
  const ageGate = page.getByRole("heading", { name: "Confirm your age" });
  const createSquad = page.getByRole("button", { name: /create squad/i });
  await expect(ageGate.or(createSquad)).toBeVisible({ timeout: 10_000 });
  if (await ageGate.isVisible()) {
    await page.getByRole("combobox", { name: "Birth month" }).selectOption("0");
    await page.getByRole("combobox", { name: "Birth day" }).selectOption("1");
    await page.getByRole("combobox", { name: "Birth year" }).selectOption("2000");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(ageGate).toBeHidden({ timeout: 10_000 });
  }
  await expect(createSquad).toBeVisible({ timeout: 10_000 });
  await createSquad.click();
  await page.waitForURL(/\/lobby\?squad=/, { timeout: 15_000 });
  const readiness = page.getByTestId("lobby-readiness");
  await expect(readiness).toBeVisible({ timeout: 10_000 });
  await readiness.getByRole("button", { name: /mark ready/i }).click();
  await expect(readiness.getByRole("button", { name: /find a match/i })).toBeEnabled();
  await readiness.getByRole("button", { name: /find a match/i }).click();
  const continueWithoutCamera = page.getByRole("button", { name: "Continue without camera" });
  await continueWithoutCamera.waitFor({ state: "visible", timeout: 1000 }).then(() => continueWithoutCamera.click()).catch(() => {});
  await page.waitForURL(/\/matchmaking\?squad=/, { timeout: 15_000 });
}

async function createEncounter(page: Page, browser: Browser) {
  const opponentContext = await browser.newContext({ viewport: page.viewportSize() ?? { width: 390, height: 844 } });
  const opponent = await opponentContext.newPage();
  await Promise.all([enterQueue(page), enterQueue(opponent)]);
  await Promise.all([
    page.waitForURL(/\/match\?/, { timeout: 20_000 }),
    opponent.waitForURL(/\/match\?/, { timeout: 20_000 }),
  ]);
  await Promise.all([
    page.getByRole("button", { name: /join encounter/i }).click(),
    opponent.getByRole("button", { name: /join encounter/i }).click(),
  ]);
  await Promise.all([
    page.waitForURL(/\/encounter\?/, { timeout: 10_000 }),
    opponent.waitForURL(/\/encounter\?/, { timeout: 10_000 }),
  ]);
  return { opponentContext, opponent };
}

test("real encounter keeps media and controls usable across resize", async ({ page, browser }, testInfo) => {
  test.skip(!["phone", "desktop"].includes(testInfo.project.name), "One compact and one full call cover the live-media contract");
  const { opponentContext } = await createEncounter(page, browser);
  try {
    const stage = page.getByTestId("encounter-stage");
    const controls = page.getByTestId("call-controls");
    await expect(stage).toBeVisible();
    await expect(controls).toBeVisible();
    await expect(controls.getByRole("button", { name: "Mute microphone" })).toHaveAttribute("aria-pressed", "true");
    await expect(controls.getByRole("button", { name: "Turn camera off" })).toHaveAttribute("aria-pressed", "true");
    await expect(controls.getByRole("button", { name: "Chat" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "More" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "End encounter" })).toBeVisible();
    await expect.poll(() => controls.evaluate(node => getComputedStyle(node).opacity)).toBe("1");

    const frames = stage.locator("[data-media-frame]");
    expect(await frames.count()).toBeGreaterThanOrEqual(2);
    for (const frame of await frames.all()) {
      await expect.poll(() => frame.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
      const box = await frame.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);

      const screenshot = await frame.screenshot({ type: "jpeg", quality: 70 });
      const signal = await page.evaluate(async source => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${source}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 18;
        const context = canvas.getContext("2d");
        if (!context) return { range: 0, litRatio: 0 };
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let min = 255;
        let max = 0;
        let lit = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const luminance = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
          min = Math.min(min, luminance);
          max = Math.max(max, luminance);
          if (luminance > 12) lit += 1;
        }
        return { range: max - min, litRatio: lit / (pixels.length / 4) };
      }, screenshot.toString("base64"));
      expect(signal.range).toBeGreaterThan(20);
      expect(signal.litRatio).toBeGreaterThan(0.04);
    }

    await expect(stage.locator("[data-layout-kind]")).toBeVisible();
    const firstFrame = frames.first();
    await firstFrame.click();
    await expect(firstFrame).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(firstFrame).toHaveAttribute("aria-pressed", "false");
    await firstFrame.click();
    await expect(firstFrame).toHaveAttribute("aria-pressed", "true");
    await firstFrame.click();
    await expect(firstFrame).toHaveAttribute("aria-pressed", "false");
    await expect(stage.locator('[data-media-fit="fit"]').first()).toBeVisible();

    const more = controls.getByRole("button", { name: "More" });
    await more.click();
    await page.getByRole("button", { name: "Crop focused video" }).click();
    await expect(stage.locator('[data-media-fit="fit"]')).toHaveCount(0);
    await more.click();
    await page.getByRole("button", { name: "Fit focused video" }).click();
    await expect(stage.locator('[data-media-fit="fit"]').first()).toBeVisible();

    const chat = controls.getByRole("button", { name: "Chat" });
    await chat.click();
    await expect(page.getByRole("textbox", { name: "Chat message" })).toBeVisible();
    if (testInfo.project.name === "phone") {
      const chatDialog = page.getByRole("dialog", { name: "Encounter chat" });
      const box = await chatDialog.boundingBox();
      expect(box?.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 844) * 0.56);
    }
    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(chat).toBeFocused();

    const localFrame = frames.filter({ hasText: "(You)" }).first();
    const reactionDuration = page.evaluate(() => new Promise<number>(resolve => {
      let appearedAt = 0;
      const observer = new MutationObserver(() => {
        const visible = document.querySelector("[data-reaction]");
        if (visible && !appearedAt) appearedAt = performance.now();
        if (!visible && appearedAt) {
          observer.disconnect();
          resolve(performance.now() - appearedAt);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(() => {
        observer.disconnect();
        resolve(-1);
      }, 3000);
    }));
    if (testInfo.project.name === "phone") {
      await controls.getByRole("button", { name: "More" }).click();
      await expect(page.getByRole("button", { name: "React 👋" })).toBeVisible();
      await page.getByRole("button", { name: "React 👋" }).click();
    } else {
      await controls.getByRole("button", { name: "Reactions" }).click();
      await page.getByRole("button", { name: "React 👋" }).click();
    }
    await expect(localFrame.locator("[data-reaction]")).toHaveCount(1);
    const visibleFor = await reactionDuration;
    expect(visibleFor).toBeGreaterThanOrEqual(1700);
    expect(visibleFor).toBeLessThanOrEqual(2100);
    await expect(localFrame.locator("[data-reaction]")).toHaveCount(0);

    await more.click();
    await page.getByRole("button", { name: "Report opponent squad" }).click();
    await expect(page.getByText(/reported — thanks/i)).toBeVisible();

    await page.screenshot({
      path: `artifacts/visual-audit/2026-07-30/encounter/${testInfo.project.name}.jpg`,
      type: "jpeg",
      quality: 82,
    });

    if (testInfo.project.name === "phone") {
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(controls).toBeVisible();
      await expect.poll(() => controls.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
      const box = await controls.boundingBox();
      expect(box && box.y + box.height).toBeLessThanOrEqual(390);
      await page.screenshot({
        path: "artifacts/visual-audit/2026-07-30/encounter/phone-landscape.jpg",
        type: "jpeg",
        quality: 82,
      });
    }

    if (testInfo.project.name === "desktop") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      await page.screenshot({
        path: "artifacts/visual-audit/2026-07-30/encounter/desktop-reduced-motion.jpg",
        type: "jpeg",
        quality: 82,
      });
    }

    await controls.getByRole("button", { name: "End encounter" }).click();
    const endDialog = page.getByRole("dialog", { name: "End encounter?" });
    await expect(endDialog).toBeVisible();
    await endDialog.getByRole("button", { name: "Keep talking" }).click();
    await expect(endDialog).toBeHidden();
    await expect(stage).toBeVisible();
    await controls.getByRole("button", { name: "End encounter" }).click();
    await expect(endDialog).toBeVisible();
    await endDialog.getByRole("button", { name: "End encounter" }).click();
    await expect(page).toHaveURL(/\/home$/);
  } finally {
    await opponentContext.close();
  }
});

test("opponent ending preserves a clear recovery state", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "One phone call covers the remote-ended state");
  const { opponentContext, opponent } = await createEncounter(page, browser);
  try {
    const stage = page.getByTestId("encounter-stage");
    await expect(stage).toBeVisible();
    await opponent.getByTestId("call-controls").getByRole("button", { name: "End encounter" }).click();
    await opponent.getByRole("dialog", { name: "End encounter?" }).getByRole("button", { name: "End encounter" }).click();
    await expect(page.getByText("The other squad left", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Continue matching" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back home" })).toBeVisible();
    await page.screenshot({
      path: "artifacts/visual-audit/2026-07-30/encounter/states/phone-opponent-ended.jpg",
      type: "jpeg",
      quality: 82,
    });
    await page.getByRole("button", { name: "Back home" }).click();
    await expect(page).toHaveURL(/\/home$/);
  } finally {
    await opponentContext.close();
  }
});

test("mocked rosters stay usable across the viewport matrix", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The test supplies its own complete viewport matrix");
  await installEncounterFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const [viewportName, width, height] of viewportMatrix) {
    await page.setViewportSize({ width, height });
    for (const count of fixtureCounts) {
      const { stage, controls } = await openFixture(page, count);
      const expectedLayout = count === 1
        ? "remote-main"
        : count === 2
        ? "squad-split"
        : count <= 4
        ? "featured-split"
        : width >= 1180
        ? "dual-focus"
        : "single-focus";
      await expect(stage.locator(`[data-layout-kind="${expectedLayout}"]`)).toBeVisible();

      const frames = stage.locator("[data-media-frame]");
      const segmented = count === 8 && width < 1180;
      await expect(frames).toHaveCount(segmented ? count + 1 : count * 2);
      const participantLabels = new Set(await frames.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))));
      if (segmented) {
        const segmentGroup = stage.getByRole("group", { name: "Filmstrip squad" });
        for (const name of ["Show your squad", "Show opponent squad"]) {
          const button = segmentGroup.getByRole("button", { name });
          const box = await button.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
        await segmentGroup.getByRole("button", { name: "Show opponent squad" }).click();
        for (const label of await frames.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")))) participantLabels.add(label);
        await segmentGroup.getByRole("button", { name: "Show your squad" }).click();
      }
      expect(participantLabels.size).toBe(count * 2);
      const unreachable = await frames.evaluateAll(nodes => nodes.flatMap(node => {
        const frame = node as HTMLElement;
        const rect = frame.getBoundingClientRect();
        const detail = {
          label: frame.getAttribute("aria-label") ?? "unnamed frame",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        };
        if (rect.width < 44 || rect.height < 44) return [detail];
        if (rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight) return [];
        let parent = frame.parentElement;
        while (parent) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth) return [];
          parent = parent.parentElement;
        }
        return [detail];
      }));
      expect(unreachable).toEqual([]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const dock = await controls.boundingBox();
      expect(dock?.x).toBeGreaterThanOrEqual(0);
      expect(dock && dock.x + dock.width).toBeLessThanOrEqual(width);
      expect(dock && dock.y + dock.height).toBeLessThanOrEqual(height);
      for (const button of await controls.getByRole("button").all()) {
        const box = await button.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }

      await page.screenshot({
        path: `artifacts/visual-audit/2026-07-30/encounter/geometry/${viewportName}-${count}v${count}.jpg`,
        type: "jpeg",
        quality: 78,
      });
    }
  }
});

test("mocked call chrome keeps dialogs, themes, and zoom usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One project supplies its own focused visual states");
  await installEncounterFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const { stage, controls } = await openFixture(page, 3);

  const chat = controls.getByRole("button", { name: "Chat" });
  await chat.click();
  const chatDialog = page.getByRole("dialog", { name: "Encounter chat" });
  await expect(chatDialog).toBeVisible();
  await expect.poll(() => chatDialog.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  const dialogBox = await chatDialog.boundingBox();
  expect(dialogBox?.height).toBeLessThanOrEqual(844 * 0.56);
  const closeChat = page.getByRole("button", { name: "Close chat" });
  const closeBox = await closeChat.boundingBox();
  expect(closeBox?.width).toBeGreaterThanOrEqual(44);
  expect(closeBox?.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-30/encounter/states/phone-chat.jpg",
    type: "jpeg",
    quality: 82,
  });
  await closeChat.click();
  await expect(chat).toBeFocused();

  await controls.getByRole("button", { name: "More" }).click();
  const moreActions = page.getByRole("group", { name: "More call actions" });
  await expect(moreActions).toBeVisible();
  await expect(page.getByRole("button", { name: "Report opponent squad" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-30/encounter/states/phone-more.jpg",
    type: "jpeg",
    quality: 82,
  });
  await page.keyboard.press("Escape");

  await controls.getByRole("button", { name: "End encounter" }).click();
  const endDialog = page.getByRole("dialog", { name: "End encounter?" });
  await expect(endDialog).toBeVisible();
  await expect.poll(() => endDialog.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-30/encounter/states/phone-end-confirmation.jpg",
    type: "jpeg",
    quality: 82,
  });
  await endDialog.getByRole("button", { name: "Keep talking" }).click();
  await expect(stage).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  const stageRoot = stage.locator("xpath=ancestor::*[@data-theme='dark'][1]");
  const stageBackground = await stageRoot.evaluate(node => getComputedStyle(node).backgroundColor);
  const accents = new Set<string>();
  for (const theme of ["dark", "light", "tangerine"] as const) {
    await page.evaluate(value => {
      localStorage.setItem("giggle.theme", value);
      document.documentElement.setAttribute("data-theme", value);
    }, theme);
    await expect.poll(() => stageRoot.evaluate(node => getComputedStyle(node).getPropertyValue("--accent").trim())).not.toBe("");
    accents.add(await stageRoot.evaluate(node => getComputedStyle(node).getPropertyValue("--accent").trim()));
    expect(await stageRoot.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(stageBackground);
    await page.screenshot({
      path: `artifacts/visual-audit/2026-07-30/encounter/themes/${theme}.jpg`,
      type: "jpeg",
      quality: 82,
    });
  }
  expect(accents.size).toBe(3);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-30/encounter/states/desktop-reduced-motion.jpg",
    type: "jpeg",
    quality: 82,
  });

  // 200% desktop zoom has the same CSS layout viewport as 720 × 450.
  await page.setViewportSize({ width: 720, height: 450 });
  const zoomDock = await controls.boundingBox();
  expect(zoomDock && zoomDock.x + zoomDock.width).toBeLessThanOrEqual(720);
  expect(zoomDock && zoomDock.y + zoomDock.height).toBeLessThanOrEqual(450);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-30/encounter/states/desktop-zoom-200.jpg",
    type: "jpeg",
    quality: 82,
  });
});
