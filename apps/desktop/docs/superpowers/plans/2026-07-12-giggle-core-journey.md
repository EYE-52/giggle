# Giggle Core Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and verify a production-grade Giggle journey from the public landing page through sign-in, lobby, matchmaking, match confirmation, and live encounter across all supported viewport classes.

**Architecture:** Preserve the existing Next.js 16 App Router, React 19, core API/session package, socket layer, and Agora client. Add browser-level contracts first, extract only the landing story and small call controls that benefit from isolation, and refine each existing route in place so realtime behavior is not rewritten during visual work.

**Tech Stack:** Next.js 16.2, React 19.2, TypeScript 5, CSS variables/native CSS, `@giggle/core`, `@giggle/agora`, Playwright.

---

## File Map

- `app/page.tsx`: public landing composition and existing cinematic media primitives
- `components/landing/UseCaseStory.tsx`: responsive three-use-case scroll/swipe sequence
- `components/landing/useStoryProgress.ts`: reduced-motion-aware desktop scroll progress
- `app/globals.css`: shared tokens, responsive story styles, safe-area and control primitives
- `app/signin/page.tsx`: OAuth entry, referral preservation, loading and failure states
- `app/(app)/layout.tsx`: authenticated shell and route-level session handoff
- `components/TopNav.tsx`: curated phone/tablet/desktop navigation
- `app/(app)/lobby/page.tsx`: squad readiness and device preparation
- `app/(app)/matchmaking/page.tsx`: search state, cancellation, deduplicated handoff
- `app/(app)/match/page.tsx`: match confirmation and expiry
- `app/(app)/encounter/page.tsx`: live participant layout and media lifecycle
- `components/call/CallControls.tsx`: stable, accessible call-control bar
- `playwright.config.ts`: production-like browser test runner and viewport projects
- `e2e/*.spec.ts`: user-journey, responsive, reduced-motion, and visual contracts
- `docs/GIGGLE-WEB-CHECKLIST.md`: persistent milestone status
- `artifacts/visual-audit/`: screenshot evidence

### Task 1: Establish Browser-Level Safety Rails

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `playwright.config.ts`
- Create: `e2e/landing.spec.ts`
- Modify: `app/page.tsx`
- Modify: `docs/GIGGLE-WEB-CHECKLIST.md`

- [x] **Step 1: Install the existing ecosystem's browser-test package**

Run:

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

Expected: `@playwright/test` appears in `devDependencies`, and Chromium installs successfully.

- [x] **Step 2: Add browser-test scripts**

Add to `package.json`:

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:update": "playwright test --update-snapshots"
  }
}
```

- [x] **Step 3: Configure the five required viewport projects**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

const viewports = {
  phone: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1280, height: 800 },
  desktop: { width: 1440, height: 1100 },
  wide: { width: 1728, height: 1117 },
};

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  outputDir: "artifacts/playwright-results",
  snapshotPathTemplate: "artifacts/playwright-snapshots/{testFilePath}/{arg}-{projectName}{ext}",
  use: {
    baseURL: "http://localhost:4000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:4000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: Object.entries(viewports).map(([name, viewport]) => ({
    name,
    use: { browserName: "chromium", viewport },
  })),
});
```

- [x] **Step 4: Write the first failing landing contract**

Create `e2e/landing.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("landing exposes the product and one primary start action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("giggle-hero")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /your squad.*their squad.*live/i })).toBeVisible();
  await expect(page.getByTestId("giggle-hero").getByRole("link", { name: /get started/i })).toHaveAttribute("href", "/signin");
});
```

- [x] **Step 5: Run the test and confirm RED**

Run:

```bash
pnpm test:e2e --project=phone e2e/landing.spec.ts
```

Expected: FAIL because `giggle-hero` does not exist.

- [x] **Step 6: Mark the existing hero as the stable product surface**

In `app/page.tsx`, add the test id to the existing hero section:

```tsx
<section
  data-testid="giggle-hero"
  style={{ position: "relative", padding: `${isPhone ? 44 : 72}px ${pad}px ${isPhone ? 56 : 100}px` }}
>
```

- [x] **Step 7: Run the safety rails**

Run:

```bash
pnpm test
pnpm test:e2e --project=phone e2e/landing.spec.ts
pnpm build
```

Expected: all commands PASS.

- [x] **Step 8: Ignore generated evidence, keep curated screenshots**

Append to `.gitignore`:

```gitignore
artifacts/playwright-results/
artifacts/playwright-snapshots/
```

- [x] **Step 9: Mark Milestone 0 browser coverage complete and commit**

Update `docs/GIGGLE-WEB-CHECKLIST.md`, then run:

```bash
git add package.json pnpm-lock.yaml .gitignore playwright.config.ts e2e/landing.spec.ts app/page.tsx docs/GIGGLE-WEB-CHECKLIST.md
git commit -m "test: add Giggle responsive browser safety rails"
```

### Task 2: Repair the Existing Three-Use-Case Scroll Story

The repository already contained a strong `DemoStage`, scroll-progress hook, and
eight-second cinematic asset. Adding a second story would duplicate product copy
and increase landing-page length, so this task repairs and verifies the existing
surface in place.

**Files:**
- Modify: `app/page.tsx`
- Modify: `e2e/landing.spec.ts`
- Add: `public/landing/demo-poster.jpg`
- Modify: `docs/GIGGLE-WEB-CHECKLIST.md`

- [x] **Step 1: Capture the existing sequence and identify transition defects**

The initial start/middle/end audit showed adjacent large captions overlapping
during cross-fades.

- [x] **Step 2: Write and run a failing single-active-caption contract**

The browser test initially failed because the story and captions did not expose a
stable active-scene contract.

- [x] **Step 3: Mount one active caption at a time**

Keep video scrubbing continuous, but switch the caption as one keyed unit so
large display text never collides.

- [x] **Step 4: Add a real poster and reduced-motion composition**

Extract a representative frame from `demo.mp4`. Motion-enabled browsers use it
as the video poster; reduced-motion browsers render it directly and avoid the
sticky scroll track.

- [x] **Step 5: Verify the intended scene and decoded media pixels**

At progress `0.16`, `0.50`, and `0.84`, assert the expected heading, one active
caption, settled entrance opacity, decoded video time, luminance range, and
non-dark pixel ratio.

- [x] **Step 6: Capture all responsive and reduced-motion evidence**

Evidence lives in `artifacts/visual-audit/2026-07-12/landing-story/`.

- [x] **Step 7: Run the full unit, browser, and production-build gate**

- [x] **Step 8: Commit the repaired story**

### Task 3: Curate Shared Navigation by Device Class

**Files:**
- Modify: `components/useViewport.ts`
- Modify: `components/TopNav.tsx`
- Modify: `app/(app)/layout.tsx`
- Create: `e2e/navigation.spec.ts`
- Modify: `app/globals.css`

- [x] **Step 1: Write the failing navigation contracts**

Create `e2e/navigation.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("phone uses bottom navigation and desktop uses top navigation", async ({ page }, testInfo) => {
  await page.goto("/home");
  if (testInfo.project.name === "phone") {
    await expect(page.getByTestId("mobile-navigation")).toBeVisible();
    await expect(page.getByTestId("desktop-navigation")).toBeHidden();
  } else if (["desktop", "wide"].includes(testInfo.project.name)) {
    await expect(page.getByTestId("desktop-navigation")).toBeVisible();
    await expect(page.getByTestId("mobile-navigation")).toBeHidden();
  }
});
```

- [x] **Step 2: Run the contract and confirm RED**

```bash
pnpm test:e2e e2e/navigation.spec.ts
```

Expected: FAIL because the current nav has no separate phone surface.

- [x] **Step 3: Extend the viewport contract without adding a dependency**

Return these fields from `components/useViewport.ts`:

```ts
return {
  width,
  height,
  isPhone: width < 600,
  isTablet: width >= 600 && width < 1024,
  isDesktop: width >= 1024,
  isWide: width >= 1440,
  isNarrow: width < 1024,
};
```

- [x] **Step 4: Render dedicated phone and desktop navigation surfaces**

In `components/TopNav.tsx`, keep the existing `NAV` source and render two nav elements:

```tsx
<nav data-testid="desktop-navigation" className="gg-desktop-nav" aria-label="Primary navigation">
  {/* Existing desktop links from NAV */}
</nav>

<nav data-testid="mobile-navigation" className="gg-mobile-nav" aria-label="Primary navigation">
  {NAV.map(({ href, label, icon: ItemIcon }) => (
    <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
      <ItemIcon size={20} color={path === href ? "var(--violet-bright)" : "var(--text-muted)"} />
      <span>{label}</span>
    </Link>
  ))}
</nav>
```

Add CSS that fixes `.gg-mobile-nav` to the safe-area-aware bottom edge below 600px and hides it otherwise. Hide `.gg-desktop-nav` below 1024px and keep the compact icon top nav for tablet.

- [x] **Step 5: Protect page content from fixed navigation**

In `app/(app)/layout.tsx`, add `className="gg-app-main"` to `main`; in `app/globals.css`, add:

```css
@media (max-width: 599px) {
  .gg-app-main { padding-bottom: calc(92px + env(safe-area-inset-bottom)) !important; }
}
```

- [x] **Step 6: Verify and commit**

```bash
pnpm test:e2e e2e/navigation.spec.ts
pnpm build
git add components/useViewport.ts components/TopNav.tsx app/'(app)'/layout.tsx app/globals.css e2e/navigation.spec.ts
git commit -m "feat: curate Giggle navigation by device class"
```

### Task 4: Make Sign-In and Session Handoff Trustworthy

**Files:**
- Modify: `app/signin/page.tsx`
- Modify: `app/auth/callback/page.tsx`
- Modify: `packages/core/src/session.ts`
- Create: `e2e/signin.spec.ts`
- Modify: `docs/GIGGLE-WEB-CHECKLIST.md`

- [x] **Step 1: Write sign-in state contracts**

Create `e2e/signin.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("sign-in communicates purpose and keeps one primary provider action", async ({ page }) => {
  await page.goto("/signin?next=%2Flobby%3Fsquad%3Ddemo&ref=CREW42");
  await expect(page.getByRole("heading", { name: /join giggle/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  await expect(page.getByText(/name and email/i)).toBeVisible();
});

test("sign-in exposes provider failures as retryable alerts", async ({ page }) => {
  await page.route("**/api/auth/google**", route => route.abort("failed"));
  await page.goto("/signin");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
});
```

- [x] **Step 2: Run and confirm RED**

```bash
pnpm test:e2e --project=phone e2e/signin.spec.ts
```

Expected: at least the failure-state test FAILS.

- [x] **Step 3: Add a single retryable sign-in state machine**

In `app/signin/page.tsx`, use these explicit states:

```ts
type SignInStatus = "idle" | "redirecting" | "failed";
const [status, setStatus] = useState<SignInStatus>("idle");
const [error, setError] = useState("");
```

Set `redirecting` before constructing the OAuth URL. Catch URL/configuration failures, set `failed`, and render a `role="alert"` containing the backend-safe message plus a `Try again` button that restores `idle`.

- [x] **Step 4: Preserve only safe same-site continuation paths**

Add this helper beside the sign-in component:

```ts
function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/home";
  return value;
}
```

Store the validated continuation in per-tab `sessionStorage` before the full-page
OAuth redirect and validate it again in the callback before `router.replace`.
This preserves the backend's signed OAuth state contract without adding frontend
data to it.

- [x] **Step 5: Verify and commit**

```bash
pnpm test:e2e e2e/signin.spec.ts
pnpm --filter @giggle/core test
pnpm build
git add app/signin/page.tsx app/auth/callback/page.tsx packages/core/src/session.ts e2e/signin.spec.ts docs/GIGGLE-WEB-CHECKLIST.md
git commit -m "fix: make Giggle sign-in handoff explicit and retryable"
```

### Task 5: Put Lobby Readiness in the First Viewport

**Files:**
- Modify: `app/(app)/lobby/page.tsx`
- Modify: `app/globals.css`
- Create: `e2e/lobby.spec.ts`
- Modify: `docs/GIGGLE-WEB-CHECKLIST.md`

- [x] **Step 1: Write the first-viewport lobby contract**

Create `e2e/lobby.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("lobby keeps readiness and the next action in the first viewport", async ({ page }) => {
  await page.goto("/lobby?squad=demo");
  const readiness = page.getByTestId("lobby-readiness");
  await expect(readiness).toBeVisible();
  await expect(readiness.getByRole("button", { name: /ready|find a squad/i })).toBeVisible();
  const box = await readiness.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844 - 72);
});
```

- [x] **Step 2: Run and confirm RED**

```bash
pnpm test:e2e --project=phone e2e/lobby.spec.ts
```

Expected: FAIL because `lobby-readiness` does not exist.

- [x] **Step 3: Mark and reorder the existing readiness surface**

In `app/(app)/lobby/page.tsx`, add `data-testid="lobby-readiness"` to the existing ready/match command region. On phone, render it immediately after the squad header and media preview. Move cover, visibility, join policy, invite administration, and vibe editing behind the existing settings/sidebar controls.

- [x] **Step 4: Make device and readiness state explicit**

Expose the microphone and camera state through stable accessible names and
`aria-pressed`. Keep Find Match disabled with “Waiting for everyone” until every
current member is ready; do not silently mutate readiness when starting search.

- [x] **Step 5: Verify phone, tablet, desktop, and short phone**

```bash
pnpm test:e2e e2e/lobby.spec.ts
pnpm build
```

Capture 390x844, 768x1024, 1280x800, and 390x650 evidence under `artifacts/visual-audit/2026-07-12/lobby/`.

- [x] **Step 6: Update and commit**

```bash
git add app/'(app)'/lobby/page.tsx app/globals.css e2e/lobby.spec.ts docs/GIGGLE-WEB-CHECKLIST.md
git commit -m "feat: prioritize readiness in the Giggle lobby"
```

### Task 6: Make Matchmaking Progress and Recovery Explicit

**Files:**
- Modify: `app/(app)/matchmaking/page.tsx`
- Modify: `app/(app)/match/page.tsx`
- Create: `e2e/matchmaking.spec.ts`
- Modify: `docs/GIGGLE-WEB-CHECKLIST.md`

- [x] **Step 1: Write progress, cancel, and deduplication contracts**

Create `e2e/matchmaking.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("matchmaking explains progress and keeps cancel available", async ({ page }) => {
  await page.goto("/matchmaking?squad=demo");
  await expect(page.getByRole("status")).toContainText(/checking active squads|matching vibes|opening encounter/i);
  await expect(page.getByRole("button", { name: /cancel search/i })).toBeVisible();
});

test("match confirmation keeps join and skip stable", async ({ page }) => {
  await page.goto("/match?squad=demo&enc=enc-demo");
  await expect(page.getByRole("button", { name: /join encounter/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /skip/i })).toBeVisible();
});
```

- [x] **Step 2: Run and confirm RED**

```bash
pnpm test:e2e --project=phone e2e/matchmaking.spec.ts
```

- [x] **Step 3: Derive meaningful progress from elapsed time**

In `app/(app)/matchmaking/page.tsx`, add:

```ts
const progressLabel = elapsed < 4
  ? "Checking active squads"
  : elapsed < 10
  ? "Matching your squad's vibes"
  : "Finding the strongest live match";
```

Render it in an element with `role="status"` and `aria-live="polite"`. Keep the elapsed timer as secondary data.

- [x] **Step 4: Preserve the existing single-reveal guard**

Keep `revealedRef` as the single source of truth for socket and polling events. Add a named helper that returns early when already revealed and ensure both event paths call only that helper.

- [x] **Step 5: Make cancellation retryable without discarding squad state**

When `api.cancelSearch` fails, leave the page and squad intact, show `cancelError` with `role="alert"`, and change the same button label to `Try cancel again` after the failure.

- [x] **Step 6: Verify timers and navigation cleanup**

Run:

```bash
pnpm test:e2e e2e/matchmaking.spec.ts
pnpm build
```

Expected: browser tests PASS with no duplicate navigation or timer warnings.

- [x] **Step 7: Update and commit**

```bash
git add app/'(app)'/matchmaking/page.tsx app/'(app)'/match/page.tsx e2e/matchmaking.spec.ts docs/GIGGLE-WEB-CHECKLIST.md
git commit -m "feat: clarify Giggle matchmaking progress and recovery"
```

### Task 7: Stabilize Live Encounter Controls and Media States

**Files:**
- Create: `components/call/CallControls.tsx`
- Modify: `app/(app)/encounter/page.tsx`
- Modify: `app/globals.css`
- Create: `e2e/encounter.spec.ts`
- Modify: `docs/GIGGLE-WEB-CHECKLIST.md`

- [ ] **Step 1: Write control and layout contracts**

Create `e2e/encounter.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("encounter keeps participant media and controls visible", async ({ page }) => {
  await page.goto("/encounter?squad=demo&enc=enc-demo");
  await expect(page.getByTestId("encounter-stage")).toBeVisible();
  const controls = page.getByTestId("call-controls");
  await expect(controls).toBeVisible();
  await expect(controls.getByRole("button", { name: /mute microphone/i })).toBeVisible();
  await expect(controls.getByRole("button", { name: /turn camera off/i })).toBeVisible();
  await expect(controls.getByRole("button", { name: /leave|end encounter/i })).toBeVisible();
});

test("encounter does not render blank media frames", async ({ page }) => {
  await page.goto("/encounter?squad=demo&enc=enc-demo");
  const frames = page.locator("[data-media-frame]");
  await expect(frames.first()).toBeVisible();
  expect(await frames.count()).toBeGreaterThan(0);
  for (const frame of await frames.all()) {
    const box = await frame.boundingBox();
    expect(box?.width).toBeGreaterThan(80);
    expect(box?.height).toBeGreaterThan(80);
  }
});
```

- [x] **Step 2: Run and confirm RED**

```bash
pnpm test:e2e --project=phone e2e/encounter.spec.ts
```

- [x] **Step 3: Preserve the stable call-control surface**

The existing inline toolbar already owns reactions, chat, report, media toggles,
responsive sizing, hover state, and teardown behavior. Keep it in place and add
stable toolbar/control semantics instead of splitting a high-risk realtime
surface solely for file organization.

Reference shape retained in the route:

```tsx
"use client";

type Props = {
  micOn: boolean;
  camOn: boolean;
  ending: boolean;
  isLeader: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeave: () => void;
};

export function CallControls(props: Props) {
  return (
    <div data-testid="call-controls" className="gg-call-controls" role="toolbar" aria-label="Encounter controls">
      <button type="button" onClick={props.onToggleMic} aria-label={props.micOn ? "Mute microphone" : "Unmute microphone"}>Mic</button>
      <button type="button" onClick={props.onToggleCam} aria-label={props.camOn ? "Turn camera off" : "Turn camera on"}>Camera</button>
      <button type="button" onClick={props.onLeave} disabled={props.ending} className="gg-call-controls__end">
        {props.ending ? "Ending" : props.isLeader ? "End encounter" : "Leave"}
      </button>
    </div>
  );
}
```

Keep icons from the existing route when integrating; the visible labels may remain visually hidden if the icon and tooltip are present.

- [x] **Step 4: Verify stable control dimensions across rotation**

In `app/globals.css`, add:

```css
.gg-call-controls {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 80;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 8px;
  border: 1px solid var(--border-strong);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(18px);
  transform: translateX(-50%);
}
.gg-call-controls button { min-width: 46px; min-height: 46px; border-radius: 12px; }
.gg-call-controls__end { color: #fff; background: var(--coral); }
```

- [x] **Step 5: Mark the stage and media frames**

In `app/(app)/encounter/page.tsx`, add `data-testid="encounter-stage"` to the active stage wrapper and `data-media-frame` to the existing participant-tile root. Preserve all current Agora refs and track lifecycle code.

- [x] **Step 6: Verify interaction, resize, and reduced motion**

Run:

```bash
pnpm test:e2e e2e/encounter.spec.ts
pnpm build
```

Then capture phone portrait, phone landscape, tablet, desktop, wide desktop, and reduced-motion screenshots. Check the browser console and failed requests after mic/camera toggles, focus-mode changes, reactions, and leaving.

- [x] **Step 7: Update and commit**

```bash
git add components/call/CallControls.tsx app/'(app)'/encounter/page.tsx app/globals.css e2e/encounter.spec.ts docs/GIGGLE-WEB-CHECKLIST.md
git commit -m "feat: stabilize Giggle encounter media and controls"
```

### Task 8: Apply the System to Secondary Routes

**Files:**
- Modify: `app/(app)/home/page.tsx`
- Modify: `app/(app)/discover/page.tsx`
- Modify: `app/(app)/friends/page.tsx`
- Modify: `app/(app)/profile/page.tsx`
- Modify: `app/(app)/premium/page.tsx`
- Create: `e2e/product-routes.spec.ts`
- Modify: `docs/GIGGLE-WEB-CHECKLIST.md`

- [ ] **Step 1: Write route-level first-action contracts**

Create `e2e/product-routes.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const routes = [
  ["/home", /start|open|join/i],
  ["/discover", /discover|join/i],
  ["/friends", /invite|find/i],
  ["/profile", /edit profile/i],
] as const;

for (const [path, action] of routes) {
  test(`${path} exposes one clear first action`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main").getByRole("button", { name: action }).or(page.locator("main").getByRole("link", { name: action })).first()).toBeVisible();
  });
}
```

- [ ] **Step 2: Run and record failing routes**

```bash
pnpm test:e2e e2e/product-routes.spec.ts
```

- [ ] **Step 3: Refine one route at a time**

For each failing route, keep its existing data/API logic and apply these concrete rules:

```text
1. One h1 names the user's current task.
2. One primary action is visible before scrolling.
3. Repeated entities may be cards; page sections remain unframed.
4. Loading reserves final dimensions.
5. Empty and error states include one recovery command.
6. Phone layouts use 16px gutters and clear fixed navigation.
7. Tablet layouts never leave a pane narrower than 280px.
```

Run the single route's test after each route edit, then the full file.

- [ ] **Step 4: Keep Premium informational until payments are connected**

Do not add checkout. Keep plan comparison and entitlement explanation, and label unavailable purchase actions as `Coming soon` without presenting them as enabled controls.

- [ ] **Step 5: Verify and commit each route separately**

Use commits:

```bash
git commit -m "feat: refine Giggle home experience"
git commit -m "feat: refine Giggle discovery experience"
git commit -m "feat: refine Giggle friends experience"
git commit -m "feat: refine Giggle profile experience"
git commit -m "feat: refine Giggle premium information"
```

### Task 9: Run the Release Evidence Gate

**Files:**
- Modify: `docs/GIGGLE-WEB-CHECKLIST.md`
- Create: `docs/GIGGLE-WEB-HANDOFF.md`

- [ ] **Step 1: Run all automated checks from a clean install**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm --filter @giggle/core test
pnpm test:e2e
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 2: Run the local product stack**

```bash
pnpm dev
```

Expected frontend URL: `http://localhost:4000`.

Expected backend source: `NEXT_PUBLIC_BACKEND_URL` from `.env.local`, falling back to `http://localhost:3001` only in local development.

- [ ] **Step 3: Audit runtime evidence**

For landing, sign-in, lobby, matchmaking, match, encounter, home, discover, friends, profile, and premium:

```text
- Capture target viewport screenshots.
- Check console errors.
- Check failed network requests.
- Check horizontal overflow.
- Check text/control overlap.
- Check keyboard navigation.
- Check reduced motion.
- Check media frames for nonblank pixels.
```

- [ ] **Step 4: Write the operational handoff**

Create `docs/GIGGLE-WEB-HANDOFF.md` with:

```markdown
# Giggle Web Handoff

## Run Locally
## Required Environment
## Test Commands
## Production Build
## Route and Viewport Evidence
## Known Risks
## Deferred Work
## Deployment
```

Fill each section only with verified current-state evidence and exact commands.

- [ ] **Step 5: Close the persistent checklist**

Mark only evidence-backed items complete in `docs/GIGGLE-WEB-CHECKLIST.md`. Leave unsupported items unchecked.

- [ ] **Step 6: Commit the evidence and handoff**

```bash
git add docs/GIGGLE-WEB-CHECKLIST.md docs/GIGGLE-WEB-HANDOFF.md artifacts/visual-audit
git commit -m "docs: record Giggle web release evidence"
```
