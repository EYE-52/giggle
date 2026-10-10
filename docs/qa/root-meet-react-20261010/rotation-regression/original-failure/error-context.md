# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: encounter.spec.ts >> real participant controls preserve synthetic streams and restore focus
- Location: e2e/encounter.spec.ts:26:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - status "Viewport resize check": "844×390 after two frames: snapped · 1 outside"
    - generic [ref=e3]:
      - group "Their squad · 2":
        - generic [ref=e5]:
          - generic [ref=e6]:
            - img "Giggle character" [ref=e10]:
              - img [ref=e53]
            - generic [ref=e56]: Camera off
          - generic:
            - generic: Theo
          - button "Theo's options" [ref=e57] [cursor=pointer]:
            - generic [ref=e58]: •••
          - group "Theo's tile size" [ref=e59]:
            - button "Make Theo smaller" [disabled] [ref=e60]:
              - img [ref=e61]
            - button "Make Theo bigger" [ref=e63] [cursor=pointer]:
              - img [ref=e64]
            - button "Keep Theo's size" [ref=e66] [cursor=pointer]:
              - img [ref=e67]
        - generic [ref=e70]:
          - generic [ref=e71]:
            - img [ref=e75]:
              - img [ref=e113]
            - generic [ref=e116]: Camera off
          - generic:
            - generic: Alexandria-Rose
          - button "Alexandria-Rose's options" [ref=e119] [cursor=pointer]:
            - generic [ref=e120]: •••
          - group "Alexandria-Rose's tile size" [ref=e121]:
            - button "Make Alexandria-Rose smaller" [disabled] [ref=e122]:
              - img [ref=e123]
            - button "Make Alexandria-Rose bigger" [ref=e125] [cursor=pointer]:
              - img [ref=e126]
            - button "Keep Alexandria-Rose's size" [ref=e128] [cursor=pointer]:
              - img [ref=e129]
      - group "Your squad · 2":
        - generic [ref=e132]:
          - generic [ref=e133]:
            - img [ref=e137]:
              - img [ref=e172]
            - generic [ref=e175]: Camera off
          - generic:
            - generic: You
          - button "Your options" [ref=e178] [cursor=pointer]:
            - generic [ref=e179]: •••
          - group "Your tile size" [ref=e180]:
            - button "Make yourself smaller" [disabled] [ref=e181]:
              - img [ref=e182]
            - button "Make yourself bigger" [ref=e184] [cursor=pointer]:
              - img [ref=e185]
            - button "Keep your size" [ref=e187] [cursor=pointer]:
              - img [ref=e188]
        - generic [ref=e191]:
          - generic [ref=e192]:
            - img [ref=e196]:
              - img [ref=e237]
            - generic [ref=e240]: Camera off
          - generic:
            - generic: Maya
            - generic "Muted for you": · Muted for you
          - button "Maya's options" [active] [ref=e243] [cursor=pointer]:
            - generic [ref=e244]: •••
          - group "Maya's tile size" [ref=e245]:
            - button "Make Maya smaller" [disabled] [ref=e246]:
              - img [ref=e247]
            - button "Make Maya bigger" [disabled] [ref=e249]:
              - img [ref=e250]
            - button "Let Maya's size change again" [pressed] [ref=e252] [cursor=pointer]:
              - img [ref=e253]
  - alert [ref=e255]
```

# Test source

```ts
  1   | import { expect, test, type Locator, type Page } from "@playwright/test";
  2   | 
  3   | test("failed viewer mute keeps the menu open and retry preserves video", async ({ page }) => {
  4   |   await page.goto('/dev/call-stage?variant=controls&m=2&t=2&shapes=16:9,9:16,off,4:3&muteFailure=once');
  5   |   const videos = page.locator('[data-media-host] video');
  6   |   await expect(videos).toHaveCount(3);
  7   |   const streams = await videos.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-synthetic-stream')));
  8   |   const opener = page.getByRole('button', { name: "Maya's options", exact: true });
  9   |   await opener.press('Enter');
  10  |   const menu = page.getByRole('dialog', { name: "Maya's options", exact: true });
  11  |   await menu.getByRole('button', { name: 'Mute for me', exact: true }).click();
  12  |   await expect(menu.getByRole('alert')).toHaveText('Could not change audio. Try again.');
  13  |   await expect.poll(() => menu.evaluate(el => {
  14  |     const box = el.getBoundingClientRect();
  15  |     return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
  16  |   })).toBe(true);
  17  |   await expect(menu.getByRole('button', { name: 'Mute for me', exact: true })).toBeEnabled();
  18  |   await expect(page.getByLabel('Muted for you', { exact: true })).toHaveCount(0);
  19  |   await menu.getByRole('button', { name: 'Mute for me', exact: true }).click();
  20  |   await expect(menu).toHaveCount(0);
  21  |   await expect(opener).toBeFocused();
  22  |   await expect(page.getByLabel('Muted for you', { exact: true })).toBeVisible();
  23  |   expect(await videos.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-synthetic-stream')))).toEqual(streams);
  24  | });
  25  | 
  26  | test("real participant controls preserve synthetic streams and restore focus", async ({ page }) => {
  27  |   await page.goto('/dev/call-stage?variant=controls&m=2&t=2&shapes=16:9,9:16,off,4:3');
  28  |   const videos = page.locator('[data-media-host] video');
  29  |   await expect(videos).toHaveCount(3);
  30  |   await expect.poll(() => videos.evaluateAll(nodes => nodes.every(node => (node as HTMLVideoElement).readyState >= 2))).toBe(true);
  31  |   const streams = await videos.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-synthetic-stream')));
  32  |   const tile = page.locator('[data-participant-id="mine-2"]');
  33  |   await expect(tile.locator('[aria-hidden="true"]').first()).toBeAttached();
  34  |   const opener = page.getByRole('button', { name: "Maya's options", exact: true });
  35  |   await opener.press('Enter');
  36  |   const menu = page.getByRole('dialog', { name: "Maya's options", exact: true });
  37  |   const close = menu.getByRole('button', { name: 'Close person options', exact: true });
  38  |   await expect(close).toBeFocused();
  39  |   expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  40  |   await close.press('Shift+Tab');
  41  |   await expect(menu.getByRole('button', { name: /^Keep this size/ })).toBeFocused();
  42  |   await menu.getByRole('button', { name: /^Keep this size/ }).press('Tab');
  43  |   await expect(close).toBeFocused();
  44  |   await menu.getByRole('button', { name: 'Mute for me', exact: true }).click();
  45  |   await expect(opener).toBeFocused();
  46  |   await expect(tile.getByLabel('Muted for you', { exact: true })).toBeVisible();
  47  |   expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  48  |   await opener.press('Enter');
  49  |   await expect(menu.getByRole('button', { name: 'Unmute for me', exact: true })).toBeEnabled();
  50  |   await menu.getByRole('button', { name: 'Adjust view', exact: true }).click();
  51  |   const framing = page.getByRole('dialog', { name: "Maya's view", exact: true });
  52  |   await expect(framing.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  53  |   await framing.getByRole('button', { name: 'Full view', exact: true }).click();
  54  |   await framing.getByRole('slider', { name: "Zoom Maya's view", exact: true }).press('ArrowRight');
  55  |   await expect(tile.locator('[data-media-frame]')).toHaveAttribute('data-media-fit', 'fit');
  56  |   await expect(tile.locator('[data-media-frame]')).toHaveCSS('--person-zoom', '1.1');
  57  |   await framing.getByRole('button', { name: 'Reset view', exact: true }).click();
  58  |   await expect(tile.locator('[data-media-frame]')).toHaveCSS('--person-zoom', '1');
  59  |   await framing.getByRole('button', { name: 'Close', exact: true }).press('Escape');
  60  |   await expect(opener).toBeFocused();
  61  |   await opener.press('Enter');
  62  |   await menu.getByRole('button', { name: 'Make bigger', exact: true }).click();
  63  |   await expect(tile).toHaveAttribute('data-weight', '2');
  64  |   await opener.press('Enter');
  65  |   await menu.getByRole('button', { name: /^Keep this size/ }).click();
  66  |   await expect(tile).toHaveAttribute('data-pinned', 'true');
  67  |   await page.setViewportSize({ width: 844, height: 390 });
  68  |   await expect(page.getByLabel('Viewport resize check')).toContainText('844×390 after two frames:');
  69  |   const rotated = await page.evaluate(async () => {
  70  |     await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  71  |     const cells = Array.from(document.querySelectorAll('[data-participant-id]'));
  72  |     return {
  73  |       animating: document.querySelector('[data-focus-stage]')?.getAttribute('data-animating'),
  74  |       outside: cells.some(cell => { const box = cell.getBoundingClientRect(); return box.left < -0.5 || box.top < -0.5 || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5; }),
  75  |     };
  76  |   });
  77  |   expect(rotated.animating).not.toBe('true');
> 78  |   expect(rotated.outside).toBe(false);
      |                           ^ Error: expect(received).toBe(expected) // Object.is equality
  79  |   await opener.press('Enter');
  80  |   await expect(menu.getByRole('button', { name: /^Make bigger\s*Size is kept$/ })).toBeDisabled();
  81  |   await close.click();
  82  |   await expect(opener).toBeFocused();
  83  |   expect(await videos.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-synthetic-stream')))).toEqual(streams);
  84  | });
  85  | 
  86  | test.setTimeout(240_000);
  87  | 
  88  | const viewportMatrix = [
  89  |   ["compact-phone", 320, 568],
  90  |   ["phone", 390, 844],
  91  |   ["large-phone", 430, 932],
  92  |   ["phone-landscape", 844, 390],
  93  |   ["small-tablet", 768, 1024],
  94  |   ["tablet", 834, 1194],
  95  |   ["laptop", 1280, 800],
  96  |   ["desktop", 1440, 900],
  97  |   ["wide", 1728, 1117],
  98  | ] as const;
  99  | 
  100 | const fixtureCounts = [1, 2, 3, 4, 8] as const;
  101 | const fixtureUserId = "507f1f77bcf86cd799439011";
  102 | 
  103 | function fixtureRosterUserId(side: "mine" | "theirs", index: number) {
  104 |   if (side === "mine" && index === 0) return fixtureUserId;
  105 |   return `507f1f77bcf86cd7994390${((side === "mine" ? 0x40 : 0x60) + index).toString(16).padStart(2, "0")}`;
  106 | }
  107 | 
  108 | function fixtureMember(side: "mine" | "theirs", index: number) {
  109 |   const local = side === "mine" && index === 0;
  110 |   return {
  111 |     memberId: `${side}-member-${index + 1}`,
  112 |     userId: fixtureRosterUserId(side, index),
  113 |     uid: (side === "mine" ? 100 : 200) + index,
  114 |     displayName: local ? "Maya" : `${side === "mine" ? "Squadmate" : "Opponent"} ${index + 1}`,
  115 |     role: index === 0 ? "leader" : "member",
  116 |     ready: true,
  117 |     inLobbyVideo: false,
  118 |     inEncounterVideo: true,
  119 |     online: true,
  120 |   };
  121 | }
  122 | 
  123 | function fixtureEncounter(encounterId: string, count: number) {
  124 |   return {
  125 |     encounterId,
  126 |     status: "active",
  127 |     squadAId: "fixture-squad",
  128 |     squadAName: "Night Owls",
  129 |     squadACover: null,
  130 |     squadAMembers: Array.from({ length: count }, (_, index) => fixtureMember("mine", index)),
  131 |     squadBId: "fixture-opponents",
  132 |     squadBName: "Chaos Club",
  133 |     squadBCover: null,
  134 |     squadBMembers: Array.from({ length: count }, (_, index) => fixtureMember("theirs", index)),
  135 |     expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  136 |   };
  137 | }
  138 | 
  139 | async function installEncounterFixture(page: Page, options: {
  140 |   ended?: boolean;
  141 |   disconnectDelayMs?: number;
  142 |   disconnectStatus?: number;
  143 |   chatFailures?: number;
  144 |   reportFailures?: number;
  145 | } = {}) {
  146 |   let socketSend: ((message: string) => void) | null = null;
  147 |   let socketReadyResolve: (() => void) | null = null;
  148 |   const socketReady = new Promise<void>(resolve => { socketReadyResolve = resolve; });
  149 |   let chatAttempts = 0;
  150 |   let remainingChatFailures = options.chatFailures ?? 0;
  151 |   let remainingReportFailures = options.reportFailures ?? 0;
  152 |   const submittedReports: Record<string, unknown>[] = [];
  153 | 
  154 |   await page.routeWebSocket(/socket\.io/, socket => {
  155 |     socketSend = message => socket.send(message);
  156 |     socket.send(`0${JSON.stringify({
  157 |       sid: "fixture-engine",
  158 |       upgrades: [],
  159 |       pingInterval: 60_000,
  160 |       pingTimeout: 60_000,
  161 |       maxPayload: 1_000_000,
  162 |     })}`);
  163 |     socket.onMessage(message => {
  164 |       const text = typeof message === "string" ? message : message.toString();
  165 |       if (text === "2") {
  166 |         socket.send("3");
  167 |         return;
  168 |       }
  169 |       if (text.startsWith("40")) {
  170 |         socket.send(`40${JSON.stringify({ sid: "fixture-socket" })}`);
  171 |         socketReadyResolve?.();
  172 |         socketReadyResolve = null;
  173 |         return;
  174 |       }
  175 |       const event = text.match(/^42(\d*)(\[[\s\S]*\])$/);
  176 |       if (!event) return;
  177 |       const ackId = event[1];
  178 |       const [name, payload] = JSON.parse(event[2]) as [string, Record<string, unknown>];
```