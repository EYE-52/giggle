# Social Cinema Encounter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Gen Z, video-first responsive encounter that protects mixed camera ratios, adapts to the active theme, and keeps chat messages reliable.

**Architecture:** Keep the existing adaptive layout and Agora integration. Restyle and harden `VideoTile` and encounter chrome in place, reuse the existing cover/theme helpers, and add a backward-compatible Socket.IO acknowledgement path with route-lifetime controlled chat state. Add no dependency and no new persistence layer.

**Tech Stack:** TypeScript, React 19, Next.js 16, Socket.IO 4, Agora Web SDK, Node test runner, Playwright.

---

## File Map

- Modify `apps/desktop/app/(app)/encounter/page.tsx`: Social Cinema chrome, ambient cover, large-feed Fit, one clip boundary, controlled encounter chat.
- Modify `apps/desktop/components/ChatPanel.tsx`: optional controlled messages, pending/failed rendering, retry, and send callback.
- Modify `packages/core/src/socket.ts`: client message ids and acknowledgement callback while preserving the current boolean return.
- Modify `server/src/services/socketService.js`: explicit send acknowledgement with canonical message or error.
- Modify `packages/core/test/socket.test.cjs`: transport contract source check.
- Modify `server/test/socketAccess.test.js`: server acknowledgement and scope metadata check.
- Modify `apps/desktop/test/next-config.test.js`: encounter source contract for theme inheritance and clipping.
- Modify `apps/desktop/e2e/encounter.spec.ts`: mixed ratios, theme chrome, two-client chat persistence, and visual artifacts.

## Task 1: Lock the transport and media contracts with failing checks

**Files:**
- Test: `packages/core/test/socket.test.cjs`
- Test: `server/test/socketAccess.test.js`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/desktop/e2e/encounter.spec.ts`

- [ ] **Step 1: Add the socket acknowledgement contract checks**

Assert that `sendChatMessage` includes `clientMessageId`, accepts a callback, and the server always calls the Socket.IO acknowledgement with `{ ok: true, message }` or `{ ok: false, error }`.

```js
assert.match(socketSource, /clientMessageId/);
assert.match(socketSource, /ack\?: \(result: ChatSendResult\) => void/);
assert.match(messageBlock, /ack\?\.\(\{ ok: true, message \}\)/);
assert.match(messageBlock, /ack\?\.\(\{ ok: false, error:/);
```

- [ ] **Step 2: Add the encounter source contract check**

Assert the encounter root no longer forces `data-theme="dark"`, no visible `vs` token remains, full squad tiles call `renderParticipant(..., "fit")`, and the media host clips inherited-radius descendants.

```js
assert.doesNotMatch(encounterSource, /data-theme="dark"[\s\S]*data-testid="encounter-stage"/);
assert.doesNotMatch(encounterSource, />vs</i);
assert.match(encounterSource, /renderParticipant\(person\.id, "fit"\)/);
assert.match(encounterSource, /\[data-media-host\][\s\S]*overflow: clip/);
```

- [ ] **Step 3: Extend Playwright scenarios**

Use the existing encounter fixture and two-context helper. Inject synthetic video elements with 9:16, 1:1, 16:9, and 21:9 dimensions, then assert large frames use Fit, thumbnails use Crop, all media descendants remain inside their frame, and messages survive closing chat and resizing across 1180 px.

```ts
await injectSyntheticVideo(page, frame, 1080, 1920);
await expect(frame).toHaveAttribute("data-media-fit", "fit");
await expectMediaInsideFrame(frame);

await chatInput.fill("hello from this encounter");
await page.getByRole("button", { name: "Send message" }).click();
await expect(page.getByText("hello from this encounter")).toBeVisible();
await page.getByRole("button", { name: "Close chat" }).click();
await page.setViewportSize({ width: 1440, height: 900 });
await controls.getByRole("button", { name: "Chat" }).click();
await expect(page.getByText("hello from this encounter")).toHaveCount(1);
```

- [ ] **Step 4: Run the targeted checks and verify red**

Run:

```bash
pnpm --filter @giggle/core test
pnpm --dir server test -- --test-name-pattern='chat broadcasts'
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop test:e2e -- e2e/encounter.spec.ts --project=desktop
```

Expected: the new acknowledgement, Social Cinema, mixed-ratio, and persistence assertions fail against the current implementation.

## Task 2: Make encounter chat immediate and durable for the route

**Files:**
- Modify: `packages/core/src/socket.ts`
- Modify: `server/src/services/socketService.js`
- Modify: `apps/desktop/components/ChatPanel.tsx`
- Modify: `apps/desktop/app/(app)/encounter/page.tsx`

- [ ] **Step 1: Add a backward-compatible acknowledgement API**

Keep the boolean connection result for existing callers and add optional metadata/callback arguments.

```ts
export type ChatSendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

export function sendChatMessage(
  scope: ChatScope,
  text: string,
  sender: { id: string; name: string },
  options?: { clientMessageId?: string; ack?: (result: ChatSendResult) => void },
): boolean {
  s.timeout(5000).emit(SOCKET_EMIT.SEND_MESSAGE, payload, (error, result) => {
    options?.ack?.(error ? { ok: false, error: "Message not delivered." } : result);
  });
  return true;
}
```

- [ ] **Step 2: Acknowledge every server exit**

Validate the acknowledgement argument and call it before every early return. On success, broadcast and acknowledge the same canonical `message`, including `encounterId`, `squadId`, and `clientMessageId`.

```js
socket.on('send_message', async (payload = {}, ack = () => {}) => {
  if (!socket.data.userId) return ack({ ok: false, error: 'Sign in again to send.' });
  if (!normalizedText) return ack({ ok: false, error: 'Write a message first.' });
  if (!inAllowedRoom) return ack({ ok: false, error: 'You are no longer in this chat.' });
  io.to(room).emit('new_message', message);
  ack({ ok: true, message });
});
```

- [ ] **Step 3: Lift encounter messages into the route**

Keep lobby behavior unchanged. Give `ChatPanel` optional `messages`, `onMessagesChange`, and `onSend` props. In `EncounterInner`, subscribe once, keep the array while panels unmount, optimistically append a `sending` item, and replace by `clientMessageId` on echo/ack.

```ts
type DisplayChatMessage = ChatMessage & { clientMessageId?: string; delivery?: "sending" | "delivered" | "failed" };

const [chatMessages, setChatMessages] = useState<DisplayChatMessage[]>([]);
const upsertChatMessage = (message: DisplayChatMessage) =>
  setChatMessages(previous => {
    const index = previous.findIndex(item => item.id === message.id || (
      message.clientMessageId && item.clientMessageId === message.clientMessageId
    ));
    if (index < 0) return [...previous, message];
    return previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...message } : item);
  });
```

- [ ] **Step 4: Render pending, failed, and Retry without losing text**

```tsx
{message.delivery === "sending" && <span>Sending…</span>}
{message.delivery === "failed" && (
  <button type="button" onClick={() => onRetry?.(message)}>Retry</button>
)}
```

- [ ] **Step 5: Run chat checks green**

```bash
pnpm --filter @giggle/core test
pnpm --dir server test -- --test-name-pattern='chat broadcasts'
pnpm --filter @giggle/desktop test:e2e -- e2e/encounter.spec.ts --project=desktop --grep='chat'
```

Expected: sender pending resolves to delivered, the peer receives one message, rejected sends stay retryable, and close/reopen plus breakpoint resize retains the message.

## Task 3: Apply Social Cinema and one safe media frame

**Files:**
- Modify: `apps/desktop/app/(app)/encounter/page.tsx`

- [ ] **Step 1: Reuse the current theme and cover helpers**

Import `useTheme`, `coverKind`, `coverBackground`, and `fallbackGradient`. Delete the duplicated gradients, side accent map, split backdrop, cover thumbnail, forced dark theme root, and accent MutationObserver.

```ts
const themeId = useTheme();
const ambient = squad?.cover
  ? coverBackground(squad.cover, coverKind(squad.cover, themeId))
  : fallbackGradient(squad?.id ?? side, coverKind(null, themeId));
```

- [ ] **Step 2: Make large feeds Fit and compact feeds Crop**

Change the full Squad Split tiles from Crop to Fit. Keep existing focused/featured Fit and existing compact filmstrip/PiP Crop calls.

```tsx
{renderParticipant(person.id, "fit")}
```

- [ ] **Step 3: Make `VideoTile` the only clip boundary**

Move caller style before invariant radius/overflow properties, use paint containment, clip the SDK host and descendants, and render speaking emphasis as an inset overlay.

```tsx
style={{
  ...style,
  position: "relative",
  borderRadius: "var(--radius-tile, 16px)",
  overflow: "hidden",
  contain: "paint",
}}
```

```css
[data-media-host],
[data-media-host] > div,
[data-media-host] video,
[data-media-host] canvas {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  border-radius: inherit !important;
  overflow: clip !important;
}
```

- [ ] **Step 4: Simplify the call chrome**

Use plain squad chips, a single ambient stage layer, neutral translucent controls, semantic active/danger states, theme tokens for type/radius/borders, and no gradients/glows on control icons. Keep the stage itself on `--stage`.

```tsx
<div data-testid="encounter-shell" style={{ background: "var(--bg)", color: "var(--text)" }}>
  <div data-testid="encounter-stage" style={{ background: "var(--stage)" }}>
    {renderAdaptiveStage()}
  </div>
</div>
```

- [ ] **Step 5: Run source, geometry, theme, and media checks green**

```bash
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop test:e2e -- e2e/encounter.spec.ts --project=desktop --grep='mixed|chrome|rosters'
```

Expected: no VS presentation, theme chrome changes while video stays dark, all large feeds fit, compact feeds crop, and no media descendant or control overflows.

## Task 4: Full verification and visual review

**Files:**
- Artifacts: `apps/desktop/artifacts/visual-audit/2026-08-02/encounter/`

- [ ] **Step 1: Run package tests**

```bash
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --dir server test
```

Expected: all tests pass.

- [ ] **Step 2: Run the responsive encounter matrix**

```bash
pnpm --filter @giggle/desktop test:e2e -- e2e/encounter.spec.ts
```

Expected: phone and desktop projects pass; only declared project-specific skips remain.

- [ ] **Step 3: Build production web**

```bash
pnpm --filter @giggle/desktop build
```

Expected: Next.js production build exits 0 with no type error.

- [ ] **Step 4: Review representative screenshots**

Open phone portrait, phone landscape, laptop, desktop, Midnight, Cloud, and Tangerine Pop artifacts. Confirm full faces for portrait/ultrawide feeds, one rounded boundary, readable nameplates, large video real estate, neutral controls, distinct theme chrome, and no VS styling.

- [ ] **Step 5: Check the final diff without committing or deploying**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Preserve unrelated existing changes. Deployment remains a separate user-approved action.
