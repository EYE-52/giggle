const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = () => readFileSync(path.join(__dirname, "../next.config.ts"), "utf8");
const playwrightConfigSource = () => readFileSync(path.join(__dirname, "../playwright.config.ts"), "utf8");
const landingSource = () => readFileSync(path.join(__dirname, "../app/page.tsx"), "utf8");
const rootLayoutSource = () => readFileSync(path.join(__dirname, "../app/layout.tsx"), "utf8");
const matchmakingSource = () => readFileSync(path.join(__dirname, "../app/(app)/matchmaking/page.tsx"), "utf8");
const matchSource = () => readFileSync(path.join(__dirname, "../app/(app)/match/page.tsx"), "utf8");
const lobbySource = () => readFileSync(path.join(__dirname, "../app/(app)/lobby/page.tsx"), "utf8");
const encounterSource = () => readFileSync(path.join(__dirname, "../app/(app)/encounter/page.tsx"), "utf8");
const encounterE2eSource = () => readFileSync(path.join(__dirname, "../e2e/encounter.spec.ts"), "utf8");
const venueCardSource = () => readFileSync(path.join(__dirname, "../components/VenueCard.tsx"), "utf8");
const authCallbackSource = () => readFileSync(path.join(__dirname, "../app/auth/callback/page.tsx"), "utf8");
const authCallbackLayoutSource = () => readFileSync(path.join(__dirname, "../app/auth/callback/layout.tsx"), "utf8");
const signinSource = () => readFileSync(path.join(__dirname, "../app/signin/page.tsx"), "utf8");
const avatarPickerSource = () => readFileSync(path.join(__dirname, "../components/AvatarPicker.tsx"), "utf8");
const coverPickerSource = () => readFileSync(path.join(__dirname, "../components/CoverPicker.tsx"), "utf8");
const modalSource = () => readFileSync(path.join(__dirname, "../components/Modal.tsx"), "utf8");
const legalPageSource = () => readFileSync(path.join(__dirname, "../components/LegalPage.tsx"), "utf8");
const notificationBellSource = () => readFileSync(path.join(__dirname, "../components/NotificationBell.tsx"), "utf8");
const ageGateSource = () => readFileSync(path.join(__dirname, "../components/AgeGate.tsx"), "utf8");
const desktopHomeSource = () => readFileSync(path.join(__dirname, "../app/(app)/home/page.tsx"), "utf8");
const desktopDiscoverSource = () => readFileSync(path.join(__dirname, "../app/(app)/discover/page.tsx"), "utf8");
const friendsPageSource = () => readFileSync(path.join(__dirname, "../app/(app)/friends/page.tsx"), "utf8");
const inviteToSquadSource = () => readFileSync(path.join(__dirname, "../components/InviteToSquad.tsx"), "utf8");
const squadPreviewSource = () => readFileSync(path.join(__dirname, "../components/SquadPreview.tsx"), "utf8");
const profileSource = () => readFileSync(path.join(__dirname, "../app/(app)/profile/page.tsx"), "utf8");
const chatPanelSource = () => readFileSync(path.join(__dirname, "../components/ChatPanel.tsx"), "utf8");
const referralCardSource = () => readFileSync(path.join(__dirname, "../components/ReferralCard.tsx"), "utf8");
const appLayoutSource = () => readFileSync(path.join(__dirname, "../app/(app)/layout.tsx"), "utf8");
const joinByCodeSource = () => readFileSync(path.join(__dirname, "../app/join/[code]/page.tsx"), "utf8");
const topNavSource = () => readFileSync(path.join(__dirname, "../components/TopNav.tsx"), "utf8");
const privacySource = () => readFileSync(path.join(__dirname, "../app/privacy/page.tsx"), "utf8");
const termsSource = () => readFileSync(path.join(__dirname, "../app/terms/page.tsx"), "utf8");
const safetyPath = path.join(__dirname, "../app/safety/page.tsx");
const supportPath = path.join(__dirname, "../app/support/page.tsx");
const safetySource = () => readFileSync(safetyPath, "utf8");
const supportSource = () => readFileSync(supportPath, "utf8");
const globalStylesSource = () => readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
const vercelConfig = () => JSON.parse(readFileSync(path.join(__dirname, "../../../vercel.json"), "utf8"));
const discoveryConfigSource = () => readFileSync(path.join(__dirname, "../lib/discovery.ts"), "utf8");
const identityAccountPath = path.join(__dirname, "../components/IdentityOnlyAccount.tsx");

test("web discovery build flag hides stranger matching without hiding private squads", () => {
  const config = discoveryConfigSource();
  const layout = appLayoutSource();
  const nav = topNavSource();
  const home = desktopHomeSource();
  const lobby = lobbySource();
  const encounter = encounterSource();

  assert.match(config, /process\.env\.NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED/);
  assert.match(config, /flag !== "false"/);
  assert.match(layout, /WEB_DISCOVERY_ENABLED/);
  for (const route of ["discover", "matchmaking", "match"]) {
    assert.match(layout, new RegExp(`"/${route}"`));
  }
  assert.doesNotMatch(layout, /DISCOVERY_ROUTES = \[[^\]]*"\/encounter"/);
  assert.match(nav, /WEB_DISCOVERY_ENABLED/);
  assert.match(home, /WEB_DISCOVERY_ENABLED/);
  assert.match(home, /if \(!WEB_DISCOVERY_ENABLED\) return `\/lobby\?squad=\$\{squad\.squadId\}`/);
  assert.match(home, /aria-label="Squad invite code"/i);
  assert.match(lobby, /WEB_DISCOVERY_ENABLED && isLeader/);
  assert.match(encounter, /WEB_DISCOVERY_ENABLED && \(/);
  assert.equal(vercelConfig().env.NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED, "false");
  assert.doesNotMatch(config, /AGE|country|Country/);
});

test("desktop keeps unavailable accounts on an identity-only profile surface", () => {
  const layout = appLayoutSource();
  const gate = ageGateSource();

  assert.match(layout, /const identityOnlyAccess = authReady && session\.hasIdentityOnlyAccess/);
  assert.match(layout, /identityOnlyAccess && session\.accountStatus !== "active" && pathname !== "\/profile"/);
  assert.match(layout, /router\.replace\("\/profile"\)/);
  assert.match(layout, /identityOnlyAccess && pathname === "\/profile"/);
  assert.match(layout, /<AgeGate[\s\S]*onManageAccount=\{\(\) => router\.push\("\/profile"\)\}/);
  assert.match(layout, /<IdentityOnlyAccount[\s\S]*onReturnToVerification/);
  assert.match(gate, /onManageAccount\?: \(\) => void/);
  assert.match(gate, /Account &amp; data/);
  assert.ok(layout.indexOf("if (identityRouteBlocked)") < layout.indexOf("if (!hasAdultAccess)"));
  assert.equal(existsSync(identityAccountPath), true);

  const account = readFileSync(identityAccountPath, "utf8");
  assert.match(account, /api\.exportAccount\(\)/);
  assert.match(account, /api\.deleteAccount\(\)/);
  assert.match(account, /href="\/support"/);
  assert.match(account, /session\.signOut\(\)/);
  assert.match(account, /onReturnToVerification/);
  assert.match(account, /Return to age verification/);
  assert.doesNotMatch(account, /updateMyProfile|listBlockedUsers|connectSocket|billing/);
});

test("desktop confirms blocks separately from removing friends and lets users unblock accounts", () => {
  const friends = friendsPageSource();
  const profile = profileSource();

  assert.match(friends, /setConfirmBlock/);
  assert.match(friends, /Block \{confirmBlock\.name\}\?/);
  assert.match(friends, /api\.blockUsers\(\[confirmBlock\.userId\]\)/);
  assert.match(friends, /Remove friend/);
  assert.match(profile, /Blocked accounts/);
  assert.match(profile, /api\.listBlockedUsers\(\)/);
  assert.match(profile, /api\.unblockUser\(account\.userId\)/);
});

test("auth proxy never falls back to a production backend", () => {
  const config = source();

  assert.equal(config.includes("giggle-server-production.up.railway.app"), false);
});

test("public legal, safety, and support pages state the adult policy without false claims", () => {
  assert.equal(existsSync(safetyPath), true);
  assert.equal(existsSync(supportPath), true);

  const pages = [privacySource(), termsSource(), safetySource(), supportSource()];
  for (const page of pages) {
    assert.match(page, /verified (?:users |adults )?18\+/i);
    assert.match(page, /2026-08-04/);
  }

  const allCopy = pages.join("\n");
  assert.doesNotMatch(allCopy, /Giggle records calls/i);
  assert.doesNotMatch(allCopy, /stores raw Yoti (?:selfies|documents)/i);
  assert.doesNotMatch(allCopy, /accepts sexual content/i);
  assert.doesNotMatch(allCopy, /globally certified/i);

  const support = supportSource();
  for (const subject of ["Account%20help", "Age%20verification%20appeal", "Safety%20report", "Data%20export", "Account%20deletion"]) {
    assert.match(support, new RegExp(`mailto:support@gigglemeet\\.com\\?subject=${subject}`));
  }
  assert.doesNotMatch(support, /<form/i);
});

test("landing and legal layout link every public policy and help route", () => {
  const landing = landingSource();
  for (const route of ["privacy", "terms", "safety", "support"]) {
    assert.match(landing, new RegExp(`href=\"/${route}\"`));
  }

  const legal = legalPageSource();
  assert.match(legal, /links: Array<\{ href: string; label: string \}>/);
  assert.match(legal, /links\.map\(\(link\) =>/);
});

test("auth proxy local fallback is development-only", () => {
  const config = source();

  assert.equal(config.includes('"http://localhost:3001"'), true);
  assert.equal(config.includes('process.env.NODE_ENV === "production"'), true);
  assert.equal(config.includes("NEXT_PUBLIC_BACKEND_URL is required in production"), true);
});

test("Vercel explicitly configures the public backend without an app fallback", () => {
  assert.equal(
    vercelConfig().env.NEXT_PUBLIC_BACKEND_URL,
    "https://giggle-server-production.up.railway.app",
  );
  assert.equal(source().includes("giggle-server-production.up.railway.app"), false);
  assert.equal(vercelConfig().buildCommand, "pnpm --filter @giggle/desktop build");
  assert.equal(vercelConfig().outputDirectory, "apps/desktop/.next");
});

test("frontend workspace pins a supported Node runtime", () => {
  const packageJson = require("../package.json");
  const nodeVersion = readFileSync(path.join(__dirname, "../.node-version"), "utf8").trim();

  assert.equal(packageJson.engines.node, ">=20.18 <25");
  assert.match(nodeVersion, /^22\./);
});

test("Playwright owns isolated backend and frontend development servers", () => {
  const config = playwrightConfigSource();

  assert.equal((config.match(/http:\/\/localhost:4011/g) ?? []).length, 2);
  assert.equal(config.includes("webServer: ["), true);
  assert.equal(config.includes('command: "pnpm --dir ../../server start"'), true);
  assert.equal(config.includes('JWT_SECRET: "giggle-e2e-only-secret"'), true);
  assert.equal(config.includes('MONGODB_URI: "mongodb://127.0.0.1:27017/giggle"'), true);
  assert.equal(config.includes('MONGODB_DB_NAME: "giggle-e2e"'), true);
  assert.equal(config.includes('REDIS_URL: "redis://127.0.0.1:6379/15"'), true);
  assert.equal(config.includes('command: "pnpm exec next dev -p 4011"'), true);
  assert.equal(config.includes("reuseExistingServer: false"), true);
});

test("Next traces workspace packages from this repository root", () => {
  const config = source();
  assert.equal((config.match(/path\.resolve\(__dirname, "\.\.\/\.\."\)/g) ?? []).length, 2);
});

test("desktop app sets baseline browser security headers", () => {
  const config = source();

  for (const header of [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    assert.equal(config.includes(header), true);
  }
  assert.equal(config.includes("frame-ancestors 'none'"), true);
  assert.equal(config.includes("object-src 'none'"), true);
  assert.equal(config.includes("base-uri 'self'"), true);
});

test("dark violet actions keep readable foreground contrast", () => {
  const darkTheme = globalStylesSource().split('\n[data-theme="light"] {')[0];
  assert.equal(darkTheme.includes("--on-accent: #FFFFFF"), true);
  assert.equal(darkTheme.includes("--on-accent: #0B0B0F"), false);
});

test("root body tolerates browser extension attributes injected before hydration", () => {
  assert.match(rootLayoutSource(), /<body suppressHydrationWarning style=/);
});

test("encounter keeps the approved flat stage and puts blur inside full-view tiles", () => {
  const page = encounterSource();
  const tile = readFileSync(path.join(__dirname, "../components/ParticipantVideoTile.tsx"), "utf8");
  assert.equal(page.includes("<EncounterAtmosphere"), false);
  assert.match(tile, /hasVideo && fit === "fit" && <video/);
  assert.match(tile, /data-media-backdrop/);
});

test("encounter uses Social Cinema chrome and one clipped media frame", () => {
  const page = encounterSource();

  assert.equal(page.includes('data-testid="encounter-shell"'), true);
  assert.equal(page.includes('data-theme="dark"'), false);
  assert.doesNotMatch(page, />vs<\/span>/i);
  assert.equal(page.includes("function SplitRoomBackdrop"), false);
  assert.equal(page.includes("function CoverThumb"), false);
  assert.match(page, /renderParticipant\(person\.id, "fit"\)/);
  assert.match(page, /\[data-media-host\][\s\S]*overflow: clip !important/);
  const tileStyles = readFileSync(path.join(__dirname, "../components/ParticipantVideoTile.module.css"), "utf8");
  assert.match(tileStyles, /contain:paint/);
});

test("encounter owns controlled chat state across panel remounts", () => {
  const page = encounterSource();
  const chat = chatPanelSource();

  assert.match(page, /const \[chatMessages, setChatMessages\]/);
  assert.match(page, /messages=\{chatMessages\}/);
  assert.match(page, /onSend=\{sendEncounterMessage\}/);
  assert.match(chat, /delivery\?: "sending" \| "delivered" \| "failed"/);
  assert.match(chat, />\s*Retry\s*<\/button>/);
});

test("calling routes give the full viewport to video", () => {
  const layout = appLayoutSource();
  const styles = globalStylesSource();

  assert.equal(layout.includes("{!isCalling && <TopNav />}"), true);
  assert.equal(layout.includes("<TopNav />\n      <main"), false);
  assert.equal(layout.includes('isCalling ? " gg-app-main--calling" : ""'), true);
  assert.equal(styles.includes(".gg-app-main:not(.gg-app-main--calling)"), true);
});

test("signed-in shell lets keyboard users skip repeated navigation", () => {
  const layout = appLayoutSource();
  assert.equal(layout.includes('href="#main-content"'), true);
  assert.equal(layout.includes('id="main-content"'), true);
  assert.equal(layout.includes('tabIndex={-1}'), true);
});

test("compact phones keep notifications visible in the top navigation", () => {
  const nav = topNavSource();

  assert.equal(nav.includes("<NotificationBell"), true);
  assert.equal(nav.includes('className="gg-header-actions"'), true);
});

test("desktop CSP allows the configured backend origin for live API calls", () => {
  const config = source();

  assert.equal(config.includes("const BACKEND_CONNECT_SRC = new URL(AUTH_BACKEND_URL).origin;"), true);
  assert.equal(config.includes('"connect-src \'self\' https: wss:"'), false);
  assert.equal(config.includes("`connect-src 'self' ${BACKEND_CONNECT_SRC} ${BACKEND_SOCKET_CONNECT_SRC} https: wss:`"), true);
  // Uploaded squad covers are served by the backend (http://localhost in dev).
  assert.equal(config.includes("`img-src 'self' ${BACKEND_CONNECT_SRC} data: blob: https:`"), true);
});

test("desktop CSP allows the configured backend websocket origin for sockets", () => {
  const config = source();

  assert.equal(config.includes("const BACKEND_SOCKET_CONNECT_SRC = socketUrl.origin;"), true);
  assert.equal(config.includes('socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";'), true);
  assert.equal(config.includes("`connect-src 'self' ${BACKEND_CONNECT_SRC} ${BACKEND_SOCKET_CONNECT_SRC} https: wss:`"), true);
});

test("landing page does not expose decorative default-cursor buttons", () => {
  const page = landingSource();

  assert.equal(page.includes("<button style={{ width: 30"), false);
  assert.equal(page.includes('cursor: "default" }}><Icon.close'), false);
  assert.equal(page.includes('cursor: "default", boxShadow'), false);
});

test("landing page footer links keep a minimum touch target", () => {
  const page = landingSource();

  const css = readFileSync(path.join(__dirname, "../app/revamp.css"), "utf8");
  assert.match(css, /\.gg-welcome-footer a \{[^}]*min-width:44px; min-height:44px/);
});

test("coarse pointers enforce app-wide minimum touch targets", () => {
  const styles = globalStylesSource();
  const coarsePointer = styles.slice(styles.indexOf("@media (pointer: coarse)"));

  assert.match(coarsePointer, /button,[\s\S]*a\[href\],[\s\S]*\[role="button"\][\s\S]*min-width: 44px;[\s\S]*min-height: 44px;/);
});











test("public legal pages do not expose internal launch placeholders", () => {
  const copy = `${privacySource()}\n${termsSource()}`;
  assert.equal(copy.includes("preview policy"), false);
  assert.equal(copy.includes("preview terms"), false);
  assert.equal(copy.includes("Replace it with reviewed legal copy"), false);
  assert.equal(copy.includes("before production launch"), false);
  assert.equal(termsSource().includes("Tokens and Giggle+"), true);
  assert.equal(legalPageSource().includes('data-theme="dark"'), false);
});









test("matchmaking queue status is informational, not a premium priority upsell", () => {
  const page = matchmakingSource();

  assert.equal(page.includes('<button\\n              style={{\\n                padding: "14px 36px", borderRadius: 999, cursor: "default"'), false);
  assert.equal(page.includes('role="status"'), true);
  assert.equal(page.includes("Checking active squads"), true);
  assert.equal(page.includes("Matching your squad's vibes"), true);
  assert.equal(page.includes("Finding the strongest live match"), true);
  assert.equal(page.includes("Finding your squad"), false);
  assert.equal(page.includes("Fast Pass"), false);
  assert.equal(page.includes("priority"), false);
  assert.equal(page.includes('router.push("/premium")'), false);
  assert.equal(page.includes('billing.hasPerk("fast_pass")'), false);
});

test("compact-phone matchmaking keeps the cancel action in view", () => {
  const page = matchmakingSource();
  assert.equal(page.includes("const isShortPhone = isPhone && height <= 650"), true);
  assert.equal(page.includes("const signalSize = isShortPhone ? 48"), true);
  assert.equal(page.includes('<div aria-hidden style={{ width: signalSize'), true);
  assert.equal(page.includes('overflowY: isPhone ? "auto" : "hidden"'), true);
  assert.equal(page.includes("!matchFound && !isShortPhone"), true);
});

test("matchmaking inherits the active theme without radar decoration", () => {
  const page = matchmakingSource();

  assert.equal(page.includes('data-theme="dark"'), false);
  assert.equal(page.includes("conic-gradient"), false);
  assert.equal(page.includes("#7C5CFF"), false);
  assert.equal(page.includes("#C2FF3D"), false);
  assert.equal(page.includes('<AvatarStack names={squadMemberNames}'), true);
  assert.equal(page.includes('background: "var(--accent-soft)"'), true);
  assert.equal(page.includes('background: "var(--surface)"'), true);
});

test("desktop matchmaking cancel stays put when backend cancel fails", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("const [cancelError, setCancelError]"), true);
  assert.equal(page.includes("Couldn't cancel search. Your squad is still in the queue."), true);
  assert.equal(page.includes("setCancelError((e as"), false);
  assert.equal(page.includes('cancelError ? "Try cancel again" : "Cancel search"'), true);
  assert.equal(page.includes('router.push(`/lobby?squad=${squadId}`);'), true);
});

test("desktop matchmaking resumes an existing encounter regardless of handoff state", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("if (status.match?.encounterId)"), true);
  assert.equal(page.includes('if (status.state === "matched" && status.match)'), false);
  assert.equal(page.includes("triggerMatchReveal(status.match.encounterId);"), true);
});

test("desktop matchmaking never overlaps status polls", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("const pollInterval = setInterval"), false);
  assert.match(page, /await api\.matchStatus\(squadId\)/);
  assert.match(page, /pollTimeout = setTimeout\(pollStatus, 2000\)/);
});

test("desktop matchmaking resumes polling when cancel fails", () => {
  const page = matchmakingSource();

  assert.match(page, /if \(cancelledRef\.current\) \{\s*schedulePoll\(\);\s*return;\s*\}/);
  assert.match(page, /cancelledRef\.current = false;\s*setCancelling\(false\)/);
});

test("desktop match does not return to matchmaking when leader skip fails", () => {
  const page = matchSource();

  assert.equal(page.includes("const [actionError, setActionError]"), true);
  assert.equal(page.includes("setActionError((e as { message?: string })?.message || \"Couldn't skip this match yet.\")"), true);
  assert.equal(page.includes("} catch {}"), false);
});

test("desktop match clears delayed handoff navigations on unmount", () => {
  const page = matchSource();

  assert.equal(page.includes("const joinNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);"), true);
  assert.equal(page.includes("const expiredNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);"), true);
  assert.equal(page.includes("function clearDeferredNavigation()"), true);
  assert.equal(page.includes("clearDeferredNavigation();"), true);
  assert.equal(page.includes("joinNavTimeoutRef.current = setTimeout(() => {"), true);
  assert.equal(page.includes("expiredNavTimeoutRef.current = setTimeout(() => {"), true);
});

test("desktop match countdown follows the server handoff deadline", () => {
  const page = matchSource();

  assert.equal(page.includes("const deadline = Date.parse(encounterData.expiresAt);"), true);
  assert.equal(page.includes("const secondsLeft = Math.ceil((deadline - Date.now()) / 1000);"), true);
  assert.equal(page.includes("setCountdownTotal(secondsLeft);"), true);
  assert.equal(page.includes("Math.max(0, Math.ceil((deadline - Date.now()) / 1000))"), true);
  assert.equal(page.includes('aria-label={`${countdown} of ${countdownTotal} seconds remaining`}'), true);
  assert.equal(page.includes("useState(20)"), false);
  assert.equal(page.includes("Starts in {countdown}s"), true);
});

test("desktop match keeps recoverable load and join failures on the handoff", () => {
  const page = matchSource();
  const join = page.slice(page.indexOf("async function handleJoin"), page.indexOf("async function handleSkip"));

  assert.equal(page.includes("function isExpiredEncounterError"), true);
  assert.equal(page.includes('setHandoffError(expired ? "This match handoff has expired." : error instanceof Error ? error.message : "Couldn\'t load this match.")'), true);
  assert.equal(page.includes('{handoffExpired ? "Match expired" : "Couldn\'t open room"}'), true);
  assert.equal(page.includes("window.location.reload()"), true);
  assert.equal(join.includes("if (isExpiredEncounterError(error))"), true);
  assert.equal(join.includes("setJoining(false);"), true);
  assert.equal(join.includes("setActionError(error instanceof Error ? error.message : \"Couldn't join this encounter yet.\")"), true);
});

test("desktop match preserves leader and roster data when squad detail is unavailable", () => {
  const page = matchSource();

  assert.equal(page.includes("const encounterMembers = encounter"), true);
  assert.equal(page.includes("?? encounterMembers.find(m => m.userId === session.user?.id)"), true);
  assert.equal(page.includes("const myMembers = (squad?.members ?? encounterMembers).map(m => m.displayName);"), true);
});

test("mobile match keeps the action card in normal flow", () => {
  const page = matchSource();

  assert.equal(page.includes('width: "min(640px, 100%)"'), true);
  assert.equal(page.includes('gridTemplateColumns: isPhone ? "1fr" : "1fr 1fr"'), true);
});

test("desktop match uses a theme-native Room ready handoff", () => {
  const page = matchSource();

  assert.equal(page.includes('data-theme="dark"'), false);
  assert.equal(page.includes(">VS<"), false);
  assert.equal(page.includes("resolveCover"), false);
  assert.equal(page.includes("Room ready"), true);
  assert.equal(page.includes('<AvatarStack names={myMembers}'), true);
  assert.equal(page.includes('<AvatarStack names={opponentMembers}'), true);
  assert.equal(page.includes('background: "var(--surface)"'), true);
  assert.equal(page.includes('aria-label="Opening room"'), true);
  assert.equal(page.includes('role="group" aria-label={rosterLabel}'), true);
  assert.equal(page.includes('const rosterLabel = `${mySquadName}: ${myMembers.join(", ")}. ${pairedSquadName}: ${opponentMembers.join(", ")}`;'), true);
});

test("desktop match keeps handoff actions reachable in phone landscape", () => {
  const page = matchSource();

  assert.match(page, /overflowY: "auto"/);
});

test("desktop match expiry does not navigate away when leader skip fails", () => {
  const page = matchSource();
  const expiryBlock = page.slice(
    page.indexOf("// On countdown expiry"),
    page.indexOf("const [joinExpired")
  );

  assert.match(expiryBlock, /let cancelled = false;/);
  assert.match(expiryBlock, /await api\.skip\(squadId, encId\);/);
  assert.match(expiryBlock, /setActionError\(\(e as \{ message\?: string \}\)\?\.message \|\| "Couldn't refresh this match yet\."\);/);
  assert.match(expiryBlock, /return;/);
  assert.equal(expiryBlock.includes("api.skip(squadId, encId).catch(() => {});"), false);
  assert.equal(expiryBlock.indexOf("navigate(`/matchmaking?squad=${squadId}`);") > expiryBlock.indexOf("await api.skip(squadId, encId);"), true);
});

test("desktop matchmaking clears delayed match reveal navigations on unmount", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);"), true);
  assert.equal(page.includes("function clearRevealTimers()"), true);
  assert.equal(page.includes("clearRevealTimers();"), true);
  assert.equal(page.includes("revealTimeoutRef"), false);
  assert.equal(page.includes("setMatchVisible"), false);
  assert.equal(page.includes("navigationTimeoutRef.current = setTimeout(() => {"), true);
});

test("lobby missing-squad state is a polished empty state with mobile touch targets", () => {
  const page = lobbySource();

  assert.equal(page.includes("Squad not found. <button"), false);
  assert.equal(page.includes("This lobby link is no longer active"), true);

  assert.equal(page.includes('router.push("/discover")'), true);
});

test("approved lobby has a bounded stage and one invite entry beside people", () => {
  const page = lobbySource();
  const css = readFileSync(path.join(__dirname, "../app/(app)/lobby/lobby.module.css"), "utf8");
  assert.match(page, /data-testid="lobby-person"/);
  assert.match(page, /Invite a friend/);
  assert.match(css, /max-height: 420px/);
  assert.match(css, /overflow-y: auto/);
  assert.doesNotMatch(page, /Waiting for your squad…/);
});

test("desktop lobby leave starts pending feedback and media cleanup before the backend", () => {
  const page = lobbySource();
  const leaveBlock = page.slice(
    page.indexOf("async function handleLeaveSquad()"),
    page.indexOf("async function handleDisbandSquad()")
  );

  assert.match(leaveBlock, /setLeavingSquad\(true\);/);
  assert.match(leaveBlock, /const mediaExit = leaveLobbyMedia\(\);/);
  assert.match(leaveBlock, /await api\.leaveSquad\(squadId\);/);
  assert.ok(leaveBlock.indexOf("setLeavingSquad(true);") < leaveBlock.indexOf("await api.leaveSquad(squadId);"));
  assert.ok(leaveBlock.indexOf("const mediaExit = leaveLobbyMedia();") < leaveBlock.indexOf("await api.leaveSquad(squadId);"));
  assert.match(leaveBlock, /void mediaExit;/);
  assert.match(page, /async function leaveLobbyMedia\(\) \{[\s\S]*?vcRef\.current = null;[\s\S]*?setVideoJoined\(false\);[\s\S]*?await client\?\.leave\(\);/);
  assert.match(page, /loading=\{leavingSquad\} onClick=\{handleLeaveSquad\}/);
  assert.match(leaveBlock, /setMatchError\(\(e as \{ message\?: string \}\)\?\.message \|\| "Couldn't leave squad\."\)/);
  assert.equal(page.includes("onClick={handleLeaveSquad}"), true);

});

test("desktop lobby ready toggle surfaces backend failures", () => {
  const page = lobbySource();
  const handler = page.match(/async function handleReady\(\) \{([\s\S]*?)\n  \}\n\n  async function handleFindMatch/)?.[1] ?? "";

  assert.equal(page.includes("setMatchError((e as { message?: string })?.message || \"Couldn't update ready status.\")"), true);
  assert.equal(page.includes('console.error("setReady failed:", e);'), false);
  assert.match(handler, /setSquad\(current =>/);
  assert.doesNotMatch(handler, /await fetchSquad\(\)/);
  assert.match(page, /typeof ready === "boolean"/);
  assert.match(page, /member\.memberId === memberId \? \{ \.\.\.member, ready \} : member/);
});

test("desktop lobby requires every online member to be ready before starting a match", () => {
  const page = lobbySource();
  const proceedFindMatch = page.match(/async function proceedFindMatch\(\) \{([\s\S]*?)\n  \}\n\n  function toggleVibeChip/)?.[1] ?? "";

  assert.equal(page.includes("try { await api.setReady(squadId, true); } catch {}"), false);
  assert.equal(page.includes("try { await api.setLobbyVideo(squadId, true); } catch {}"), false);
  assert.equal(page.includes("const activeMembers = (squad?.members ?? []).filter(m => m.online !== false);"), true);
  assert.equal(page.includes("const everyoneReady = activeMembers.length > 0 && activeMembers.every(member => member.ready);"), true);
  assert.equal(page.includes("Everyone online needs to be ready before you find a match."), true);
  assert.equal(page.includes("await api.setReady(squadId, true);\n      await api.setLobbyVideo"), false);
  assert.match(proceedFindMatch, /await api\.startSearch\(squadId\)/);
  assert.doesNotMatch(proceedFindMatch, /setLobbyVideo/);
});

test("lobby asks before starting camera and microphone", () => {
  const page = lobbySource();


  assert.equal(page.includes('aria-label="Enable camera and microphone"'), true);
  assert.equal(page.includes("if (!joinStartedRef.current)"), false);
});

test("desktop lobby joins audio before continuing without camera", () => {
  const page = lobbySource();

  assert.match(page, /async function enableLobbyMedia\(withCamera = true\)/);
  assert.match(page, /await vc\.join\(tokenData, \{ audio: true, video: withCamera \}\)/);
  assert.equal(page.includes("onClick={enableLobbyMedia}"), false);
  assert.match(page, /ok = await enableLobbyMedia\(false\)/);
  assert.match(page, /if \(!ok\) return;[\s\S]*?await proceedFindMatch\(\)/);
});

test("desktop lobby copy actions only show success after clipboard writes succeed", () => {
  const page = lobbySource();

  assert.equal(page.includes("async function copyToClipboard("), true);
  assert.equal(page.includes("await navigator.clipboard.writeText(text);"), true);
  assert.equal(page.includes("setMatchError(failureMessage);"), true);
  assert.equal(page.includes("setInviteCopied(true);"), true);
  assert.equal(page.includes("setCodeCopied(true)"), true);
  assert.equal(page.includes("try { navigator.clipboard?.writeText(text); } catch {}"), false);
  assert.equal(page.includes("navigator.clipboard?.writeText(squad.squadCode); setCodeCopied(true);"), false);
});

test("referral copy does not show success when browser copy fails", () => {
  const component = referralCardSource();

  assert.equal(component.includes("const [copyError, setCopyError]"), true);
  assert.equal(component.includes("async function writeReferralLink()"), true);
  assert.equal(component.includes("const copiedOk = document.execCommand(\"copy\");"), true);
  assert.equal(component.includes("return copiedOk;"), true);
  assert.equal(component.includes("if (!copiedOk) {"), true);
  assert.equal(component.includes("setCopyError(\"Couldn't copy invite link. Select the link and copy it manually.\")"), true);
  assert.equal(component.includes("setCopied(true);"), true);
  assert.equal(component.indexOf("setCopied(true);") > component.indexOf("if (!copiedOk) {"), true);
  assert.equal(component.includes("try { document.execCommand(\"copy\"); } catch {}"), false);
});

test("desktop lobby vibe and name saves surface backend failures", () => {
  const page = lobbySource();

  assert.equal(page.includes("setMatchError((e as { message?: string })?.message || \"Couldn't save vibes.\")"), true);
  assert.equal(page.includes("setMatchError((e as { message?: string })?.message || \"Couldn't rename squad.\")"), true);
  assert.equal(page.includes('console.error("setTags failed:", e);'), false);
  assert.equal(page.includes('console.error("setName failed:", e);'), false);
});

test("desktop lobby dedupes vibe labels before display, edit, and save", () => {
  const page = lobbySource();

  assert.equal(page.includes("function normalizeVibeLabels("), true);
  assert.equal(page.includes("setSelectedVibes([...currentTags]);"), true);
  assert.equal(page.includes("const tagsToSave = normalizeVibeLabels(selectedVibes);"), true);
  assert.equal(page.includes("await api.setTags(squadId, tagsToSave);"), true);
  assert.equal(page.includes("const currentTags = normalizeVibeLabels("), true);
  assert.equal(page.includes("currentTags.map(t => t.replace(/^[^\\w]+/, \"\").trim())"), false);
});

test("desktop lobby access setting failures are visible and rolled back", () => {
  const page = lobbySource();

  assert.equal(page.includes("const previousVisibility = visibility;"), true);
  assert.equal(page.includes("setVisibility(previousVisibility);"), true);
  assert.equal(page.includes("setMatchError((e as { message?: string })?.message || \"Couldn't update squad visibility.\")"), true);
  assert.equal(page.includes("const previousJoinPolicy = joinPolicy;"), true);
  assert.equal(page.includes("setJoinPolicy(previousJoinPolicy);"), true);
  assert.equal(page.includes("setMatchError((e as { message?: string })?.message || \"Couldn't update join policy.\")"), true);
  assert.equal(page.includes('console.error("setSquadVisibility failed:", e);'), false);
  assert.equal(page.includes('console.error("setJoinPolicy failed:", e);'), false);
});

test("desktop lobby surfaces join-request decline failures", () => {
  const lobby = lobbySource();
  const decline = lobby.slice(lobby.indexOf("async function handleDecline"), lobby.indexOf("async function copyToClipboard"));

  assert.equal(decline.includes('setReqError("Couldn\'t decline — try again.");'), true);
});

test("desktop lobby rolls back mic and camera controls when video updates fail", () => {
  const page = lobbySource();

  assert.equal(page.includes("const previous = micOn;"), true);
  assert.equal(page.includes("setMicOn(previous);"), true);
  assert.equal(page.includes("setVideoError((e as { message?: string })?.message || \"Couldn't update microphone.\")"), true);
  assert.equal(page.includes("const previous = camOn;"), true);
  assert.equal(page.includes("setCamOn(previous);"), true);
  assert.equal(page.includes("setVideoError((e as { message?: string })?.message || \"Couldn't update camera.\")"), true);
  assert.equal(page.includes("try { vcRef.current?.setMicEnabled(next); } catch {}"), false);
  assert.equal(page.includes("await vcRef.current?.setCamEnabled(next);"), false);
});

test("desktop encounter rolls back mic and camera controls when video updates fail", () => {
  const page = encounterSource();

  assert.equal(page.includes("const previous = micOn;"), true);
  assert.equal(page.includes("setMicOn(previous);"), true);
  assert.equal(page.includes("setVideoError((e as { message?: string })?.message || \"Couldn't update microphone.\")"), true);
  assert.equal(page.includes("const previous = camOn;"), true);
  assert.equal(page.includes("setCamOn(previous);"), true);
  assert.equal(page.includes("setVideoError((e as { message?: string })?.message || \"Couldn't update camera.\")"), true);
  assert.equal(page.includes("await vcRef.current?.setMicEnabled(next);"), false);
  assert.equal(page.includes("await vcRef.current?.setCamEnabled(next);"), false);
});

test("desktop encounter derives one adaptive stage from stable participant identities", () => {
  const page = encounterSource();

  assert.equal(page.includes("advanceSpeakerFocus"), true);
  assert.equal(page.includes("deriveEncounterLayout"), true);
  assert.equal(page.includes("id: m.userId"), true);
  assert.equal(page.includes("VIEW_MODES"), false);
  assert.equal(page.includes('mode: "grid"'), false);
  assert.equal(page.includes('mode: "spotlight"'), false);
  assert.equal(page.includes('mode: "focus-opponent"'), false);
  assert.equal(page.includes("<AdaptiveVideoStage"), true);
  assert.equal(page.includes('data-layout-kind={pinnedId ? layout.kind : "adaptive-grid"}'), true);
  const tile = readFileSync(path.join(__dirname, "../components/ParticipantVideoTile.tsx"), "utf8");
  assert.equal(tile.includes("data-media-fit={fit}"), true);
  assert.equal(tile.includes('aria-haspopup="dialog"'), true);
  assert.equal(page.includes("setRemoteAudioMuted"), true);
});

test("desktop encounter keeps essential controls compact and moves secondary actions into More", () => {
  const page = encounterSource();
  const controls = page.slice(page.indexOf("const ctrlBtns"), page.indexOf("const pinnedMemberName"));

  for (const id of ["mic", "cam", "chat", "more"]) assert.equal(controls.includes(`id: "${id}"`), true);
  assert.equal(controls.includes('id: "report"'), false);
  assert.equal(page.includes('flexWrap: "nowrap"'), true);
  assert.equal(page.includes('width: isPhone ? 44 : 48'), true);
  assert.equal(page.includes("data-call-leave"), true);
  assert.equal(page.includes("moreOpen"), true);
  assert.equal(page.includes("setFocusedFit"), true);
  assert.equal(page.includes("setSelfViewMinimized"), true);
  assert.equal(page.includes('aria-label="End encounter"'), true);
});

test("desktop encounter reactions stay briefly on the real sender tile", () => {
  const page = encounterSource();

  assert.equal(page.includes("senderId: string"), true);
  assert.equal(page.includes("spawnReaction(emoji, session.user?.id ?? \"\")"), true);
  assert.equal(page.includes("spawnReaction(r.emoji, r.senderId)"), true);
  assert.equal(page.includes("}, 1800);"), true);
  const tileStyles = readFileSync(path.join(__dirname, "../components/ParticipantVideoTile.module.css"), "utf8");
  assert.match(tileStyles, /animation:reactionFloat 1.8s ease forwards/);
  assert.equal(page.includes("reaction.senderId === person.id"), true);
  assert.equal(page.includes("data-reaction"), true);
});

test("desktop encounter chat becomes a focused phone view while keeping video mounted", () => {
  const page = encounterSource();

  assert.equal(page.includes("gg-chat-open"), true);
  assert.equal(page.includes("Kept mounted so closing chat preserves drafts and never moves video hosts."), true);
  assert.equal(page.includes('className="gg-phone-back"'), true);
  assert.equal(page.includes("chatButtonRef"), true);
  assert.equal(page.includes("onClose={closeChat}"), true);
});

test("desktop encounter reports media failures and retries the existing call", () => {
  const page = encounterSource();

  assert.equal(page.includes("onCaptureState"), true);
  assert.equal(page.includes("Microphone permission is blocked."), true);
  assert.equal(page.includes("Camera permission is blocked."), true);
  assert.equal(page.includes('next.audio === "denied" || next.audio === "unavailable"'), true);
  assert.equal(page.includes('next.video === "denied" || next.video === "unavailable"'), true);
  assert.equal(page.includes("function retryVideo()"), true);
  assert.equal(page.includes("await joinVideo();"), true);
  assert.equal(page.includes("Video disconnected — chat is still available."), true);
  assert.equal(page.includes('"Disconnected"'), true);
  assert.equal(page.includes("if (vcRef.current === vc) setRemotes(next);"), true);
});

test("lobby and encounter exits invalidate media joins already in flight", () => {
  const lobby = lobbySource();
  const encounter = encounterSource();

  assert.match(lobby, /const lobbyMediaGenerationRef = useRef\(0\);/);
  assert.match(lobby, /const generation = \+\+lobbyMediaGenerationRef\.current;/);
  assert.match(lobby, /if \(generation !== lobbyMediaGenerationRef\.current\)/);
  assert.match(lobby, /async function leaveLobbyMedia\(\) \{[\s\S]*?lobbyMediaGenerationRef\.current \+= 1;/);
  assert.match(encounter, /const videoGenerationRef = useRef\(0\);/);
  assert.match(encounter, /const generation = \+\+videoGenerationRef\.current;/);
  assert.match(encounter, /const joinCancelled = \(\) => isCancelled\(\) \|\| generation !== videoGenerationRef\.current;/);
  assert.match(encounter, /async function leaveVideo\(\) \{[\s\S]*?videoGenerationRef\.current \+= 1;/);
});

test("desktop encounter starts local media cleanup before backend-confirmed navigation", () => {
  const page = encounterSource();
  const endBlock = page.slice(
    page.indexOf("async function handleEnd()"),
    page.indexOf("async function handleBlockOpponent()")
  );
  const leaveBlock = page.slice(
    page.indexOf("async function leaveVideoAndGoHome()"),
    page.indexOf("async function handleEnd()")
  );

  assert.match(endBlock, /const mediaExit = leaveVideo\(\);/);
  assert.match(endBlock, /await api\.disconnectEncounter\(squadId, encId\);/);
  assert.ok(endBlock.indexOf("const mediaExit = leaveVideo();") < endBlock.indexOf("await api.disconnectEncounter(squadId, encId);"));
  assert.ok(endBlock.indexOf('router.replace("/home");') > endBlock.indexOf("await api.disconnectEncounter(squadId, encId);"));
  assert.match(endBlock, /await mediaExit;/);
  assert.match(endBlock, /catch \{[\s\S]*?retryVideo\(\);/);
  assert.match(leaveBlock, /await leaveVideo\(\);/);
  assert.match(page, /async function leaveVideo\(\) \{[\s\S]*?vcRef\.current = null;[\s\S]*?setVideoJoined\(false\);[\s\S]*?await client\?\.leave\(\);/);
  assert.match(leaveBlock, /router\.replace\("\/home"\);/);
  assert.match(endBlock, /setEnding\(false\);/);
  assert.match(endBlock, /setEndError\("Couldn't end this encounter yet\. Reconnecting your video…"\);/);
  assert.match(page, /onClick=\{exitKind === "leave" \? handlePersonalLeave : handleEnd\}[\s\S]*?disabled=\{ending\}/);
  assert.equal(page.includes('title={exitKind === "leave" ? "Leave this call?" : "End encounter?"}'), true);
  assert.equal(page.includes("This ends the current encounter for both squads."), true);
  assert.equal(page.includes("setEndConfirmOpen(true)"), true);
  assert.equal(page.includes("SOCKET_EVENTS.ENCOUNTER_ENDED"), true);
  assert.equal(page.includes('payload?.reason === "squad_disconnected"'), true);
  assert.equal(page.includes('payload?.endedBySquadId === squadId'), true);
  assert.equal(page.includes("Continue matching"), true);
  assert.equal(endBlock.includes('console.error("End encounter failed (non-fatal):", e);'), false);
});

test("desktop encounter does not enter matchmaking when restart search fails", () => {
  const page = encounterSource();
  const endedOverlay = page.slice(
    page.indexOf("{/* Encounter-ended overlay"),
    page.indexOf("{/* Tile area", page.indexOf("{/* Encounter-ended overlay"))
  );

  assert.equal(endedOverlay.includes("try { await api.startSearch(squadId); } catch {}"), false);
  assert.match(endedOverlay, /await api\.startSearch\(squadId\);[\s\S]*router\.push\(`\/matchmaking\?squad=\$\{squadId\}`\);/);
  assert.match(endedOverlay, /catch \(error\) \{[\s\S]*setEndError\([\s\S]*setFindingNextMatch\(false\);/);
  assert.match(endedOverlay, /role="alert"/);
});

test("desktop chat supports controlled pending, failure, and retry states", () => {
  const component = chatPanelSource();

  assert.equal(component.includes("const [sendError, setSendError]"), true);
  assert.match(component, /const sent = onSend[\s\S]*sendChatMessage\(scope, text/);
  assert.equal(component.includes("if (!sent) {"), true);
  assert.equal(component.includes("setSendError(\"Message not sent. Check your connection and try again.\")"), true);
  assert.match(component, /msg\.delivery === "sending"/);
  assert.match(component, /msg\.delivery === "failed"/);
  assert.match(component, /onRetry\?\.\(msg\)/);
  assert.equal(component.includes("setInput(\"\");"), true);
  assert.equal(component.indexOf("setInput(\"\");") > component.indexOf("if (!sent) {"), true);
  assert.equal(component.includes("role=\"alert\""), true);
});

test("desktop encounter chat filters messages to the active encounter", () => {
  const component = chatPanelSource();

  assert.equal(component.includes("chatMessageMatchesScope("), true);
  assert.equal(component.includes('kind: "encounter"'), true);
  assert.equal(component.includes('kind: "lobby"'), true);
  assert.match(component, /\[scopeKind, scopeSquadId, scopeEncounterId\]/);
});

test("desktop encounter reactions ignore other encounter rooms", () => {
  const page = encounterSource();
  const subscribeIndex = page.indexOf("const unsub = subscribeReaction");
  const reactionSubscribeBlock = page.slice(
    page.lastIndexOf("useEffect(() => {", subscribeIndex),
    page.indexOf("  // Toggle focus", subscribeIndex)
  );

  assert.match(reactionSubscribeBlock, /if \(r\.encounterId !== encId\) return;/);
  assert.match(reactionSubscribeBlock, /\}, \[encId\]\);/);
});

test("desktop encounter reactions only animate after realtime send succeeds", () => {
  const page = encounterSource();
  const fireBlock = page.slice(
    page.indexOf("function fireReaction"),
    page.indexOf("  // Receive reactions")
  );

  assert.match(fireBlock, /const sent = sendReaction\(/);
  assert.match(fireBlock, /if \(!sent\) \{/);
  assert.match(fireBlock, /setVideoError\("Reaction was not sent\. Check your connection and try again\."\);/);
  assert.equal(fireBlock.indexOf('spawnReaction(emoji, session.user?.id ?? "")') > fireBlock.indexOf("if (!sent) {"), true);
  assert.equal(fireBlock.includes("spawnReaction(emoji); // optimistic local"), false);
});

test("desktop encounter report button only shows success after persistence acknowledgement", () => {
  const page = encounterSource();
  const reportBlock = page.slice(
    page.indexOf("async function handleReport()"),
    page.indexOf("  // Spawn a floating emoji")
  );

  assert.equal(page.includes("reportOpponentSquad"), true);
  assert.match(reportBlock, /async function handleReport\(\)/);
  assert.match(reportBlock, /setReporting\(true\);/);
  assert.match(reportBlock, /const result = await reportOpponentSquad\(\{/);
  assert.match(reportBlock, /setReporting\(false\);/);
  assert.match(reportBlock, /if \(!result\.ok\) \{/);
  assert.match(reportBlock, /setVideoError\("Report was not sent\. Check your connection and try again\."\);/);
  assert.equal(reportBlock.includes("console.error(\"report_squad emit failed"), false);
  assert.equal(reportBlock.indexOf("setReported(true);") > reportBlock.indexOf("if (!result.ok) {"), true);
  assert.equal(page.includes("disabled={reported || reporting}"), true);
});

test("desktop matchmaking keeps cancel reachable on short phones", () => {
  const page = readFileSync(path.join(__dirname, "../app/(app)/matchmaking/page.tsx"), "utf8");

  assert.match(page, /overflowY: isPhone \? "auto" : "hidden"/);
  assert.match(page, /justifyContent: isShortPhone \? "flex-start" : "center"/);
});

test("desktop encounter consolidates recovery and transient notices", () => {
  const page = encounterSource();

  assert.equal(page.includes('data-testid="media-recovery-notice"'), true);
  assert.equal(page.includes('data-testid="encounter-transient-notice"'), true);
  assert.match(page, /const transientNotice = reported[\s\S]*connState === "RECONNECTING"/);
});

test("desktop encounter blocks the validated opponent roster before leaving", () => {
  const page = encounterSource();
  const blockHandler = page.slice(
    page.indexOf("async function handleBlockOpponent()"),
    page.indexOf("async function handleReport()")
  );

  assert.match(page, /createOpponentUserIds\(\{ squadId, ownUserId: session\.user\?\.id, encounter \}\)/);
  assert.equal(page.includes('title="Block opponent squad?"'), true);
  assert.equal(page.includes("setBlockConfirmOpen(true)"), true);
  assert.ok(blockHandler.indexOf("await api.blockUsers(opponentUserIds);") >= 0);
  assert.ok(blockHandler.indexOf("await api.disconnectEncounter(squadId, encId);") > blockHandler.indexOf("await api.blockUsers(opponentUserIds);"));
  assert.ok(blockHandler.indexOf("await leaveVideoAndGoHome();") > blockHandler.indexOf("await api.disconnectEncounter(squadId, encId);"));
  assert.equal(blockHandler.includes("reportOpponentSquad"), false);
  assert.match(blockHandler, /setBlockError\("Couldn't block this squad yet\. Try again\."\)/);
  assert.equal(page.includes("disabled={!canBlockOpponent || blocking}"), true);
  assert.equal(page.includes('aria-label="Block opponent squad"'), true);
});

test("venue cards use real photo defaults instead of synthetic photo placeholders", () => {
  const component = venueCardSource();

  assert.equal(component.includes("photo\" placeholders"), false);
  assert.equal(component.includes("DEFAULT_IMAGES"), true);
  assert.equal(component.includes("const resolvedImage = image ?? DEFAULT_IMAGES[wash];"), true);
  assert.equal(component.includes("backgroundImage: `url(${resolvedImage})`"), true);
});

test("squad cover backgrounds do not double-wrap resolved cover URLs", () => {
  const card = readFileSync(path.join(__dirname, "../components/SquadCard.tsx"), "utf8");
  const homePage = readFileSync(path.join(__dirname, "../app/(app)/home/page.tsx"), "utf8");

  assert.equal(card.includes("url(${resolveCover(squad.coverImage)})"), false);
  assert.equal(card.includes("background: coverBackground(squad.coverImage, kind)"), true);
  assert.equal(homePage.includes("url(${coverBackground("), false);
  // Home now uses plain cards; photo covers remain on SquadCard.
  assert.equal(homePage.includes("url(${coverBackground("), false);
});

test("premium page does not keep unreachable preview checkout modal state", () => {
  const page = readFileSync(path.join(__dirname, "../app/(app)/premium/page.tsx"), "utf8");

  assert.equal(page.includes("CheckoutModal"), false);
  assert.equal(page.includes("checkoutProduct"), false);
  assert.equal(page.includes("setCheckoutProduct"), false);
});

test("premium back button uses a left-facing icon", () => {
  const page = readFileSync(path.join(__dirname, "../app/(app)/premium/page.tsx"), "utf8");

  assert.equal(page.includes("rotate(180deg)"), true);
  assert.equal(page.includes('display: "inline-flex"'), true);
});

test("premium token perks do not sell backend priority features", () => {
  const page = readFileSync(path.join(__dirname, "../app/(app)/premium/page.tsx"), "utf8");

  assert.equal(page.includes('perkId === "fast_pass"'), false);
  assert.equal(page.includes('perkId === "squad_boost"'), false);
  assert.equal(page.includes("Redeem tokens for priority"), false);
  assert.equal(page.includes("Premium members get priority"), false);
  assert.equal(page.includes("unlimited priority"), false);
  assert.equal(page.includes("Unlimited priority matching"), false);
  assert.equal(page.includes("Fast Pass"), false);
  assert.equal(page.includes("1080p HD Video"), false);
});

test("premium token perks do not present local-only redemption as production checkout", () => {
  const page = readFileSync(path.join(__dirname, "../app/(app)/premium/page.tsx"), "utf8");

  assert.equal(page.includes("const canRedeemPerks = billing.canRedeemTokenPerksLocally();"), true);
  assert.equal(page.includes("Perk redemption is in launch prep"), true);
  assert.equal(page.includes('<Button size="sm" variant="secondary" disabled aria-describedby={comingSoonDescId}>'), true);
});

test("profile premium upsell does not advertise unbuilt priority or HD features", () => {
  const page = profileSource();

  assert.equal(page.includes("Fast Pass"), false);
  assert.equal(page.includes("HD video"), false);
  assert.equal(page.includes("priority"), false);
  assert.equal(page.includes('aria-label="View Wallet and Giggle Plus details"'), true);
  assert.equal(page.includes(">Wallet &amp; Giggle+</div>"), true);
  assert.equal(page.includes('aria-label="Upgrade to Giggle+"'), false);
  assert.equal(page.includes(">Upgrade</span>"), false);
});

test("desktop lobby keeps monetization out of the squad-ready flow", () => {
  const page = lobbySource();

  assert.equal(page.includes("boostHovered"), false);
  assert.equal(page.includes("Unlock covers &amp; perks with Giggle+"), false);
  assert.equal(page.includes("monthly tokens and cosmetic perks"), false);
});



test("desktop wallet does not promise production redemption before it launches", () => {
  const page = readFileSync(path.join(__dirname, "../app/(app)/premium/page.tsx"), "utf8");

  assert.equal(page.includes("Earn and track tokens for your squad identity."), true);
  assert.equal(page.includes("Earn tokens, then spend them on your squad identity."), false);
});

test("profile shows only account controls backed by real behavior", () => {
  const page = profileSource();

  assert.equal(page.includes('label="Open to Discovery"'), false);
  assert.equal(page.includes('label="Show Online Status"'), false);
  assert.equal(page.includes("const [age, setAge]"), false);
  assert.equal(page.includes('label="Notification pop-ups"'), true);
});

test("desktop notification preference controls truthful in-app pop-ups", () => {
  const page = profileSource();
  const bell = notificationBellSource();

  assert.equal(page.includes('label="Notification pop-ups"'), true);
  assert.equal(page.includes('desc="Show an alert when a new request or invite arrives"'), true);
  assert.equal(page.includes("Receive push notifications"), false);
  assert.equal(bell.includes('const PROFILE_SETTINGS_STORAGE_KEY = "giggle.profile.settings";'), true);
  assert.equal(bell.includes("function notificationPopupsEnabled()"), true);
  assert.equal(bell.includes("if (notificationPopupsEnabled()) setToast(n);"), true);
});

test("profile notification persistence ignores malformed stored settings", () => {
  const page = profileSource();

  assert.equal(page.includes("function normalizeProfileSettings("), true);
  assert.equal(page.includes("const parsed = normalizeProfileSettings(JSON.parse(raw));"), true);
  assert.equal(page.includes("JSON.stringify({ notificationsOn: value })"), true);
  assert.equal(page.includes("openToDiscovery"), false);
  assert.equal(page.includes("showOnlineStatus"), false);
});

test("profile vibe preferences are normalized before render and persistence", () => {
  const page = profileSource();

  assert.equal(page.includes("function normalizeProfileVibes("), true);
  // Interests are server-backed: loaded from the profile, saved via PATCH, never pre-filled.
  assert.equal(page.includes("const [vibes, setVibes] = useState<string[]>([]);"), true);
  assert.equal(page.includes("const serverVibes = normalizeProfileVibes(p.vibes, []);"), true);
  assert.equal(page.includes("api.updateMyProfile({ vibes: next })"), true);
  assert.equal(page.includes("DEFAULT_VIBES"), false);
  assert.equal(page.includes("setVibes(JSON.parse(stored));"), false);
});

test("desktop auth callback does not relay magic tokens through query strings", () => {
  const page = authCallbackSource();

  assert.equal(page.includes('search.get("magic")'), false);
  assert.equal(page.includes("email/verify?token="), false);
});

test("desktop auth callback has a trustworthy failure page title and touch target", () => {
  const page = authCallbackSource();
  const layout = authCallbackLayoutSource();

  assert.equal(layout.includes('title: "Sign-in status · Giggle"'), true);

  assert.equal(page.includes('minWidth: 44'), true);
});

test("desktop sign-in hides Apple until that provider is configured", () => {
  const page = signinSource();

  assert.equal(page.includes('provider: "google" | "apple"'), true);
  assert.equal(page.includes('oauthRedirect("google")'), true);
  assert.equal(page.includes('oauthRedirect("apple")'), false);
  assert.equal(page.includes("Continue with Apple"), false);
  assert.equal(page.includes("Apple Sign-In is not configured yet"), true);
});

test("desktop sign-in stays focused and fits one viewport", () => {
  const page = signinSource();

  assert.equal(page.includes('minHeight: "100svh"'), true);
  assert.equal(page.includes('/img/onboarding-hero.jpg'), false);
  assert.equal(page.includes('const props:'), false);
  assert.equal(page.includes('Bring your whole squad'), false);
});

test("squad preview joins by squad id instead of leaked squad code", () => {
  const component = readFileSync(path.join(__dirname, "../components/SquadPreview.tsx"), "utf8");
  const homePage = readFileSync(path.join(__dirname, "../app/(app)/home/page.tsx"), "utf8");

  assert.equal(component.includes("api.joinSquadById(squad.squadId)"), true);
  assert.equal(component.includes("api.joinSquad({ squadCode: squad.squadCode })"), false);
  assert.equal(homePage.includes("api.joinSquadById(squad.squadId)"), true);
  assert.equal(homePage.includes("api.joinSquad({ squadCode: squad.squadCode })"), false);
});

test("squad preview surfaces live detail fetch failures instead of endless roster loading", () => {
  const component = squadPreviewSource();

  assert.equal(component.includes("const [detailError, setDetailError]"), true);
  assert.equal(component.includes("setDetailError(\"Couldn't load live squad details.\")"), true);
  assert.equal(component.includes("{detailError && ("), true);
  assert.equal(component.includes("Couldn't load live roster."), true);
  assert.equal(component.includes("Loading members…"), false);
});

test("squad preview is viewport-bound with accessible controls", () => {
  const preview = squadPreviewSource();
  assert.equal(preview.includes("createPortal("), true);
  assert.equal(preview.includes("document.body"), true);
  assert.equal(preview.includes('role="dialog"'), true);
  assert.equal(preview.includes('width: 44, height: 44'), true);
});

test("avatar and cover uploads validate type and size before previewing", () => {
  const avatarPicker = avatarPickerSource();
  const coverPicker = coverPickerSource();

  for (const source of [avatarPicker, coverPicker]) {
    assert.equal(source.includes("MAX_UPLOAD_IMAGE_BYTES"), true);
    assert.equal(source.includes("image/png"), true);
    assert.equal(source.includes("image/jpeg"), true);
    assert.equal(source.includes("image/webp"), true);
    assert.equal(source.includes("file.size > MAX_UPLOAD_IMAGE_BYTES"), true);
    assert.equal(source.includes("setHint("), true);
  }
});

test("avatar picker stays viewport-bound and behaves like a modal", () => {
  const profile = profileSource();
  const picker = avatarPickerSource();
  const modal = modalSource();
  const profileGridEnd = profile.lastIndexOf("</div>");
  assert.equal(profile.indexOf("{pickerOpen && <AvatarPicker") > profileGridEnd, true);
  assert.equal(picker.includes("<Modal"), true);
  assert.equal(picker.includes('closeLabel="Close avatar picker"'), true);
  assert.equal(modal.includes('role="dialog"'), true);
  assert.equal(modal.includes('aria-modal="true"'), true);
  assert.equal(modal.includes('width: 44'), true);
  assert.equal(modal.includes('height: 44'), true);
  assert.equal(modal.includes('if (e.key === "Escape") onClose()'), true);
  assert.equal(modal.includes("createPortal("), true);
  assert.equal(modal.includes("document.body"), true);
});

test("cover save waits for lobby refresh before closing", () => {
  const coverPicker = coverPickerSource();
  const lobby = lobbySource();

  assert.equal(coverPicker.includes("onSaved: () => void | Promise<void>;"), true);
  assert.equal(coverPicker.includes("await onSaved();"), true);
  assert.equal(lobby.includes("onSaved={async () => { await fetchSquad(); setCoverPickerOpen(false); }}"), true);
  assert.equal(lobby.includes("onSaved={async () => { setCoverPickerOpen(false); await fetchSquad(); }}"), false);
});

test("cover picker preserves its preview and behaves like a modal", () => {
  const picker = coverPickerSource();
  const modal = modalSource();
  assert.equal(picker.includes("<Modal"), true);
  assert.equal(picker.includes('closeLabel="Close cover picker"'), true);
  assert.equal(modal.includes('role="dialog"'), true);
  assert.equal(modal.includes('aria-modal="true"'), true);
  assert.match(picker, /height: 100,\s*flexShrink: 0/);
});

test("notification actions remain available after notifications are marked read", () => {
  const bell = notificationBellSource();

  assert.equal(bell.includes('n.type === "friend_request" && !n.read'), false);
  assert.equal(bell.includes('n.type === "squad_invite" && !n.read'), false);
  assert.equal(bell.includes('n.type === "friend_request"'), true);
  assert.equal(bell.includes('n.type === "squad_invite"'), true);
});

test("notification dismiss uses the backend dismiss endpoint", () => {
  const bell = notificationBellSource();
  const api = readFileSync(path.join(__dirname, "../../../packages/core/src/api.ts"), "utf8");
  const dismissAction = bell.slice(bell.indexOf("const dismiss = async"), bell.indexOf("const openLobby = async"));

  assert.equal(api.includes("dismissNotification"), true);
  assert.equal(api.includes('method: "DELETE"'), true);
  assert.equal(dismissAction.includes("await api.dismissNotification(n.id);"), true);
  assert.equal(dismissAction.includes("markNotificationRead"), false);
  assert.equal(dismissAction.includes("onDismiss(n.id, !n.read);"), true);
});

test("notification action failures show inline errors", () => {
  const bell = notificationBellSource();

  assert.equal(bell.includes("const [actionError, setActionError]"), true);
  assert.equal(bell.includes("setActionError(\"Couldn't accept this friend request.\")"), true);
  assert.equal(bell.includes("setActionError(\"Couldn't join this squad invite.\")"), true);
  assert.equal(bell.includes("setActionError(\"Couldn't dismiss this notification.\")"), true);
  assert.equal(bell.includes("{actionError &&"), true);
});

test("notification rows disable conflicting actions while a request is in flight", () => {
  const bell = notificationBellSource();
  const pill = bell.slice(bell.indexOf("function Pill"), bell.indexOf("// ── one notification row"));
  const row = bell.slice(bell.indexOf("function Row"), bell.indexOf("// ── live toast"));

  assert.equal(pill.includes("disabled?: boolean;"), true);
  assert.equal(pill.includes("disabled={busy || disabled}"), true);
  assert.equal((row.match(/disabled=\{busy !== null\}/g) ?? []).length, 4);
  assert.equal((row.match(/if \(busy \|\| !n\./g) ?? []).length, 3);
  assert.match(row, /const dismiss = async \(\) => \{\s*if \(busy\) return;/);
});

test("stale squad invites expire without navigating to a dead lobby", () => {
  const bell = notificationBellSource();
  const joinAction = bell.slice(bell.indexOf("const join = async"), bell.indexOf("const dismiss = async"));

  assert.equal(bell.includes('const expiredInviteCodes = new Set(["SQUAD_NOT_FOUND", "INVITE_ONLY"]);'), true);
  assert.equal(joinAction.includes("if (expiredInviteCodes.has(code))"), true);
  assert.equal(joinAction.includes('setResolved("Invite expired");'), true);
  assert.equal(joinAction.includes("await api.dismissNotification(n.id);"), true);
  assert.equal(joinAction.includes("try { await api.dismissNotification(n.id); } catch {}"), false);
  assert.equal(joinAction.includes('setActionError("Invite expired, but couldn\'t dismiss it.");'), true);
  assert.equal(joinAction.includes("return;"), true);
});

test("age gate completes only after provider verification and a live session sync", () => {
  const gate = ageGateSource();

  assert.match(gate, /api\.startAgeVerification\(\)/);
  assert.match(gate, /api\.getAgeVerificationStatus\(\)/);
  assert.match(gate, /window\.location\.assign\(providerUrl\.toString\(\)\)/);
  assert.match(gate, /async function startVerification\(\) \{\s*const operation = \+\+operationGeneration\.current;/);
  assert.match(gate, /document\.addEventListener\("visibilitychange"/);
  assert.match(gate, /window\.addEventListener\("focus"/);
  assert.match(gate, /MAX_STATUS_POLLS/);
  assert.match(gate, /await session\.syncAgeFromServer\(\)[\s\S]*session\.hasAdultAccess[\s\S]*onDone\(\)/);
  assert.equal((gate.match(/onDone\(\)/g) || []).length, 1);
  // Self-declared access (SELF_DECLARED_AGE_ACCESS) must not claim verification.
  assert.match(gate, /Giggle is for adults 18\+/);
  assert.match(gate, /mailto:support@gigglemeet\.com\?subject=Age%20verification%20help/);
  assert.match(gate, /session\.signOut\(\)/);
  assert.match(gate, />Continue with Yoti<\/Button>/);
  assert.doesNotMatch(gate, /adult content/i);
  for (const state of ["pending", "rejected", "unavailable"]) {
    assert.match(gate, new RegExp(`\\"${state}\\"`));
  }
});

test("age verification ignores stale operations and only opens the exact Yoti host", () => {
  const gate = ageGateSource();
  const start = gate.slice(gate.indexOf("async function startVerification"), gate.indexOf("function signOut"));

  assert.match(gate, /const mounted = useRef\(true\)/);
  assert.match(gate, /const reconcileInFlight = useRef<Promise<void> \| null>\(null\)/);
  assert.match(gate, /if \(reconcileInFlight\.current\) return reconcileInFlight\.current/);
  assert.match(start, /const operation = \+\+operationGeneration\.current/);
  assert.match(start, /await api\.startAgeVerification\(\)[\s\S]*!mounted\.current[\s\S]*operation !== operationGeneration\.current/);
  assert.match(start, /new URL\(result\.url\)/);
  assert.match(start, /providerUrl\.protocol !== "https:"/);
  assert.match(start, /providerUrl\.hostname !== "age\.yoti\.com"/);
  assert.doesNotMatch(start, /window\.location\.assign\(result\.url\)/);
  assert.match(gate, /function signOut\(\) \{\s*mounted\.current = false;\s*operationGeneration\.current \+= 1;/);
});

test("returning users resolve stale age state before the app leaves its opening screen", () => {
  const layout = appLayoutSource();
  const existingSession = layout.slice(
    layout.indexOf("if (session.isAuthed())"),
    layout.indexOf('if (process.env.NODE_ENV !== "production")'),
  );

  assert.ok(existingSession.indexOf("await session.syncAgeFromServer();") < existingSession.indexOf("setAuthReady(true);"));
  assert.equal((existingSession.match(/setAuthReady\(true\)/g) || []).length, 1);
  assert.match(layout, /if \(!authReady \|\| !hasAdultAccess \|\| !session\.isAuthed\(\)\) return;/);
  assert.match(layout, /if \(session\.isAuthed\(\) && session\.hasAdultAccess\) connectSocket\(\);/);
});

test("join links make the same live adult-access decision before joining", () => {
  const join = joinByCodeSource();
  const guard = join.slice(join.indexOf("await session.syncAgeFromServer()"), join.indexOf("api.joinSquad"));

  assert.match(guard, /await session\.syncAgeFromServer\(\)/);
  assert.match(guard, /session\.hasIdentityOnlyAccess && session\.accountStatus !== "active"/);
  assert.match(guard, /router\.replace\("\/profile"\)/);
  assert.match(guard, /!session\.hasAdultAccess/);
  assert.match(join, /onManageAccount=\{\(\) => router\.push\("\/profile"\)\}/);
  assert.ok(join.indexOf("await session.syncAgeFromServer()") < join.indexOf("api.joinSquad"));
});

test("browser fixtures use an explicit development-only age bypass", () => {
  const config = playwrightConfigSource();

  assert.match(config, /NODE_ENV: "development"/);
  assert.match(config, /AGE_VERIFICATION_BYPASS: "true"/);
  assert.doesNotMatch(config, /NODE_ENV: "production"[\s\S]{0,100}AGE_VERIFICATION_BYPASS: "true"/);
});

test("encounter browser coverage avoids real Agora while preserving call flows", () => {
  const e2e = encounterE2eSource();
  const responsive = e2e.slice(
    e2e.indexOf('test("fixture encounter keeps media, chat, and controls usable across resize"'),
    e2e.indexOf('test("encounter chat retry'),
  );
  const remoteEnded = e2e.slice(
    e2e.indexOf('test("opponent ending preserves a clear recovery state"'),
    e2e.indexOf('test("mocked rosters'),
  );

  assert.doesNotMatch(e2e, /async function enterQueue/);
  assert.doesNotMatch(e2e, /async function createEncounter/);
  assert.match(e2e, /page\.routeWebSocket\(\/socket\\\.io\//);
  assert.match(responsive, /installEncounterFixture\(page/);
  assert.match(responsive, /openFixture\(page, 2\)/);
  assert.match(responsive, /injectSyntheticVideo/);
  assert.match(responsive, /Chat message/);
  assert.match(responsive, /setViewportSize/);
  assert.match(remoteEnded, /emitOpponentEnded/);
  assert.match(remoteEnded, /The other squad left/);
});

test("failed notification mark-all never restores a stale item snapshot", () => {
  const bell = notificationBellSource();

  assert.equal(bell.includes("const previousUnread = unread;"), false);
  assert.equal(bell.includes("const previousItems = items;"), false);
  assert.equal(bell.includes("setUnread(previousUnread);"), false);
  assert.equal(bell.includes("setItems(previousItems);"), false);
  assert.equal(bell.includes("await api.markNotificationsRead();"), true);
  assert.equal(bell.includes("if (version !== notificationVersion.current)"), true);
  assert.equal(bell.includes("setItems((prev) => prev.map((p) => ({ ...p, read: true })));"), true);
  assert.equal(bell.indexOf("await api.markNotificationsRead();") < bell.indexOf("setItems((prev) => prev.map((p) => ({ ...p, read: true })));"), true);
});

test("notification loads cannot overwrite newer socket activity", () => {
  const bell = notificationBellSource();
  const load = bell.slice(bell.indexOf("const load = useCallback"), bell.indexOf("// initial load"));
  const polling = bell.slice(bell.indexOf("// initial load"), bell.indexOf("// live socket push"));
  const subscription = bell.slice(bell.indexOf("// live socket push"), bell.indexOf("// close on outside click"));

  assert.equal(bell.includes("const notificationVersion = useRef(0);"), true);
  assert.equal(bell.includes("const loadSequence = useRef(0);"), true);
  assert.equal(bell.includes("const knownNotificationIds = useRef(new Set<string>());"), true);
  assert.equal(load.includes("const request = ++loadSequence.current;"), true);
  assert.equal(load.includes("const version = notificationVersion.current;"), true);
  assert.equal(load.includes("if (request !== loadSequence.current) return;"), true);
  assert.match(load, /if \(version !== notificationVersion\.current\) \{\s*void load\(\);\s*return;\s*\}/);
  assert.equal(polling.includes('window.addEventListener("focus", load);'), true);
  assert.equal(polling.includes('window.removeEventListener("focus", load);'), true);
  assert.equal(subscription.includes("if (knownNotificationIds.current.has(n.id)) return;"), true);
  assert.ok(subscription.indexOf("if (knownNotificationIds.current.has(n.id)) return;") < subscription.indexOf("setUnread((u) => u + 1);"));
  assert.equal(subscription.includes("() => void load()"), true);
});

test("notifications distinguish load failure from an empty inbox", () => {
  const bell = notificationBellSource();

  assert.equal(bell.includes("const [loadError, setLoadError]"), true);
  assert.equal(bell.includes('setLoadError("Couldn\'t load notifications. Check your connection.")'), true);
  assert.equal(bell.includes("items.length === 0 && !loadError"), true);
  assert.equal(bell.includes("onClick={() => void load()}"), true);
});

test("opening a join request keeps client state consistent with the read-only server update", () => {
  const bell = notificationBellSource();
  const openLobby = bell.slice(bell.indexOf("const openLobby = async"), bell.indexOf("// Rows that navigate"));

  assert.equal(openLobby.includes("await api.markNotificationRead(n.id);"), true);
  assert.equal(openLobby.includes("onResolve(n.id, !n.read);"), true);
  assert.equal(openLobby.includes("onDismiss(n.id, !n.read);"), false);
});

test("dismissing an unread notification updates the badge", () => {
  const bell = notificationBellSource();

  assert.equal(bell.includes("onDismiss: (id: string, wasUnread?: boolean) => void;"), true);
  assert.equal(bell.includes("onDismiss(n.id, !n.read);"), true);
  assert.equal(bell.includes("if (wasUnread) setUnread((u) => Math.max(0, u - 1));"), true);
  assert.equal(bell.includes("onResolve: (id: string, wasUnread?: boolean) => void;"), true);
  assert.equal(bell.includes("onResolve(n.id, !n.read);"), true);
});

test("completed notification actions disappear instead of returning after reload", () => {
  const bell = notificationBellSource();
  const acceptAction = bell.slice(bell.indexOf("const accept = async"), bell.indexOf("const decline = async"));
  const declineAction = bell.slice(bell.indexOf("const decline = async"), bell.indexOf("const join = async"));
  const joinAction = bell.slice(bell.indexOf("const join = async"), bell.indexOf("const dismiss = async"));

  assert.equal(acceptAction.indexOf("await api.acceptFriend(n.fromUserId);") < acceptAction.indexOf("onDismiss(n.id, !n.read);"), true);
  assert.equal(declineAction.indexOf("await api.declineFriend(n.fromUserId);") < declineAction.indexOf("onDismiss(n.id, !n.read);"), true);
  assert.equal(joinAction.includes("onDismiss(n.id, !n.read);"), true);
  assert.equal(bell.includes("MARK_READ_FAILED"), false);
});

test("desktop protected home actions do not create dev sessions", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("await session.devSignIn();"), false);
  assert.equal(page.includes('router.push("/signin")'), true);
  assert.equal(page.includes("Sign in to continue."), true);
  assert.equal(page.includes("function ensureAuthed()"), true);
  assert.equal(page.includes("return false;"), true);
});

test("desktop home creates a neutral squad without hidden vibe state", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("api.createSquad({ squadName: name.trim(), tags: [] })"), true);
  assert.equal(page.includes("selectedVibes"), false);
  assert.equal(page.includes("VIBE_OPTIONS"), false);
});

test("desktop home keeps one compact live activity strip", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes('className="gg-home-grid"'), true);
  assert.equal(page.includes("Open squads"), true);
  assert.equal(page.includes("See all →"), true);
  assert.equal(page.includes("Start with your squad. Meet another, together."), false);
  assert.equal(page.includes('label: "SQUADS FORMED"'), false);
});

test("desktop home gives new users one first-room task instead of an empty dashboard", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("Start a squad"), true);
  assert.equal(page.includes("Create a squad"), true);
  assert.equal(page.includes("Invite your friends."), true);
  assert.equal(page.includes("Create a squad, then invite your friends."), true);
  assert.equal(page.includes('title="No squads yet"'), false);
});

test("desktop home resumes active squad journeys instead of reopening their lobby", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("function squadDestination"), true);
  assert.equal(page.includes('["searching", "matched", "in_encounter"].includes(squad.status)'), true);
  assert.equal(page.includes("router.push(squadDestination(s))"), true);
  assert.equal(page.includes("router.push(squadDestination(active))"), true);
});

test("desktop home loading state mirrors squad-card content", () => {
  const page = desktopHomeSource();
  assert.equal(page.includes('role="status"'), true);
  assert.equal(page.includes("Loading your squads"), true);
  assert.equal(page.includes('className="gg-shimmer" style={{ height: 160'), false);
});

test("desktop home distinguishes failed loads from genuinely empty squads", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("const [loadError, setLoadError] = useState(\"\");"), true);
  assert.equal(page.includes("const [openError, setOpenError] = useState(\"\");"), true);
  assert.equal(page.includes("setTrending((prev) => prev ?? [])"), false);
  assert.equal(page.includes("Couldn't load your squads"), true);
  assert.equal(page.includes("Couldn't load open squads"), true);
  assert.equal(page.includes('role="alert"'), true);
  assert.equal(page.includes("setReload((value) => value + 1)"), true);
});

test("desktop home keeps create and join actions compact", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("Open a new room"), false);
  assert.equal(page.includes("Start a room and invite your people."), false);
  assert.equal(page.includes('aria-label="Squad invite code"'), true);
  assert.equal(page.includes('className="gg-join-form"'), true);
});

test("desktop home uses warm squad actions and discovery surfaces", () => {
  const page = desktopHomeSource();
  assert.equal(page.includes("Your squad"), true);
  assert.equal(page.includes("Start a squad"), true);
  assert.equal(page.includes("Bring your friends. Meet another squad."), true);
});

test("desktop home leave squad failures restore the squad and show an error toast", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("setSquads((previous) => previous?.filter"), true);
  assert.equal(page.includes("toast(message(error, \"Couldn't leave your squad. Try again.\"), \"error\")"), true);
  assert.equal(page.includes("catch { /* refetch will resync if it failed */ }"), false);
});

test("desktop discover opens the shared named squad form", () => {
  const page = desktopDiscoverSource();

  assert.equal(page.includes('router.push("/home?create=1")'), true);
  assert.equal(page.includes("await api.setTags(squad.squadId, [vibe]);"), false);
  assert.equal(page.includes("Start one with this vibe"), true);
});

test("desktop discover keeps creation in the filtered empty state", () => {
  const page = desktopDiscoverSource();

  assert.equal(page.includes("primaryCtaCreates"), false);
  assert.equal(page.includes("handlePrimaryCta"), false);
  assert.equal(page.includes("shown.length === 0"), true);
  assert.equal(page.includes("primary={{ label: \"Create a squad\", onClick: handleCreate, disabled: creating }}"), true);
  assert.equal(page.includes("right={loading || hasOpenSquads ? ("), true);
});

test("desktop discover presents load failures without logging handled errors", () => {
  const page = desktopDiscoverSource();

  assert.equal(page.includes('console.error("discoverSquads failed:", e);'), false);
  assert.equal(page.includes("setError(true);"), true);
});

test("desktop protected discover actions do not create dev sessions", () => {
  const page = desktopDiscoverSource();

  assert.equal(page.includes("await session.devSignIn();"), false);
  assert.equal(page.includes('router.push("/signin")'), true);
  assert.equal(page.includes("Sign in to continue."), true);
  assert.equal(page.includes("return false;"), true);
});

test("desktop home auth gate runs before create and join loading states", () => {
  const page = desktopHomeSource();

  const createStart = page.indexOf("async function create()");
  const createAuth = page.indexOf("if (!ensureAuthed()) return;", createStart);
  const createLoading = page.indexOf('setPending("create");', createStart);
  assert.ok(createStart >= 0);
  assert.ok(createAuth >= 0);
  assert.ok(createLoading >= 0);
  assert.ok(createAuth < createLoading);

  const joinStart = page.indexOf("async function join(squad?: PublicSquad)");
  const joinAuth = page.indexOf("if (!ensureAuthed()) return;", joinStart);
  const joinLoading = page.indexOf('setPending(squad?.squadId ?? "join");', joinStart);
  assert.ok(joinStart >= 0);
  assert.ok(joinAuth >= 0);
  assert.ok(joinLoading >= 0);
  assert.ok(joinAuth < joinLoading);
});

test("squad preview auth gate runs before join loading state", () => {
  const component = squadPreviewSource();

  const joinStart = component.indexOf("const handleJoin = useCallback(async () =>");
  const authCheck = component.indexOf("if (!session.isAuthed())", joinStart);
  const joinLoading = component.indexOf("setJoining(true);", joinStart);
  assert.ok(joinStart >= 0);
  assert.ok(authCheck >= 0);
  assert.ok(joinLoading >= 0);
  assert.ok(authCheck < joinLoading);
});

test("desktop social and invite surfaces do not create dev sessions", () => {
  assert.equal(friendsPageSource().includes("await session.devSignIn();"), false);
  assert.equal(appLayoutSource().includes('router.replace("/signin")'), true);
  for (const page of [inviteToSquadSource(), squadPreviewSource()]) {
    assert.equal(page.includes("await session.devSignIn();"), false);
    assert.equal(page.includes('router.push("/signin")'), true);
    assert.equal(page.includes("Sign in to continue."), true);
  }
});

test("invite dialog keeps compact controls touch-friendly", () => {
  const invite = inviteToSquadSource();
  assert.equal(invite.includes('width: 44, height: 44'), true);
  assert.equal(invite.includes('flex: 1, minHeight: 44'), true);
});

test("friends first run stays search-first and distinguishes request failures", () => {
  const page = friendsPageSource();

  assert.equal(page.includes("No friends yet — search above to add people."), false);
  assert.equal(page.includes("Your crew starts here"), false);
  assert.equal(page.includes("Add friends."), true);
  assert.equal(page.includes("const [loadError, setLoadError] = useState<string | null>(null);"), true);
  assert.equal(page.includes("const [searchError, setSearchError] = useState<string | null>(null);"), true);
  assert.equal(page.includes("Couldn't search for people."), true);
  assert.equal(page.includes("Retry search"), true);
  assert.equal(page.includes("const showFirstRun = !loading && !loadError"), true);
  assert.equal(page.includes("Social graph"), false);
  assert.equal(page.includes("Share a squad code"), false);
});

test("friend card icon actions meet the 44px touch target", () => {
  const page = friendsPageSource();
  const more = page.slice(page.indexOf("function MoreButton("), page.indexOf("function Pill("));

  // Button size="sm" has a 44px min-height; the icon-only overflow button is 44px wide.
  assert.equal(page.includes('<Button size="sm" variant="secondary" onClick={() => setInviteFriend(f)}'), true);
  assert.equal(more.includes('size="sm"'), true);
  assert.equal(more.includes("width: 44"), true);
});

test("friends search treats incoming request users as actionable requests", () => {
  const page = friendsPageSource();

  assert.equal(page.includes("const incomingIds = new Set(incoming.map((u) => u.userId));"), true);
  assert.equal(page.includes("const incomingRequest = incoming.find((i) => i.userId === u.userId);"), true);
  assert.equal(page.includes("incomingRequest ? ("), true);
  assert.equal(page.includes("handleAccept(incomingRequest)"), true);
  assert.equal(page.includes("handleDecline(incomingRequest)"), true);
});

test("friends add failures roll back pending state and show an error toast", () => {
  const page = friendsPageSource();

  assert.equal(page.includes("setOutgoing((o) => o.filter((x) => x.userId !== u.userId));"), true);
  assert.equal(page.includes("toast((e as { message?: string })?.message || \"Couldn't send friend request.\", \"error\")"), true);
});

test("friends request action failures roll back optimistic UI and show error toasts", () => {
  const page = friendsPageSource();

  assert.equal(page.includes("setIncoming((i) => (i.some((x) => x.userId === u.userId) ? i : [u, ...i]));"), true);
  assert.equal(page.includes("setFriends((f) => f.filter((x) => x.userId !== u.userId));"), true);
  assert.equal(page.includes("setFriends((f) => (f.some((x) => x.userId === u.userId) ? f : [u, ...f]));"), true);
  assert.equal(page.includes("toast((e as { message?: string })?.message || \"Couldn't accept friend request.\", \"error\")"), true);
  assert.equal(page.includes("toast((e as { message?: string })?.message || \"Couldn't decline friend request.\", \"error\")"), true);
  assert.equal(page.includes("toast((e as { message?: string })?.message || \"Couldn't remove friend.\", \"error\")"), true);
  assert.equal(page.includes('console.error("acceptFriend failed:", e);'), false);
  assert.equal(page.includes('console.error("declineFriend failed:", e);'), false);
  assert.equal(page.includes('console.error("removeFriend failed:", e);'), false);
});

test("profile keeps one compact identity surface beside settings from tablet upward", () => {
  const page = profileSource();
  const identityColumn = page.slice(page.indexOf("{/* LEFT COLUMN"), page.indexOf("{/* RIGHT COLUMN"));

  assert.equal((identityColumn.match(/\.\.\.surface/g) ?? []).length, 1);
  assert.equal(page.includes("const avatarSize = isPhone ? 88 : 120;"), true);
  assert.equal(page.includes('flexDirection: isPhone ? "row" : "column"'), true);
  assert.equal(page.includes('gridTemplateColumns: isTablet ? "240px minmax(0, 1fr)" : "300px minmax(0, 1fr)"'), true);
  assert.equal((identityColumn.match(/Your tokens and available extras/g) ?? []).length, 1);
});

test("profile load failures stay visible and retryable before saving demographics", () => {
  const page = profileSource();

  assert.equal(page.includes("const [profileLoading, setProfileLoading]"), true);
  assert.equal(page.includes("const [profileLoadError, setProfileLoadError]"), true);
  assert.equal(page.includes("setProfileLoadAttempt((attempt) => attempt + 1)"), true);
  assert.equal(page.includes("profileLoading || !!profileLoadError || !demoDirty"), true);
  assert.equal(page.includes("Couldn't load your profile."), true);
});

test("profile does not expose a second editable age field", () => {
  const page = profileSource();
  const api = readFileSync(path.join(__dirname, "../../../packages/core/src/api.ts"), "utf8");

  assert.equal(page.includes("body.age"), false);
  assert.equal(api.includes("age?: number | null"), false);
});

test("profile keeps account identifiers out of the identity hero", () => {
  const page = profileSource();
  const hero = page.slice(page.indexOf("{/* LEFT COLUMN"), page.indexOf("{/* RIGHT COLUMN"));
  const account = page.slice(page.indexOf(">Account</h2>"));
  assert.equal(hero.includes("user?.email"), false);
  assert.equal(hero.includes("handle"), false);
  assert.equal(account.includes("Signed in as"), true);
});

test("desktop profile exports JSON and requires two confirmations before deletion", () => {
  const page = profileSource();

  assert.match(page, /await api\.exportAccount\(\)/);
  assert.match(page, /new Blob\(\[JSON\.stringify\(data, null, 2\)\]/);
  assert.match(page, /giggle-data-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.json/);
  assert.match(page, /Delete account\?/);
  assert.match(page, /Delete permanently\?/);
  assert.match(page, /await api\.deleteAccount\(\)[\s\S]*session\.signOut\(\)[\s\S]*router\.replace\("\/signin"\)/);
  assert.match(page, /may finish in the background/i);
  assert.match(page, /Couldn't start account deletion\. Please try again\./);
});
