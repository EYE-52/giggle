import { expect, test, type Locator, type Page } from "@playwright/test";

test("failed viewer mute keeps the menu open and retry preserves video", async ({ page }) => {
  await page.goto('/dev/call-stage?variant=controls&m=2&t=2&shapes=16:9,9:16,off,4:3&muteFailure=once');
  const videos = page.locator('[data-media-host] video');
  await expect(videos).toHaveCount(3);
  const streams = await videos.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-synthetic-stream')));
  const opener = page.getByRole('button', { name: "Maya's options", exact: true });
  await opener.press('Enter');
  const menu = page.getByRole('dialog', { name: "Maya's options", exact: true });
  await menu.getByRole('button', { name: 'Mute for me', exact: true }).click();
  await expect(menu.getByRole('alert')).toHaveText('Could not change audio. Try again.');
  await expect.poll(() => menu.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
  })).toBe(true);
  await expect(menu.getByRole('button', { name: 'Mute for me', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Muted for you', { exact: true })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Mute for me', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByLabel('Muted for you', { exact: true })).toBeVisible();
  expect(await videos.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-synthetic-stream')))).toEqual(streams);
});

test("real participant controls preserve synthetic streams and restore focus", async ({ page }) => {
  await page.goto('/dev/call-stage?variant=controls&m=2&t=2&shapes=16:9,9:16,off,4:3');
  const videos = page.locator('[data-media-host] video');
  await expect(videos).toHaveCount(3);
  await expect.poll(() => videos.evaluateAll(nodes => nodes.every(node => (node as HTMLVideoElement).readyState >= 2))).toBe(true);
  const streams = await videos.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-synthetic-stream')));
  const tile = page.locator('[data-participant-id="mine-2"]');
  await expect(tile.locator('[aria-hidden="true"]').first()).toBeAttached();
  const opener = page.getByRole('button', { name: "Maya's options", exact: true });
  await opener.press('Enter');
  const menu = page.getByRole('dialog', { name: "Maya's options", exact: true });
  const close = menu.getByRole('button', { name: 'Close person options', exact: true });
  await expect(close).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await close.press('Shift+Tab');
  await expect(menu.getByRole('button', { name: /^Keep this size/ })).toBeFocused();
  await menu.getByRole('button', { name: /^Keep this size/ }).press('Tab');
  await expect(close).toBeFocused();
  await menu.getByRole('button', { name: 'Mute for me', exact: true }).click();
  await expect(opener).toBeFocused();
  await expect(tile.getByLabel('Muted for you', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await opener.press('Enter');
  await expect(menu.getByRole('button', { name: 'Unmute for me', exact: true })).toBeEnabled();
  await menu.getByRole('button', { name: 'Adjust view', exact: true }).click();
  const framing = page.getByRole('dialog', { name: "Maya's view", exact: true });
  await expect(framing.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await framing.getByRole('button', { name: 'Full view', exact: true }).click();
  await framing.getByRole('slider', { name: "Zoom Maya's view", exact: true }).press('ArrowRight');
  await expect(tile.locator('[data-media-frame]')).toHaveAttribute('data-media-fit', 'fit');
  await expect(tile.locator('[data-media-frame]')).toHaveCSS('--person-zoom', '1.1');
  await framing.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(tile.locator('[data-media-frame]')).toHaveCSS('--person-zoom', '1');
  await framing.getByRole('button', { name: 'Close', exact: true }).press('Escape');
  await expect(opener).toBeFocused();
  await opener.press('Enter');
  await menu.getByRole('button', { name: 'Make bigger', exact: true }).click();
  await expect(tile).toHaveAttribute('data-weight', '2');
  await opener.press('Enter');
  await menu.getByRole('button', { name: /^Keep this size/ }).click();
  await expect(tile).toHaveAttribute('data-pinned', 'true');
  await page.setViewportSize({ width: 844, height: 390 });
  const rotated = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const cells = Array.from(document.querySelectorAll('[data-participant-id]'));
    return {
      animating: document.querySelector('[data-focus-stage]')?.getAttribute('data-animating'),
      outside: cells.some(cell => { const box = cell.getBoundingClientRect(); return box.left < -0.5 || box.top < -0.5 || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5; }),
    };
  });
  expect(rotated.animating).not.toBe('true');
  expect(rotated.outside).toBe(false);
  await opener.press('Enter');
  await expect(menu.getByRole('button', { name: 'Make bigger', exact: true })).toBeDisabled();
  await close.click();
  await expect(opener).toBeFocused();
  expect(await videos.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-synthetic-stream')))).toEqual(streams);
});

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
const fixtureUserId = "507f1f77bcf86cd799439011";

function fixtureRosterUserId(side: "mine" | "theirs", index: number) {
  if (side === "mine" && index === 0) return fixtureUserId;
  return `507f1f77bcf86cd7994390${((side === "mine" ? 0x40 : 0x60) + index).toString(16).padStart(2, "0")}`;
}

function fixtureMember(side: "mine" | "theirs", index: number) {
  const local = side === "mine" && index === 0;
  return {
    memberId: `${side}-member-${index + 1}`,
    userId: fixtureRosterUserId(side, index),
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

async function installEncounterFixture(page: Page, options: {
  ended?: boolean;
  disconnectDelayMs?: number;
  disconnectStatus?: number;
  chatFailures?: number;
  reportFailures?: number;
} = {}) {
  let socketSend: ((message: string) => void) | null = null;
  let socketReadyResolve: (() => void) | null = null;
  const socketReady = new Promise<void>(resolve => { socketReadyResolve = resolve; });
  let chatAttempts = 0;
  let remainingChatFailures = options.chatFailures ?? 0;
  let remainingReportFailures = options.reportFailures ?? 0;
  const submittedReports: Record<string, unknown>[] = [];

  await page.routeWebSocket(/socket\.io/, socket => {
    socketSend = message => socket.send(message);
    socket.send(`0${JSON.stringify({
      sid: "fixture-engine",
      upgrades: [],
      pingInterval: 60_000,
      pingTimeout: 60_000,
      maxPayload: 1_000_000,
    })}`);
    socket.onMessage(message => {
      const text = typeof message === "string" ? message : message.toString();
      if (text === "2") {
        socket.send("3");
        return;
      }
      if (text.startsWith("40")) {
        socket.send(`40${JSON.stringify({ sid: "fixture-socket" })}`);
        socketReadyResolve?.();
        socketReadyResolve = null;
        return;
      }
      const event = text.match(/^42(\d*)(\[[\s\S]*\])$/);
      if (!event) return;
      const ackId = event[1];
      const [name, payload] = JSON.parse(event[2]) as [string, Record<string, unknown>];
      if (name === "send_message" && ackId) {
        chatAttempts += 1;
        if (remainingChatFailures > 0) {
          remainingChatFailures -= 1;
          socket.send(`43${ackId}[${JSON.stringify({ ok: false, error: "Message not delivered. Try again." })}]`);
          return;
        }
        socket.send(`43${ackId}[${JSON.stringify({
          ok: true,
          message: {
            id: `fixture-message-${chatAttempts}`,
            clientMessageId: payload.clientMessageId,
            text: payload.text,
            senderId: payload.senderId,
            senderName: payload.senderName,
            encounterId: payload.encounterId,
            squadId: payload.squadId,
            ts: Date.now(),
          },
        })}]`);
        return;
      }
      if (name === "report_squad" && ackId) {
        submittedReports.push(payload);
        if (remainingReportFailures > 0) {
          remainingReportFailures--;
          socket.send(`43${ackId}[${JSON.stringify({ ok: false, error: "Report was not saved. Try again." })}]`);
          return;
        }
        socket.send(`43${ackId}[${JSON.stringify({ ok: true, reportId: "fixture-report", status: "open" })}]`);
      }
    });
  });

  const user = {
    id: fixtureUserId,
    email: "fixture@giggle.local",
    name: "Maya",
    isPremium: false,
    isApproved: true,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    accountStatus: "active" as const,
  };
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    email: user.email,
    name: user.name,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    accountStatus: "active",
  })).toString("base64url");
  await page.addInitScript(({ sessionValue }) => {
    localStorage.setItem("giggle.session", sessionValue);
    localStorage.setItem("giggle.look", JSON.stringify({ skin: "soft", palette: "honey", mode: "dark" }));
    // Keep the call chrome shown so fixture clicks never race the idle fade;
    // "call chrome fades when idle and wakes on input" covers the fade itself.
    if (!sessionStorage.getItem("giggle.test.chromeFade")) localStorage.setItem("giggle.callChrome", "always");
  }, { sessionValue: JSON.stringify({ token: `e30.${payload}.fixture`, user }) });

  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    // the site asks the API whether stranger matching is on
    if (path === "/api/features") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { strangerDiscovery: true } }) });
      return;
    }
    if (path === "/api/me/profile") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: user }),
      });
      return;
    }
    if (path === "/api/me/age/verification-status") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { status: "verified", ageVerified: true } }),
      });
      return;
    }
    const encounterMatch = path.match(/^\/api\/matchmaking\/encounters\/(fixture-(\d+)v\2)$/);
    if (encounterMatch) {
      const count = Number(encounterMatch[2]);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { ...fixtureEncounter(encounterMatch[1], count), ...(options.ended ? { status: "ended" } : {}) } }),
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
      if (options.disconnectDelayMs) await new Promise(resolve => setTimeout(resolve, options.disconnectDelayMs));
      await route.fulfill({
        status: options.disconnectStatus ?? 200,
        contentType: "application/json",
        body: JSON.stringify(options.disconnectStatus
          ? { ok: false, error: { message: "Ending is temporarily unavailable." } }
          : { ok: true, data: { encounterId: "fixture", disconnected: true } }),
      });
      return;
    }
    if (path === "/api/users/block") {
      const userIds = route.request().postDataJSON()?.userIds ?? [];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { status: "blocked", userIds } }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "fixture_missing", message: `No fixture for ${path}` } }),
    });
  });

  return {
    submittedReports: () => submittedReports,
    chatAttempts: () => chatAttempts,
    emitSquadEnded: async (endedBySquadId = "fixture-opponents") => {
      await socketReady;
      await page.waitForTimeout(0);
      socketSend?.(`42["ENCOUNTER_ENDED",${JSON.stringify({
        encounterId: "fixture-2v2",
        reason: "squad_disconnected",
        endedBySquadId,
      })}]`);
    },
  };
}

test("an ended encounter link shows recovery actions without starting media", async ({ page }) => {
  await installEncounterFixture(page, { ended: true });
  const mediaRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/encounters/token')) mediaRequests.push(request.url()); });
  await page.goto('/encounter?squad=fixture-squad&enc=fixture-2v2');
  await expect(page.getByRole('heading', { name: 'This call has ended', exact: true })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Encounter controls' })).toHaveCount(0);
  expect(mediaRequests).toEqual([]);
  await page.getByRole('button', { name: 'Back to lobby', exact: true }).click();
  await expect(page).toHaveURL(/\/lobby\?squad=fixture-squad/);
});

test("call action focus enters the popup and returns after Escape and leave cancellation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One project covers shared keyboard controls');
  await installEncounterFixture(page);
  await openFixture(page, 2);
  const more = page.getByRole('button', { name: 'More', exact: true });
  const wave = page.getByRole('button', { name: 'React: Wave', exact: true });
  await more.press('Enter');
  await expect(wave).toBeFocused();
  await wave.press('Escape');
  await expect(more).toBeFocused();
  await expect(page.getByRole('group', { name: 'More call actions', exact: true })).toHaveCount(0);
  await more.press('Enter');
  const leave = page.getByRole('button', { name: 'Leave call', exact: true });
  await leave.press('Enter');
  await expect(page.getByRole('group', { name: 'More call actions', exact: true })).toHaveCount(0);
  const keepTalking = page.getByRole('button', { name: 'Keep talking', exact: true });
  await expect(keepTalking).toBeFocused();
  await keepTalking.press('Enter');
  await expect(leave).toBeFocused();
  for (const [action, title] of [
    ['Block opponent squad', 'Block opponent squad?'],
    ['Next squad', 'Find another squad?'],
    ['End encounter', 'End the call?'],
  ]) {
    await more.press('Enter');
    await page.getByRole('group', { name: 'More call actions', exact: true })
      .getByRole('button', { name: action, exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const cancel = dialog.getByRole('button', { name: 'Keep talking', exact: true });
    await expect(cancel).toBeFocused();
    await cancel.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
  }
});

test("report confirmation preserves its draft after failure without clearing media recovery", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One project covers the shared reporting form');
  const fixture = await installEncounterFixture(page, { reportFailures: 1 });
  await openFixture(page, 2);
  const recovery = page.getByTestId('media-recovery-notice');
  await expect(recovery).toBeVisible();
  const recoveryText = await recovery.innerText();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Report opponent squad', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Report opponent squad', exact: true });
  const reason = dialog.getByRole('combobox', { name: 'Reason', exact: true });
  await expect(reason).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Send report', exact: true })).toBeDisabled();
  await reason.selectOption('spam');
  const details = dialog.getByRole('textbox', { name: 'Details (optional)', exact: true });
  await details.fill('Synthetic local QA: repeated invite spam.');
  await dialog.getByRole('button', { name: 'Send report', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Report was not saved. Try again.');
  await expect(reason).toHaveValue('spam');
  await expect(details).toHaveValue('Synthetic local QA: repeated invite spam.');
  await expect(recovery).toHaveText(recoveryText);
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused();
  await expect(page.getByText('Reported — thanks for keeping Giggle safe', { exact: true })).toBeVisible();
  expect(fixture.submittedReports()).toHaveLength(2);
  expect(fixture.submittedReports()[1].category).toBe('spam');
  expect(fixture.submittedReports()[1].details).toBe('Synthetic local QA: repeated invite spam.');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reported', exact: true })).toBeDisabled();
});

test("ending shows immediate feedback during a delayed failure and keeps recovery visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One desktop project covers the shared end action");
  await installEncounterFixture(page, { disconnectDelayMs: 1200, disconnectStatus: 503 });
  const { controls } = await openFixture(page, 2);

  await controls.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "End encounter", exact: true }).click();
  const endDialog = page.getByRole("dialog", { name: "End the call?" });
  await endDialog.getByRole("button", { name: "End encounter" }).click();

  await expect(endDialog.getByRole("button", { name: "End encounter", exact: true })).toContainText("Ending…", { timeout: 500 });
  await expect(endDialog.getByRole("button", { name: "Keep talking" })).toBeDisabled({ timeout: 500 });
  await expect(page).toHaveURL(/\/encounter\?squad=fixture-squad/);
  await expect(endDialog.getByText(/couldn't end this encounter yet/i)).toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId("media-recovery-notice")).toBeVisible({ timeout: 3000 });
});

test("opponent blocking is confirmed and leaves only after both server steps", async ({ page }, testInfo) => {
  test.skip(!["phone", "desktop"].includes(testInfo.project.name), "One compact and one full call cover the block flow");
  const calls: Array<{ path: string; body?: unknown }> = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/users/block" || path === "/api/encounters/disconnect") {
      calls.push({ path, body: request.postDataJSON() });
    }
  });
  await installEncounterFixture(page);
  const { controls } = await openFixture(page, 2);

  await controls.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Block opponent squad" }).click();
  const dialog = page.getByRole("dialog", { name: "Block opponent squad?" });
  await expect(dialog).toContainText("Every visible member of the opponent squad will be blocked");
  await dialog.getByRole("button", { name: "Keep talking" }).click();
  await expect(dialog).toBeHidden();

  await controls.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Block opponent squad" }).click();
  await dialog.getByRole("button", { name: "Block opponent squad" }).click();
  await expect(page).toHaveURL(/\/home$/);

  expect(calls.map(call => call.path)).toEqual(["/api/users/block", "/api/encounters/disconnect"]);
  expect(calls[0].body).toEqual({
    userIds: [fixtureRosterUserId("theirs", 0), fixtureRosterUserId("theirs", 1)],
  });
});

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

async function injectSyntheticVideo(frame: Locator, width: number, height: number) {
  await frame.locator("[data-media-host]").evaluate((host, dimensions) => {
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#17171d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#6d52ff";
      context.fillRect(0, 0, canvas.width / 3, canvas.height);
      context.fillStyle = "#2fe6c8";
      context.fillRect(canvas.width * 2 / 3, 0, canvas.width / 3, canvas.height);
    }
    const video = document.createElement("video");
    video.poster = canvas.toDataURL("image/png");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: dimensions.width });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: dimensions.height });
    host.replaceChildren(video);
    video.dispatchEvent(new Event("loadedmetadata"));
  }, { width, height });
}

async function expectMediaInsideFrame(frame: Locator) {
  const geometry = await frame.evaluate(node => {
    const frameRect = node.getBoundingClientRect();
    const host = node.querySelector("[data-media-host]");
    const media = host?.querySelector("video");
    const hostRect = host?.getBoundingClientRect();
    const mediaRect = media?.getBoundingClientRect();
    return {
      frame: { left: frameRect.left, top: frameRect.top, right: frameRect.right, bottom: frameRect.bottom },
      host: hostRect && { left: hostRect.left, top: hostRect.top, right: hostRect.right, bottom: hostRect.bottom },
      media: mediaRect && { left: mediaRect.left, top: mediaRect.top, right: mediaRect.right, bottom: mediaRect.bottom },
      frameOverflow: getComputedStyle(node).overflow,
      hostOverflow: host ? getComputedStyle(host).overflow : "missing",
      objectFit: media ? getComputedStyle(media).objectFit : "missing",
    };
  });
  expect(geometry.frameOverflow).toMatch(/hidden|clip/);
  expect(geometry.hostOverflow).toMatch(/hidden|clip/);
  expect(geometry.host).not.toBeNull();
  expect(geometry.media).not.toBeNull();
  for (const box of [geometry.host!, geometry.media!]) {
    expect(box.left).toBeGreaterThanOrEqual(geometry.frame.left - 0.5);
    expect(box.top).toBeGreaterThanOrEqual(geometry.frame.top - 0.5);
    expect(box.right).toBeLessThanOrEqual(geometry.frame.right + 0.5);
    expect(box.bottom).toBeLessThanOrEqual(geometry.frame.bottom + 0.5);
  }
  return geometry.objectFit;
}

test("fixture encounter keeps media, chat, and controls usable across resize", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  test.skip(!["phone", "desktop"].includes(testInfo.project.name), "One compact and one full call cover the live-media contract");
  await installEncounterFixture(page);
  const { stage, controls } = await openFixture(page, 2);
    await expect(stage).toBeVisible();
    await expect(controls).toBeVisible();
    await expect(controls.getByRole("button", { name: /microphone/i })).toBeVisible();
    await expect(controls.getByRole("button", { name: /camera/i })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Chat" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "More" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Leave call", exact: true })).toBeVisible();
    await expect.poll(() => controls.evaluate(node => getComputedStyle(node).opacity)).toBe("1");

    const frames = stage.locator("[data-media-frame]");
    expect(await frames.count()).toBeGreaterThanOrEqual(2);
    for (const [index, frame] of (await frames.all()).entries()) {
      await injectSyntheticVideo(frame, index % 2 === 0 ? 1280 : 720, index % 2 === 0 ? 720 : 1280);
      await expect.poll(() => frame.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
      const box = await frame.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);

      await expect.poll(async () => {
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
        return signal.range > 20 && signal.litRatio > 0.04;
      }, { timeout: 10_000 }).toBe(true);
    }

    await expect(stage.locator("[data-layout-kind]")).toBeVisible();
    // Viewer-local sizing: make someone bigger (others re-flow), then keep that size.
    const firstCell = stage.locator("[data-participant-id]").first();
    const sizeBefore = await firstCell.boundingBox();
    await firstCell.getByRole("button", { name: /options$/ }).click();
    await page.getByRole("button", { name: "Make bigger", exact: true }).click();
    await expect(firstCell).toHaveAttribute("data-weight", "2");
    await expect.poll(async () => { const box = await firstCell.boundingBox(); return box!.width * box!.height; })
      .toBeGreaterThan(sizeBefore!.width * sizeBefore!.height * 1.2);
    await firstCell.getByRole("button", { name: /options$/ }).click();
    await page.getByRole("button", { name: /^Keep this size/ }).click();
    await expect(firstCell).toHaveAttribute("data-pinned", "true");
    const more = controls.getByRole("button", { name: "More", exact: true });

    const chat = controls.getByRole("button", { name: "Chat" });
    await chat.click();
    const chatInput = page.getByRole("textbox", { name: "Chat message" });
    await expect(chatInput).toBeVisible();
    if (testInfo.project.name === "phone") {
      await expect(page.getByRole("complementary", { name: "Call chat" })).toBeVisible();
      await expect(stage).toBeHidden();
      // the chat takes the screen; the call controls step aside so the composer is free
      await expect(controls).toBeHidden();
    }
    const chatText = `hello-${testInfo.project.name}-${Date.now()}`;
    await chatInput.fill(chatText);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(chatText, { exact: true })).toHaveCount(1);

    await page.getByRole("button", { name: testInfo.project.name === "phone" ? "Back to video" : "Close chat" }).click();
    await expect(chat).toBeFocused();
    await chat.click();
    await expect(page.getByText(chatText, { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: testInfo.project.name === "phone" ? "Back to video" : "Close chat" }).click();

    const localFrame = stage.locator('[data-local="true"]').first();
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
    await more.click();
    await page.getByRole("button", { name: "React: Wave" }).click();
    await expect(localFrame.locator("[data-reaction]")).toHaveCount(1);
    const visibleFor = await reactionDuration;
    expect(visibleFor).toBeGreaterThanOrEqual(1700);
    expect(visibleFor).toBeLessThanOrEqual(2100);
    await expect(localFrame.locator("[data-reaction]")).toHaveCount(0);

    await more.click();
    await page.getByRole("button", { name: "Report opponent squad" }).click();
    await page.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('other');
    await page.getByRole('button', { name: 'Send report', exact: true }).click();
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

    await controls.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: "End encounter", exact: true }).click();
    const endDialog = page.getByRole("dialog", { name: "End the call?" });
    await expect(endDialog).toBeVisible();
    await endDialog.getByRole("button", { name: "Keep talking" }).click();
    await expect(endDialog).toBeHidden();
    await expect(stage).toBeVisible();
    await controls.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: "End encounter", exact: true }).click();
    await expect(endDialog).toBeVisible();
    await endDialog.getByRole("button", { name: "End encounter" }).click();
    await expect(page).toHaveURL(/\/home$/);
});

test("encounter chat retry is acknowledged without duplicating the sender", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One fixture-backed desktop call covers transport retry");
  const retryText = `retry-${Date.now()}`;
  const fixture = await installEncounterFixture(page, { chatFailures: 1 });
  const { controls } = await openFixture(page, 2);
  await controls.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("textbox", { name: "Chat message" }).fill(retryText);
  await page.getByRole("button", { name: "Send message" }).click();
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  expect(fixture.chatAttempts()).toBe(1);

  const message = page.getByText(retryText, { exact: true });
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(message).toHaveCount(1);
  expect(fixture.chatAttempts()).toBe(2);
});

test("a squadmate ending the call shows recovery and returns our squad to its lobby", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One project covers the shared squad lifecycle");
  const fixture = await installEncounterFixture(page);
  await openFixture(page, 2);
  const toLobby = page.waitForURL(/\/lobby\?squad=fixture-squad/, { waitUntil: "commit" });
  await fixture.emitSquadEnded('fixture-squad');
  await expect(page.getByRole('heading', { name: 'The call ended', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find another squad', exact: true })).toBeVisible();
  await toLobby;
});

test("opponent ending preserves a clear recovery state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "One phone call covers the remote-ended state");
  const fixture = await installEncounterFixture(page);
  const { stage } = await openFixture(page, 2);
  await expect(stage).toBeVisible();
  await fixture.emitSquadEnded();
  await expect(page.getByText("Chaos Club left", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Find another now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to lobby" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-30/encounter/states/phone-opponent-ended.jpg",
    type: "jpeg",
    quality: 82,
  });
  // the fixture has no lobby data (the lobby then sends it home), so catch the hop itself
  const toLobby = page.waitForURL(/\/lobby\?squad=fixture-squad/, { waitUntil: "commit" });
  await page.getByRole("button", { name: "Back to lobby" }).click();
  await toLobby;
});

test("mocked rosters stay usable across the viewport matrix", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The test supplies its own complete viewport matrix");
  await installEncounterFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const [viewportName, width, height] of viewportMatrix) {
    await page.setViewportSize({ width, height });
    for (const count of fixtureCounts) {
      const { stage, controls } = await openFixture(page, count);
      // Every roster uses the focus grid (same-size tiles per squad; viewer zoom/pin).
      await expect(stage.locator('[data-layout-kind="focus-grid"]')).toBeVisible();

      const frames = stage.locator("[data-media-frame]");
      await expect(frames).toHaveCount(count * 2);
      // Each tile's options button is named after its person.
      const participantLabels = new Set(await frames.evaluateAll(nodes => nodes.map(node => node.querySelector('button[aria-haspopup="dialog"]')?.getAttribute("aria-label"))));
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
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect(box && box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      }

      if (count === 2) {
        await controls.getByRole('button', { name: 'More', exact: true }).press('Enter');
        const actions = page.getByRole('group', { name: 'More call actions', exact: true });
        await expect(actions).toBeVisible();
        await expect(page.getByRole('button', { name: 'React: Wave', exact: true })).toBeFocused();
        const menu = await actions.boundingBox();
        expect(menu?.x).toBeGreaterThanOrEqual(0);
        expect(menu?.y).toBeGreaterThanOrEqual(0);
        expect(menu && menu.x + menu.width).toBeLessThanOrEqual(width);
        expect(menu && menu.y + menu.height).toBeLessThanOrEqual(height);
        for (const button of await actions.getByRole('button').all()) {
          const box = await button.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(box?.x).toBeGreaterThanOrEqual(0);
          expect(box && box.x + box.width).toBeLessThanOrEqual(width);
        }
        await page.getByRole('button', { name: 'React: Wave', exact: true }).press('Escape');
        await expect(controls.getByRole('button', { name: 'More', exact: true })).toBeFocused();
      }

      await page.screenshot({
        path: `artifacts/visual-audit/2026-07-30/encounter/geometry/${viewportName}-${count}v${count}.jpg`,
        type: "jpeg",
        quality: 78,
      });
    }
  }
});

test("mixed portrait, square, landscape, and ultrawide feeds stay inside their frames", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One project supplies the complete synthetic media matrix");
  await installEncounterFixture(page);

  for (const [viewportName, width, height] of [
    ["phone", 390, 844],
    ["phone-landscape", 844, 390],
    ["desktop", 1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    const { stage } = await openFixture(page, 2);
    const frames = stage.locator("[data-media-frame]");
    const dimensions = [[1080, 1920], [1080, 1080], [1920, 1080], [2560, 1080]] as const;
    await expect(frames).toHaveCount(4);
    for (let index = 0; index < dimensions.length; index += 1) {
      const [mediaWidth, mediaHeight] = dimensions[index];
      await injectSyntheticVideo(frames.nth(index), mediaWidth, mediaHeight);
      // The adaptive grid crops by default (tiles take the camera's shape once a
      // live feed reports it; this fixture has no Agora feed, so tiles stay square).
      // Whatever the shape, the picture must never spill outside its frame.
      await expect(frames.nth(index)).toHaveAttribute("data-media-fit", "crop");
      expect(await expectMediaInsideFrame(frames.nth(index))).toBe("cover");
    }
    await page.screenshot({
      path: `artifacts/visual-audit/2026-08-02/encounter/mixed-${viewportName}.jpg`,
      type: "jpeg",
      quality: 82,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const { stage } = await openFixture(page, 3);
  const compactFrames = stage.locator('[data-media-frame][data-media-fit="crop"]');
  expect(await compactFrames.count()).toBeGreaterThan(0);
  await injectSyntheticVideo(compactFrames.first(), 1080, 1920);
  expect(await expectMediaInsideFrame(compactFrames.first())).toBe("cover");
});

test("mocked call chrome keeps dialogs, themes, and zoom usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One project supplies its own focused visual states");
  await installEncounterFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const { stage, controls } = await openFixture(page, 3);

  const chat = controls.getByRole("button", { name: "Chat" });
  await chat.click();
  const chatPanel = page.getByRole("complementary", { name: "Call chat" });
  await expect(chatPanel).toBeVisible();
  await expect(stage).toBeHidden();
  // phone chat takes the screen; the controls step aside so they never cover the composer
  await expect(controls).toBeHidden();
  const composer = await page.getByRole("textbox", { name: "Chat message" }).boundingBox();
  expect(composer && composer.y + composer.height).toBeLessThanOrEqual(844);
  const closeChat = page.getByRole("button", { name: "Back to video" });
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
  const menuBox = await moreActions.boundingBox();
  expect(menuBox?.x).toBeGreaterThanOrEqual(12);
  expect(menuBox && menuBox.x + menuBox.width).toBeLessThanOrEqual(390 - 12);
  for (const button of await moreActions.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box && box.x + box.width).toBeLessThanOrEqual(390);
  }
  await expect(page.getByRole("button", { name: "Report opponent squad" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-30/encounter/states/phone-more.jpg",
    type: "jpeg",
    quality: 82,
  });
  await page.keyboard.press("Escape");

  await controls.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "End encounter", exact: true }).click();
  const endDialog = page.getByRole("dialog", { name: "End the call?" });
  await expect(endDialog).toBeVisible();
  await expect.poll(() => endDialog.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  await page.screenshot({
    path: "artifacts/visual-audit/2026-07-30/encounter/states/phone-end-confirmation.jpg",
    type: "jpeg",
    quality: 82,
  });
  await endDialog.getByRole("button", { name: "Keep talking" }).click();
  await expect(stage).toBeVisible();

  const shell = page.getByTestId("encounter-shell");
  const videoStage = page.getByTestId("video-stage");
  const header = page.getByTestId("encounter-header");
  for (const mode of ["dark", "light", "auto"] as const) {
    await page.evaluate(value => {
      localStorage.setItem("giggle.look", JSON.stringify({ skin: "soft", palette: "honey", mode: value }));
      const resolved = value === "auto"
        ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : value;
      document.documentElement.setAttribute("data-mode", resolved);
      document.documentElement.setAttribute("data-theme", resolved);
    }, mode);
    await page.screenshot({
      path: `artifacts/visual-audit/2026-08-02/encounter/modes/phone-${mode}.jpg`,
      type: "jpeg",
      quality: 82,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const stageBackground = await videoStage.evaluate(node => getComputedStyle(node).backgroundColor);
  const accents = new Set<string>();
  const shellBackgrounds = new Set<string>();
  const headerBackgrounds = new Set<string>();
  for (const mode of ["dark", "light", "auto"] as const) {
    await page.evaluate(value => {
      localStorage.setItem("giggle.look", JSON.stringify({ skin: "soft", palette: "honey", mode: value }));
      const resolved = value === "auto"
        ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : value;
      document.documentElement.setAttribute("data-mode", resolved);
      document.documentElement.setAttribute("data-theme", resolved);
    }, mode);
    await expect.poll(() => shell.evaluate(node => getComputedStyle(node).getPropertyValue("--accent").trim())).not.toBe("");
    accents.add(await shell.evaluate(node => getComputedStyle(node).getPropertyValue("--accent").trim()));
    shellBackgrounds.add(await shell.evaluate(node => getComputedStyle(node).backgroundColor));
    headerBackgrounds.add(await header.evaluate(node => getComputedStyle(node).backgroundColor));
    expect(await videoStage.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(stageBackground);
    await page.screenshot({
      path: `artifacts/visual-audit/2026-07-30/encounter/modes/${mode}.jpg`,
      type: "jpeg",
      quality: 82,
    });
  }
  // Calls always render the palette's DARK values (.gg-call-theme), so the
  // call chrome must look the same whatever app mode is saved.
  expect(accents.size).toBe(1);
  expect(shellBackgrounds.size).toBe(1);
  expect(headerBackgrounds.size).toBe(1);
  await expect(page.getByText("vs", { exact: true })).toHaveCount(0);

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


test("personal leave updates only this member and does not end the encounter", async ({ page }) => {
  await installEncounterFixture(page);
  const mutations: string[] = [];
  page.on("request", request => { if (request.method() === "POST") mutations.push(new URL(request.url()).pathname); });
  await page.goto("/encounter?squad=fixture-squad&enc=fixture-2v2");
  await page.getByRole("button", { name: "Leave call", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Leave this call?" });
  await expect(dialog).toContainText("Your squad can keep talking.");
  const presence = page.waitForRequest(request => request.url().includes("/encounter-video") && request.postDataJSON()?.inEncounterVideo === false);
  await dialog.getByRole("button", { name: "Confirm leave call", exact: true }).click();
  await presence;
  await expect(page).toHaveURL(/\/home$/);
  expect(mutations).not.toContain("/api/encounters/disconnect");
});

test("call chrome fades when idle and wakes on input", async ({ page }, testInfo) => {
  test.skip(!["desktop", "laptop"].includes(testInfo.project.name), "One wide project covers the idle fade");
  await page.addInitScript(() => sessionStorage.setItem("giggle.test.chromeFade", "1"));
  await installEncounterFixture(page);
  const { stage } = await openFixture(page, 2);
  await expect(stage).toBeVisible();
  const shell = page.getByTestId("encounter-shell");
  await expect(shell).toHaveAttribute("data-chrome", "shown");
  // rest the pointer over the video (hovering the header or controls keeps them shown)
  const box = await stage.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(shell).toHaveAttribute("data-chrome", "hidden", { timeout: 8000 });
  await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2 + 20);
  await expect(shell).toHaveAttribute("data-chrome", "shown");
  // keyboard users bring it back by focusing a control
  await expect(shell).toHaveAttribute("data-chrome", "hidden", { timeout: 8000 });
  await page.keyboard.press("Tab");
  await expect(shell).toHaveAttribute("data-chrome", "shown");
});
