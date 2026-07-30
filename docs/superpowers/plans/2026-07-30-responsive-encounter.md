# Responsive Encounter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four manual call layouts with one adaptive, truthful Encounter experience that remains usable from 1v1 through 8v8 on responsive web, iOS, and Android.

**Architecture:** Keep API, socket, media lifecycle, and platform rendering in the existing Encounter screens. Add one dependency-free layout/focus policy to `@giggle/core`, bring the existing Agora adapters to truthful state parity, and delete the manual layout branches. Reuse the current `ChatPanel`, `Modal`, socket helpers, icons, theme tokens, and React Native primitives; add no dependency and no generic cross-platform UI layer.

**Tech Stack:** TypeScript, React 19, Next.js 16, React Native 0.85, Expo 56, Agora web/native SDKs, Socket.io, Node test runner, Playwright.

---

## File Map

- Create `packages/core/src/encounterLayout.ts`: pure participant layout and active-speaker hysteresis policy shared by both clients.
- Create `packages/core/test/encounterLayout.test.cjs`: executable 1v1 through 8v8 policy checks.
- Modify `packages/core/src/index.ts`: export the policy.
- Modify `packages/core/src/types.ts`: remove the obsolete four-mode `EncounterView` type after the web caller is gone.
- Modify `packages/agora/src/types.ts`: expose capture, connection, volume, remote-track, and native camera-switch truth.
- Modify `packages/agora/src/web.ts`: report local device outcomes and stop swallowing media-toggle failures.
- Modify `packages/agora/src/native.ts`: report real remote audio/video, connection, volume, capture, join, and camera-switch state.
- Modify `apps/mobile/components/RtcSurface.native.tsx`: map focused Fit and thumbnail Crop to Agora render modes.
- Modify `apps/mobile/components/RtcSurface.web.tsx`: accept the same local prop without pretending to render native media.
- Modify `apps/desktop/app/(app)/encounter/page.tsx`: adaptive stage, stable pinning, focused Fit/Crop, uncluttered controls, anchored reactions, responsive chat, retry, and safe ending.
- Modify `apps/mobile/app/encounter.tsx`: native parity for the same behaviors and states.
- Modify `apps/desktop/test/next-config.test.js`: replace obsolete manual-layout source checks with behavior contracts.
- Modify `apps/mobile/test/encounter.test.cjs`: cover adaptive layout, realtime reactions, truthful media, chat, and safe ending.
- Modify `apps/desktop/e2e/encounter.spec.ts`: exercise focus, Fit/Crop, reactions, overlays, controls, resize, and safe ending.

## Task 1: Shared adaptive layout and speaker focus

**Files:**

- Create: `packages/core/src/encounterLayout.ts`
- Create: `packages/core/test/encounterLayout.test.cjs`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing policy tests**

Create `packages/core/test/encounterLayout.test.cjs` with real imports and table-driven assertions:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const people = (side, count) =>
  Array.from({ length: count }, (_, index) => ({ id: `${side}-${index}`, side }));

test("encounter layouts scale from 1v1 to 8v8 without a dense phone grid", async () => {
  const { deriveEncounterLayout } = await import("../src/encounterLayout.ts");
  const cases = [
    ["wide", 1, 1, "remote-main"],
    ["phone", 2, 2, "squad-split"],
    ["wide", 3, 3, "featured-split"],
    ["wide", 4, 4, "featured-split"],
    ["wide", 8, 8, "dual-focus"],
    ["phone", 8, 8, "single-focus"],
    ["narrow", 8, 8, "single-focus"],
  ];

  for (const [viewport, mineCount, theirsCount, kind] of cases) {
    const mine = people("mine", mineCount);
    const theirs = people("theirs", theirsCount);
    const layout = deriveEncounterLayout({ viewport, mine, theirs });
    assert.equal(layout.kind, kind);
    assert.deepEqual(
      new Set([
        layout.focusId,
        layout.minePrimaryId,
        layout.theirsPrimaryId,
        ...layout.mineStripIds,
        ...layout.theirsStripIds,
      ].filter(Boolean)),
      new Set([...mine, ...theirs].map((person) => person.id))
    );
  }
});

test("manual pins win and disappear safely when their participant leaves", async () => {
  const { deriveEncounterLayout } = await import("../src/encounterLayout.ts");
  const mine = people("mine", 4);
  const theirs = people("theirs", 4);
  assert.equal(
    deriveEncounterLayout({ viewport: "wide", mine, theirs, pinnedId: "theirs-3" }).theirsPrimaryId,
    "theirs-3"
  );
  assert.notEqual(
    deriveEncounterLayout({ viewport: "wide", mine, theirs: theirs.slice(0, 3), pinnedId: "theirs-3" }).theirsPrimaryId,
    "theirs-3"
  );
});

test("1v1 defaults to the remote person and tapping self swaps the main stage", async () => {
  const { deriveEncounterLayout } = await import("../src/encounterLayout.ts");
  const mine = people("mine", 1);
  const theirs = people("theirs", 1);
  const normal = deriveEncounterLayout({ viewport: "phone", mine, theirs });
  const swapped = deriveEncounterLayout({ viewport: "phone", mine, theirs, pinnedId: "mine-0" });
  assert.equal(normal.focusId, "theirs-0");
  assert.equal(normal.theirsPrimaryId, "theirs-0");
  assert.deepEqual(normal.mineStripIds, ["mine-0"]);
  assert.equal(swapped.focusId, "mine-0");
  assert.equal(swapped.minePrimaryId, "mine-0");
  assert.deepEqual(swapped.theirsStripIds, ["theirs-0"]);
});

test("speaker focus waits 600ms and holds an automatic focus for 1500ms", async () => {
  const { advanceSpeakerFocus, EMPTY_SPEAKER_FOCUS } = await import("../src/encounterLayout.ts");
  const ids = ["mine-0", "theirs-0"];
  const candidate = advanceSpeakerFocus(ids, EMPTY_SPEAKER_FOCUS, "theirs-0", 1000);
  assert.equal(candidate.focusedId, null);
  assert.equal(candidate.candidateId, "theirs-0");

  const focused = advanceSpeakerFocus(ids, candidate, "theirs-0", 1600);
  assert.equal(focused.focusedId, "theirs-0");

  const held = advanceSpeakerFocus(ids, focused, "mine-0", 2200);
  assert.equal(advanceSpeakerFocus(ids, held, "mine-0", 2800).focusedId, "theirs-0");
  assert.equal(advanceSpeakerFocus(ids, held, "mine-0", 3100).focusedId, "mine-0");
});

test("mute, camera, and reconnect state never reorder participants", async () => {
  const { deriveEncounterLayout } = await import("../src/encounterLayout.ts");
  const mine = people("mine", 4);
  const theirs = people("theirs", 4);
  const before = deriveEncounterLayout({ viewport: "wide", mine, theirs });
  const after = deriveEncounterLayout({ viewport: "wide", mine: [...mine], theirs: [...theirs] });
  assert.deepEqual(after.mineStripIds, before.mineStripIds);
  assert.deepEqual(after.theirsStripIds, before.theirsStripIds);
});
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `pnpm --filter @giggle/core test`

Expected: FAIL because `src/encounterLayout.ts` does not exist.

- [ ] **Step 3: Add the complete pure policy**

Create `packages/core/src/encounterLayout.ts`:

```ts
export type EncounterViewportClass = "phone" | "narrow" | "wide";
export type EncounterSide = "mine" | "theirs";
export type EncounterLayoutKind =
  | "remote-main"
  | "squad-split"
  | "featured-split"
  | "single-focus"
  | "dual-focus";

export interface EncounterLayoutParticipant {
  id: string;
  side: EncounterSide;
}

export interface SpeakerFocusState {
  focusedId: string | null;
  focusedSince: number;
  candidateId: string | null;
  candidateSince: number;
}

export interface EncounterLayout {
  kind: EncounterLayoutKind;
  focusId: string | null;
  minePrimaryId: string | null;
  theirsPrimaryId: string | null;
  mineStripIds: string[];
  theirsStripIds: string[];
}

export const EMPTY_SPEAKER_FOCUS: SpeakerFocusState = {
  focusedId: null,
  focusedSince: 0,
  candidateId: null,
  candidateSince: 0,
};

const CANDIDATE_MS = 600;
const HOLD_MS = 1500;

export function advanceSpeakerFocus(
  participantIds: readonly string[],
  previous: SpeakerFocusState,
  activeSpeakerId: string | null,
  now: number
): SpeakerFocusState {
  const valid = new Set(participantIds);
  const focusedId = previous.focusedId && valid.has(previous.focusedId)
    ? previous.focusedId
    : null;
  const base = focusedId === previous.focusedId
    ? previous
    : { ...previous, focusedId, focusedSince: focusedId ? previous.focusedSince : 0 };

  if (!activeSpeakerId || !valid.has(activeSpeakerId) || activeSpeakerId === focusedId) {
    return { ...base, candidateId: null, candidateSince: 0 };
  }
  if (base.candidateId !== activeSpeakerId) {
    return { ...base, candidateId: activeSpeakerId, candidateSince: now };
  }
  if (now - base.candidateSince < CANDIDATE_MS) return base;
  if (focusedId && now - base.focusedSince < HOLD_MS) return base;
  return {
    focusedId: activeSpeakerId,
    focusedSince: now,
    candidateId: null,
    candidateSince: 0,
  };
}

export function deriveEncounterLayout(input: {
  viewport: EncounterViewportClass;
  mine: readonly EncounterLayoutParticipant[];
  theirs: readonly EncounterLayoutParticipant[];
  pinnedId?: string | null;
  automaticFocusId?: string | null;
}): EncounterLayout {
  const mineIds = input.mine.map((person) => person.id);
  const theirsIds = input.theirs.map((person) => person.id);
  const allIds = [...mineIds, ...theirsIds];
  const valid = new Set(allIds);
  const selected = input.pinnedId && valid.has(input.pinnedId)
    ? input.pinnedId
    : input.automaticFocusId && valid.has(input.automaticFocusId)
      ? input.automaticFocusId
      : null;
  const total = allIds.length;

  if (total === 2 && mineIds.length === 1 && theirsIds.length === 1) {
    const focusId = selected ?? theirsIds[0];
    return {
      kind: "remote-main",
      focusId,
      minePrimaryId: mineIds.includes(focusId) ? focusId : null,
      theirsPrimaryId: theirsIds.includes(focusId) ? focusId : null,
      mineStripIds: mineIds.filter((id) => id !== focusId),
      theirsStripIds: theirsIds.filter((id) => id !== focusId),
    };
  }
  if (total <= 4) {
    return {
      kind: "squad-split",
      focusId: selected,
      minePrimaryId: null,
      theirsPrimaryId: null,
      mineStripIds: mineIds,
      theirsStripIds: theirsIds,
    };
  }

  const minePrimaryId = selected && mineIds.includes(selected) ? selected : mineIds[0] ?? null;
  const theirsPrimaryId = selected && theirsIds.includes(selected) ? selected : theirsIds[0] ?? null;
  if (total <= 8) {
    return {
      kind: "featured-split",
      focusId: selected,
      minePrimaryId,
      theirsPrimaryId,
      mineStripIds: mineIds.filter((id) => id !== minePrimaryId),
      theirsStripIds: theirsIds.filter((id) => id !== theirsPrimaryId),
    };
  }
  if (input.viewport === "wide") {
    return {
      kind: "dual-focus",
      focusId: selected,
      minePrimaryId,
      theirsPrimaryId,
      mineStripIds: mineIds.filter((id) => id !== minePrimaryId),
      theirsStripIds: theirsIds.filter((id) => id !== theirsPrimaryId),
    };
  }

  const focusId = selected ?? theirsIds[0] ?? mineIds[0] ?? null;
  return {
    kind: "single-focus",
    focusId,
    minePrimaryId: focusId && mineIds.includes(focusId) ? focusId : null,
    theirsPrimaryId: focusId && theirsIds.includes(focusId) ? focusId : null,
    mineStripIds: mineIds.filter((id) => id !== focusId),
    theirsStripIds: theirsIds.filter((id) => id !== focusId),
  };
}
```

Export it from `packages/core/src/index.ts`:

```ts
export * from "./encounterLayout";
```

- [ ] **Step 4: Run the core suite**

Run: `pnpm --filter @giggle/core test`

Expected: all core tests PASS.

- [ ] **Step 5: Commit the policy**

```bash
git add packages/core/src/encounterLayout.ts packages/core/src/index.ts packages/core/test/encounterLayout.test.cjs
git commit -m "feat(encounter): add adaptive layout policy"
```

## Task 2: Truthful Agora state on web and native

**Files:**

- Modify: `packages/agora/src/types.ts`
- Modify: `packages/agora/src/web.ts`
- Modify: `packages/agora/src/native.ts`
- Modify: `apps/mobile/components/RtcSurface.native.tsx`
- Modify: `apps/mobile/components/RtcSurface.web.tsx`

- [ ] **Step 1: Add failing source contracts to the existing platform tests**

In `apps/desktop/test/next-config.test.js`, read the Agora web and type sources and assert that `onCaptureState`, `captureErrorKind`, and non-swallowed toggle failures exist. In `apps/mobile/test/encounter.test.cjs`, read the native adapter and assert that it uses `onRemoteVideoStateChanged`, `onRemoteAudioStateChanged`, `onConnectionStateChanged`, `onAudioVolumeIndication`, `onPermissionError`, and `switchCamera`.

Run:

```bash
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
```

Expected: the new adapter contracts FAIL.

- [ ] **Step 2: Extend the existing interface without adding an adapter layer**

Add these exact public types and methods to `packages/agora/src/types.ts`:

```ts
export type CaptureDeviceState = "pending" | "active" | "off" | "denied" | "unavailable";

export interface CaptureState {
  audio: CaptureDeviceState;
  video: CaptureDeviceState;
}

export interface VideoClient {
  join(token: AgoraToken, opts?: { audio?: boolean; video?: boolean }): Promise<void>;
  leave(): Promise<void>;
  setMicEnabled(on: boolean): Promise<void>;
  setCamEnabled(on: boolean): Promise<void>;
  switchCamera?(): Promise<void>;
  playLocal(el?: unknown): void;
  playRemote(uid: string | number, el?: unknown): void;
  onRemoteChange(cb: (remotes: RemoteParticipant[]) => void): () => void;
  onVolumes?(cb: (levels: VolumeLevel[]) => void): () => void;
  onConnectionState?(cb: (state: ConnectionState) => void): () => void;
  onCaptureState?(cb: (state: CaptureState) => void): () => void;
  readonly remotes: RemoteParticipant[];
}
```

- [ ] **Step 3: Make the web adapter report actual capture outcomes**

In `packages/agora/src/web.ts`:

- store `localUid` from the token;
- add a capture-listener set and emit immutable `{ audio, video }` snapshots;
- classify `NotAllowedError`/`SecurityError` as `denied`, `NotFoundError`/`OverconstrainedError` as `unavailable`, and other capture failures as `unavailable`;
- emit `pending` before track creation, `active` only after a track exists, `off` after a successful mute, and never claim an unavailable track is active;
- normalize the SDK's local volume UID `0` to `localUid`;
- throw when a media toggle has no track or both SDK toggle methods fail, so existing UI rollback can work.

Use this failure shape instead of nested swallowed catches:

```ts
async function setTrackEnabled(track: any, on: boolean, label: string) {
  if (!track) throw new Error(`${label} is unavailable.`);
  try {
    await track.setMuted(!on);
  } catch (firstError) {
    try {
      await track.setEnabled(on);
    } catch {
      throw firstError;
    }
  }
}
```

- [ ] **Step 4: Make the native adapter emit real SDK state**

Replace the fixed `hasVideo: true, hasAudio: true` mapping in `packages/agora/src/native.ts` with a `Map<number, RemoteParticipant>`. Register the existing SDK callbacks before joining:

```ts
onUserJoined: (_connection, uid) => updateRemote(uid, {}),
onUserOffline: (_connection, uid) => removeRemote(uid),
onRemoteVideoStateChanged: (_connection, uid, state) =>
  updateRemote(uid, { hasVideo: state === RemoteVideoState.RemoteVideoStateStarting || state === RemoteVideoState.RemoteVideoStateDecoding || state === RemoteVideoState.RemoteVideoStateFrozen }),
onRemoteAudioStateChanged: (_connection, uid, state) =>
  updateRemote(uid, { hasAudio: state === RemoteAudioState.RemoteAudioStateStarting || state === RemoteAudioState.RemoteAudioStateDecoding || state === RemoteAudioState.RemoteAudioStateFrozen }),
onConnectionStateChanged: (_connection, state) => emitConnection(mapConnectionState(state)),
onAudioVolumeIndication: (_connection, speakers) =>
  emitVolumes(speakers.map((speaker) => ({ uid: speaker.uid === 0 ? localUid : speaker.uid ?? 0, level: Math.round(((speaker.volume ?? 0) / 255) * 100) }))),
onPermissionError: (permission) =>
  setCapture(permission === PermissionType.RecordAudio ? { audio: "denied" } : { video: "denied" }),
onLocalAudioStateChanged: (_connection, state) =>
  setCapture({ audio: state === LocalAudioStreamState.LocalAudioStreamStateEncoding ? "active" : state === LocalAudioStreamState.LocalAudioStreamStateStopped ? "off" : capture.audio }),
onLocalVideoStateChanged: (_source, state) =>
  setCapture({ video: state === LocalVideoStreamState.LocalVideoStreamStateCapturing || state === LocalVideoStreamState.LocalVideoStreamStateEncoding ? "active" : state === LocalVideoStreamState.LocalVideoStreamStateStopped ? "off" : capture.video }),
```

Call `engine.enableAudioVolumeIndication(200, 3, true)`. Reject `join()` when `joinChannel` returns a negative code, reject negative mute/camera/switch return codes, and implement `switchCamera()` with the installed SDK's `engine.switchCamera()`.

- [ ] **Step 5: Map focused Fit and thumbnail Crop in the existing native surface**

Change both `RtcSurface` files to accept `fit?: "fit" | "crop"`. In the native file, merge `canvas.renderMode` with `RenderModeType.RenderModeFit` for Fit and `RenderModeType.RenderModeHidden` for Crop. The web stub accepts and ignores `fit` because the Next screen owns its DOM video.

- [ ] **Step 6: Verify adapters compile through their consumers**

Run:

```bash
pnpm --filter @giggle/mobile typecheck
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/desktop build
```

Expected: all three commands PASS. The existing Node 25 engine warning may remain; no compile error may remain.

- [ ] **Step 7: Commit the media truth contract**

```bash
git add packages/agora/src/types.ts packages/agora/src/web.ts packages/agora/src/native.ts apps/mobile/components/RtcSurface.native.tsx apps/mobile/components/RtcSurface.web.tsx apps/desktop/test/next-config.test.js apps/mobile/test/encounter.test.cjs
git commit -m "fix(encounter): expose truthful media state"
```

## Task 3: Replace web manual modes with the adaptive stage

**Files:**

- Modify: `apps/desktop/app/(app)/encounter/page.tsx`
- Modify: `packages/core/src/types.ts`
- Modify: `apps/desktop/test/next-config.test.js`

- [ ] **Step 1: Replace obsolete tests before deleting the modes**

Add behavior-level assertions that the Encounter page imports `deriveEncounterLayout` and `advanceSpeakerFocus`, keys people by `userId`, renders no `VIEW_MODES`, and contains no `grid`, `spotlight`, or `focus-opponent` state values. Assert that the stage exposes `data-layout-kind`, a focused media frame exposes `data-media-fit`, and tiles retain button semantics for pinning.

Run: `pnpm --filter @giggle/desktop test`

Expected: the new adaptive-layout assertions FAIL.

- [ ] **Step 2: Replace unstable positional participant keys**

Build the existing `myMembers` and `oppMembers` into one local participant array using `member.userId` as `id`, preserving backend order and carrying `uid`, `memberId`, name, side, and local truth. Map volume UIDs back to `userId`; select only the loudest level above the existing threshold.

Keep manual `pinnedId` separate from automatic focus. Clear it only when tapped again, Escape/Back is used, or the participant no longer exists. Advance automatic focus every 200ms only while the room has at least five people; clear the interval otherwise.

- [ ] **Step 3: Delete the four render branches and render the five policy kinds**

Delete `VIEW_MODES`, `view`, `hoveredViewMode`, `renderGrid`, `renderSpotlight`, `renderFocusOpponent`, `renderStageByView`, and the mode-tab row. Keep `VideoTile`, room backdrops, real media refs, member truth helpers, and the existing controller.

Add one local `renderParticipant(id, presentation)` lookup and five direct render branches:

- `remote-main`: remote Fit frame plus compact self-view;
- `squad-split`: explicit Yours/Theirs regions with generous stable tiles;
- `featured-split`: one Fit primary and compact Crop teammates per squad;
- `dual-focus`: one Fit primary and one horizontal Crop filmstrip per squad;
- `single-focus`: one Fit primary, Yours/Theirs segmented filmstrip, and compact self-view.

The only horizontal scroll containers are filmstrips. Put `data-layout-kind={layout.kind}` on the stage root and keep each squad name as text so team identity does not rely on accent color.

Keep one compact header row: squad names and participant counts on desktop, and only connection state, LIVE, and elapsed time on phones where the stage already labels squads. Do not show LIVE until the media connection is actually connected.

- [ ] **Step 4: Make focused media uncropped by default**

Replace the global forced `object-fit: cover` rule with per-frame `data-media-fit="fit" | "crop"`. `VideoTile` receives the presentation and applies Crop only to small tiles.

For a Fit frame, keep one foreground SDK host at `object-fit: contain` and a muted `aria-hidden` background `<video>`. After Agora inserts the foreground `<video>`, mirror its `srcObject` into the background using a local `MutationObserver`; apply `object-fit: cover`, `filter: blur(22px) brightness(.46) saturate(.8)`, and `transform: scale(1.12)` to the background. Disconnect the observer and clear the mirrored `srcObject` on unmount. If no stream exists, the existing avatar/room backdrop remains visible.

Store one call-local `focusedFit` state defaulting to `"fit"`; do not persist it after navigation.

- [ ] **Step 5: Preserve media attachment across adaptive changes**

Replace the effects that depend on `view` and positional opponent refs with identity-based refs only. Re-run local and remote `play` attachment when the derived layout, roster, camera state, or focused Fit/Crop state changes. Never attach a remote stream by array index when a member UID exists.

Keep the existing quiet loading and invalid-link states, but give an expired/unavailable link explicit Home and Find a match actions. Do not start elapsed time or show live state before encounter data is valid. Late joins and leaves update the policy from the real roster without fabricating a replacement tile.

- [ ] **Step 6: Remove the obsolete public type**

Delete this line from `packages/core/src/types.ts` after its last caller is gone:

```ts
export type EncounterView = "versus" | "grid" | "spotlight" | "focus-opponent";
```

- [ ] **Step 7: Verify the web unit/build gate**

Run:

```bash
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop build
```

Expected: core tests and the production build PASS; Encounter-specific desktop tests PASS. Unrelated pre-existing desktop failures must remain listed rather than hidden by assertion changes.

- [ ] **Step 8: Commit the web stage**

```bash
git add packages/core/src/types.ts apps/desktop/app/'(app)'/encounter/page.tsx apps/desktop/test/next-config.test.js
git commit -m "feat(encounter): adapt the web stage to room size"
```

## Task 4: Clean web call chrome, reactions, chat, retry, and ending

**Files:**

- Modify: `apps/desktop/app/(app)/encounter/page.tsx`
- Modify: `apps/desktop/e2e/encounter.spec.ts`
- Modify: `apps/desktop/test/next-config.test.js`

- [ ] **Step 1: Write failing interaction contracts**

Update source and E2E assertions for exactly five persistent controls: Mic, Camera, Chat, More, and End encounter. Assert 44px minimums, an explicit confirmation before the end API call, API-before-media-leave ordering, More ownership of report/Fit-Crop/self-view actions, reaction lifetime `1800`, sender identity in floating reactions, chat side panel threshold `1180`, and a phone sheet capped at 55% of the usable viewport.

Run: `pnpm --filter @giggle/desktop test`

Expected: the new control and reaction assertions FAIL.

- [ ] **Step 2: Reduce the persistent chrome**

Remove Report from `ctrlBtns`. Render Mic, Camera, Chat, More, and End in one non-wrapping dock. Use 44px targets on phone and 48px on larger screens; keep End spatially separated with the danger token. At width `>= 1024`, add the reaction shortcut beside More; below that width reactions live only inside More.

More contains only:

- reactions;
- report opponent squad;
- Fit/Crop when a primary focused frame exists;
- minimize/restore self-view;
- no settings or speculative call features.

Opening Chat closes More and reactions; opening More closes Chat overlays. Outside click and Escape close the active popover and restore focus to its trigger.

- [ ] **Step 3: Anchor reactions to the real sender and use the agreed timing**

Change `FloatingReaction` to carry `senderId`. Call `spawnReaction(emoji, session.user?.id)` only after `sendReaction()` succeeds and call it with `r.senderId` for incoming events. Render a participant's reactions inside that participant's current tile, away from the name pill and control dock. Use `1800` for state removal and the CSS animation. Under `prefers-reduced-motion: reduce`, keep a short opacity-only fade with no translation or scale.

- [ ] **Step 4: Reuse the existing modal and chat primitives**

At widths `>= 1180`, render the existing `ChatPanel` in a 340px side panel. Below 1180, render it through the existing `Modal`; use a bottom sheet on phones with `height: min(55dvh, calc(100dvh - 96px))` and a constrained overlay on larger narrow screens. Let `Modal` provide focus trapping, Escape, backdrop dismissal, scroll lock, and trigger focus restoration.

Keep the stage visible behind the phone sheet. Listen to `window.visualViewport` while chat is open; when the keyboard reduces the usable height by more than 120px, set the sheet height to `calc(100dvh - 96px)` so the compact live header remains visible and the close action stays on-screen.

- [ ] **Step 5: Add truthful device and connection recovery**

Subscribe to `onCaptureState` and show separate camera/microphone messages only when their state is `denied` or `unavailable`. Keep chat and any successful track usable. Extract the current video join body into one `joinVideo()` function so Retry can leave the stale client and rejoin without refetching the encounter, dropping the pin, or navigating away. Connection labels are only Connecting, Reconnecting, Live, and Disconnected.

- [ ] **Step 6: Confirm before ending and keep the call alive on failure**

Use the existing `Modal` with title `End encounter?` and copy `This ends the current encounter for both squads.` The destructive button calls `api.disconnectEncounter` first. Only after API success should it leave Agora and navigate Home. On API failure, keep media joined, keep the modal open, display `Couldn't end this encounter yet.`, and re-enable the button.

- [ ] **Step 7: Complete keyboard and screen-reader behavior**

Use native buttons with `aria-pressed` for mic, camera, and pin state. Back/Escape clears a manual pin before leaving any screen; long visible names truncate while `aria-label` keeps the full name. Connection and device recovery use `role="status"`; terminal disconnect/end failures use `role="alert"`; chat remains the existing polite live region. Verify that popovers, modal actions, and filmstrip participants remain reachable at 200% zoom.

- [ ] **Step 8: Run web verification**

Run:

```bash
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop build
```

Expected: Encounter-specific assertions and build PASS.

- [ ] **Step 9: Commit the web interactions**

```bash
git add apps/desktop/app/'(app)'/encounter/page.tsx apps/desktop/test/next-config.test.js apps/desktop/e2e/encounter.spec.ts
git commit -m "fix(encounter): make web call controls truthful"
```

## Task 5: Replace native manual modes with adaptive, truthful video

**Files:**

- Modify: `apps/mobile/app/encounter.tsx`
- Modify: `apps/mobile/test/encounter.test.cjs`

- [ ] **Step 1: Write failing native layout contracts**

Assert that the screen imports the shared policy, contains no `MODES` or `ViewMode`, orients `mine`/`theirs` from `squadId`, keys participants by `userId`, maps media by member UID, subscribes to volume/connection/capture state, and uses Fit for the primary native surface and Crop for compact surfaces.

Run: `pnpm --filter @giggle/mobile test`

Expected: the new adaptive and truthful-media assertions FAIL.

- [ ] **Step 2: Reuse the shared identity and policy**

Derive mine/theirs exactly as web does instead of treating server squad A as local. Build stable participants from `member.userId`, map Agora UID to the matching participant, and classify native width as phone below 600dp, narrow from 600–899dp, and wide at 900dp or above. Feed the shared speaker focus and layout policy with the same 200ms active interval only for rooms of five or more.

- [ ] **Step 3: Delete mode tabs and render the five native policy kinds**

Delete `ViewMode`, `MODES`, `mode`, the tabs ScrollView, positional `displayTiles`, and the fixed two-column grid branch. Keep the screen controller, actual Agora surface, avatar, colors, and tokens.

Use direct React Native Flexbox render branches matching web:

- remote main plus dismissible compact self-view;
- two labeled squad regions for 2–4;
- one primary plus teammate strip per squad for 5–8;
- dual primary plus strips on wide 9–16;
- one primary plus Yours/Theirs segmented horizontal strip on phone/narrow 9–16.

Only filmstrips scroll horizontally. Tapping any real tile pins by `userId`; tapping it again clears the pin. No participant is synthesized while data is missing.

Use the hardware Back action to clear a manual pin before closing the route. Keep one compact header with connection state, LIVE, and elapsed time; hide duplicate squad names on phones and include real squad counts on wide tablets.

- [ ] **Step 4: Render real local and remote truth**

For each participant, render local UID 0 only when it is the session user and camera capture is active. Render a remote UID only when the adapter reports `hasVideo`. Show `Camera off`, `Connecting`, or the applicable device error from actual adapter state. Show a muted indicator only when audio state is explicitly false. Apply Fit to primary surfaces and Crop to compact surfaces; render a dimmed Crop duplicate with React Native's native `filter: [{ blur: 22 }, { brightness: 0.46 }]` behind a Fit primary.

- [ ] **Step 5: Verify native layout and compile gates**

Run:

```bash
pnpm --filter @giggle/core test
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the native stage**

```bash
git add apps/mobile/app/encounter.tsx apps/mobile/test/encounter.test.cjs
git commit -m "feat(encounter): adapt the native stage to room size"
```

## Task 6: Native controls, chat, reactions, recovery, and ending

**Files:**

- Modify: `apps/mobile/app/encounter.tsx`
- Modify: `apps/mobile/test/encounter.test.cjs`

- [ ] **Step 1: Write failing native interaction contracts**

Assert five persistent controls with accessible labels and 48dp targets; one More sheet; `sendReaction`/`subscribeReaction`; reaction lifetime 1800; `sendChatMessage`/`subscribeChat`; a `KeyboardAvoidingView` chat sheet; Android `onRequestClose`; `switchCamera`; an end confirmation; and API-before-Agora-leave ordering.

Run: `pnpm --filter @giggle/mobile test`

Expected: the new contracts FAIL.

- [ ] **Step 2: Replace Report with More and add accessible control state**

Keep Mic, Camera, Chat, More, and End on one safe-area-aware row with a minimum 48×48 target. Supply `accessibilityRole="button"`, truthful labels, and selected/disabled state. Put reactions, report, focused Fit/Crop, self-view minimize/restore, and Switch camera in one React Native `Modal` bottom sheet. Opening one sheet closes the others; `onRequestClose` handles Android Back.

- [ ] **Step 3: Use the shared realtime helpers for chat and reactions**

Replace raw chat socket parsing with `joinChat`, `sendChatMessage`, and `subscribeChat`; filter by encounter ID and de-duplicate server IDs. Keep failed text in the input with a retryable inline message.

Use `sendReaction` and `subscribeReaction`, filtering by encounter ID and skipping the local echo. Store `{ id, emoji, senderId }`, remove it after 1800ms, and render it inside the sender's current participant tile. A small local `ReactionBubble` uses React Native `Animated` for opacity/translation and switches to opacity-only when `AccessibilityInfo.isReduceMotionEnabled()` is true.

- [ ] **Step 4: Keep video visible while chatting**

Render chat in a bottom `Modal` capped at 55% of the usable height. Wrap its content in `KeyboardAvoidingView`; when the keyboard is visible, occupy the area below a 96dp compact live-video header. Preserve a visible close control, draft, unread count, safe-area bottom padding, and the stage above the sheet.

- [ ] **Step 5: Add Retry and safe destructive ending**

Extract native video joining into `joinVideo()` and expose Retry without leaving the route. End opens a confirmation that says both squads leave the encounter. Call the backend first; only after success leave Agora and navigate Home. On failure, keep the call active and show the error in the confirmation. Do not swallow the endpoint failure.

Invalid or expired parameters render Home and Find a match recovery actions rather than a fake room. Announce connection/device recovery as status and terminal errors as alerts. Preserve full accessible names for truncated participants and selected state for pins, mic, and camera.

- [ ] **Step 6: Run native verification**

Run:

```bash
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile typecheck
pnpm --filter @giggle/mobile export:web
```

Expected: all commands PASS.

- [ ] **Step 7: Commit native interactions**

```bash
git add apps/mobile/app/encounter.tsx apps/mobile/test/encounter.test.cjs
git commit -m "fix(encounter): complete native call controls"
```

## Task 7: Behavior, viewport, visual, and real-device verification

**Files:**

- Modify: `apps/desktop/e2e/encounter.spec.ts`
- Modify: `docs/superpowers/audits/2026-07-30-full-app-ui-audit.md`

- [ ] **Step 1: Update the real two-client test**

Delete the loop that clicks Grid, Spotlight, Focus Opponent, and Versus. Verify instead:

- real local and remote media frames;
- tap-to-pin and tap-again/Escape unpin;
- Fit default and Crop toggle;
- mic/camera rollback on induced failure by installing this before navigation in the dedicated denial case:

```ts
await page.addInitScript(() => {
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true,
    value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
  });
});
```

- camera and microphone denial remain independent in the UI;
- chat stays below its threshold and returns focus to Chat;
- reaction appears only after successful send and is removed between 1700–2100ms;
- report is inside More;
- reconnect notice does not replace the stage;
- End opens confirmation, cancel keeps the call, confirm ends it.

Run the real two-client flow only in the existing `phone` and `desktop` projects. Keep backend and console failures fatal except where the test deliberately induces one.

- [ ] **Step 2: Add a mocked-roster visual matrix without production fixture code**

In Playwright, intercept the encounter-detail and video-presence/token requests for fixture IDs and return real-shaped 1v1, 2v2, 3v3, 4v4, and 8v8 rosters with deterministic UIDs. Navigate directly to the normal Encounter route and let missing video render truthful avatar/camera states. Do not add a test-only route or fixture branch to production code. Use this mocked-roster case only for participant geometry. Capture permission failure with the `getUserMedia` denial case above, reconnecting by setting the real two-client context offline and then online, camera-off by using the real Camera control, and ended state by ending from the opponent page.

Loop these exact viewport sizes in one visual test and capture closed chat, open chat, More, end confirmation, camera-off, permission error, reconnecting, and ended states where reproducible:

```ts
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
```

For each size assert no horizontal document overflow, no clipped control dock, no clipped close action, every primary target at least 44px, every participant reachable, and no sixteen-tile phone grid. Repeat desktop with reduced motion and 200% browser zoom.

Repeat the core visual states under dark, light, and Tangerine themes. Verify that theme changes affect chrome accents without making the media stage light or lowering text/control contrast.

- [ ] **Step 3: Run automated gates**

Run:

```bash
pnpm --filter @giggle/core test
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile typecheck
pnpm --filter @giggle/mobile export:web
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop build
cd server && npm test
```

Expected: core, mobile, server, and build gates PASS. Desktop failures unrelated to Encounter remain explicitly triaged; no Encounter regression may remain.

- [ ] **Step 4: Run web E2E when the project browser runtime is available**

Run: `pnpm --filter @giggle/desktop test:e2e -- encounter.spec.ts`

Expected: the real phone/desktop call checks and the full mocked-roster viewport matrix PASS with screenshots under the dated visual-audit artifact directory.

- [ ] **Step 5: Run native simulator/device checks**

On one current iPhone simulator, one small iPhone simulator, one standard Android emulator, one iPad simulator, and one Android tablet emulator, verify:

- independent camera/mic allow and deny paths;
- portrait, landscape, safe areas, and larger text;
- 1v1, 2v2, 3v3, 4v4, and mocked 8v8 composition;
- tap focus, Fit/Crop, segmented filmstrip, and self-view minimize;
- keyboard chat, Android Back, reaction timing, report, reconnect, retry, and end failure/success;
- no clipped control, sheet action, name, or recovery path.

Capture the same core screenshots as web and record device/OS/runtime versions in the audit ledger.

- [ ] **Step 6: Review screenshots, not just their existence**

Inspect every generated image at full resolution. Record each route/state/device as PASS or as an open defect. Do not mark Encounter complete while any required screenshot is missing, unreviewed, clipped, overflowing, fabricated, or visually inconsistent.

- [ ] **Step 7: Update the audit evidence and commit verification**

Update the Encounter section of `docs/superpowers/audits/2026-07-30-full-app-ui-audit.md` with exact commands, pass counts, screenshot paths, device versions, live two-client result, and every remaining limitation.

```bash
git add apps/desktop/e2e/encounter.spec.ts docs/superpowers/audits/2026-07-30-full-app-ui-audit.md
git commit -m "test(encounter): verify responsive call behavior"
```

## Completion Gate

Encounter is complete only when the pure policy, web interactions, native checks, builds, required viewport screenshots, screenshot review, and a real two-client call all pass. Source-string tests, compilation, or unreviewed screenshots alone are not pixel-perfect evidence.
