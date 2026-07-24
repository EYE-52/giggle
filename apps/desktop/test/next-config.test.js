const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = () => readFileSync(path.join(__dirname, "../next.config.ts"), "utf8");
const landingSource = () => readFileSync(path.join(__dirname, "../app/page.tsx"), "utf8");
const matchmakingSource = () => readFileSync(path.join(__dirname, "../app/(app)/matchmaking/page.tsx"), "utf8");
const matchSource = () => readFileSync(path.join(__dirname, "../app/(app)/match/page.tsx"), "utf8");
const lobbySource = () => readFileSync(path.join(__dirname, "../app/(app)/lobby/page.tsx"), "utf8");
const encounterSource = () => readFileSync(path.join(__dirname, "../app/(app)/encounter/page.tsx"), "utf8");
const venueCardSource = () => readFileSync(path.join(__dirname, "../components/VenueCard.tsx"), "utf8");
const authCallbackSource = () => readFileSync(path.join(__dirname, "../app/auth/callback/page.tsx"), "utf8");
const authCallbackLayoutSource = () => readFileSync(path.join(__dirname, "../app/auth/callback/layout.tsx"), "utf8");
const signinSource = () => readFileSync(path.join(__dirname, "../app/signin/page.tsx"), "utf8");
const avatarPickerSource = () => readFileSync(path.join(__dirname, "../components/AvatarPicker.tsx"), "utf8");
const coverPickerSource = () => readFileSync(path.join(__dirname, "../components/CoverPicker.tsx"), "utf8");
const notificationBellSource = () => readFileSync(path.join(__dirname, "../components/NotificationBell.tsx"), "utf8");
const desktopHomeSource = () => readFileSync(path.join(__dirname, "../app/(app)/home/page.tsx"), "utf8");
const desktopDiscoverSource = () => readFileSync(path.join(__dirname, "../app/(app)/discover/page.tsx"), "utf8");
const friendsPageSource = () => readFileSync(path.join(__dirname, "../app/(app)/friends/page.tsx"), "utf8");
const inviteToSquadSource = () => readFileSync(path.join(__dirname, "../components/InviteToSquad.tsx"), "utf8");
const squadPreviewSource = () => readFileSync(path.join(__dirname, "../components/SquadPreview.tsx"), "utf8");
const profileSource = () => readFileSync(path.join(__dirname, "../app/(app)/profile/page.tsx"), "utf8");
const chatPanelSource = () => readFileSync(path.join(__dirname, "../components/ChatPanel.tsx"), "utf8");
const referralCardSource = () => readFileSync(path.join(__dirname, "../components/ReferralCard.tsx"), "utf8");
const appLayoutSource = () => readFileSync(path.join(__dirname, "../app/(app)/layout.tsx"), "utf8");
const topNavSource = () => readFileSync(path.join(__dirname, "../components/TopNav.tsx"), "utf8");
const privacySource = () => readFileSync(path.join(__dirname, "../app/privacy/page.tsx"), "utf8");
const termsSource = () => readFileSync(path.join(__dirname, "../app/terms/page.tsx"), "utf8");
const globalStylesSource = () => readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
const vercelConfig = () => JSON.parse(readFileSync(path.join(__dirname, "../vercel.json"), "utf8"));

test("auth proxy never falls back to a production backend", () => {
  const config = source();

  assert.equal(config.includes("giggle-server-production.up.railway.app"), false);
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
  assert.equal(vercelConfig().buildCommand, "pnpm build");
  assert.equal(vercelConfig().outputDirectory, ".next");
});

test("frontend workspace pins a supported Node runtime", () => {
  const packageJson = require("../package.json");
  const nodeVersion = readFileSync(path.join(__dirname, "../.node-version"), "utf8").trim();

  assert.equal(packageJson.engines.node, ">=20.18 <25");
  assert.match(nodeVersion, /^22\./);
});

test("Next traces workspace packages from this repository root", () => {
  const config = source();
  assert.equal(config.includes('path.resolve(__dirname, "../..")'), false);
  assert.equal((config.match(/path\.resolve\(__dirname\)/g) ?? []).length, 2);
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

test("encounter backdrops do not mix background shorthand with image longhands", () => {
  const page = encounterSource();

  assert.equal(page.includes("background: backdrop"), false);
  assert.equal(page.includes("backgroundImage: backdrop"), true);
});

test("calling routes give the full viewport to video", () => {
  const layout = appLayoutSource();

  assert.equal(layout.includes("{!isCalling && <TopNav />}"), true);
  assert.equal(layout.includes("<TopNav />\n      <main"), false);
});

test("signed-in shell lets keyboard users skip repeated navigation", () => {
  const layout = appLayoutSource();
  assert.equal(layout.includes('href="#main-content"'), true);
  assert.equal(layout.includes('id="main-content"'), true);
  assert.equal(layout.includes('tabIndex={-1}'), true);
});

test("compact phones keep notifications visible in the top navigation", () => {
  const nav = topNavSource();

  assert.equal(nav.includes("{width >= 360 && <div>"), true);
  assert.equal(nav.indexOf("<ThemeToggle") < nav.indexOf("<NotificationBell"), true);
});

test("desktop CSP allows the configured backend origin for live API calls", () => {
  const config = source();

  assert.equal(config.includes("const BACKEND_CONNECT_SRC = new URL(AUTH_BACKEND_URL).origin;"), true);
  assert.equal(config.includes('"connect-src \'self\' https: wss:"'), false);
  assert.equal(config.includes("`connect-src 'self' ${BACKEND_CONNECT_SRC} ${BACKEND_SOCKET_CONNECT_SRC} https: wss:`"), true);
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

  assert.equal(page.includes('minHeight: 44'), true);
  assert.equal(page.includes('minWidth: 44'), true);
});

test("public legal pages do not expose internal launch placeholders", () => {
  const copy = `${privacySource()}\n${termsSource()}`;
  assert.equal(copy.includes("preview policy"), false);
  assert.equal(copy.includes("preview terms"), false);
  assert.equal(copy.includes("Replace it with reviewed legal copy"), false);
  assert.equal(copy.includes("before production launch"), false);
  assert.equal(termsSource().includes("Tokens and Giggle+"), true);
  assert.equal((copy.match(/data-theme="dark"/g) ?? []).length, 2);
});

test("landing page avoids excessive pinned-scroll dead space", () => {
  const page = landingSource();

  assert.equal(page.includes('isPhone ? "170vh" : "210vh"'), true);
  assert.equal(page.includes('isPhone ? "320vh" : "380vh"'), false);
});

test("landing video scrub survives cached media loading before hydration", () => {
  const page = landingSource();

  assert.equal(page.includes("if (v.readyState >= 1) onLoaded();"), true);
  assert.equal(page.includes("const [duration, setDuration] = useState(0);"), true);
  assert.equal(page.includes("[p, failed, duration]"), true);
});

test("landing page keeps its dark brand theme after app theme changes", () => {
  const page = landingSource();

  assert.equal(page.includes('<div data-theme="dark" style={{ position: "relative", background: C.base'), true);
});

test("landing reveal content is visible by default", () => {
  const page = landingSource();

  assert.equal(page.includes("const [shown, setShown] = useState(true);"), true);
  assert.equal(page.includes("const [shown, setShown] = useState(false);"), false);
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
  assert.equal(page.includes('const dim = isShortPhone ? 190'), true);
  assert.equal(page.includes('width: isShortPhone ? "25%"'), true);
  assert.equal(page.includes("!matchFound && !isShortPhone"), true);
});

test("desktop matchmaking cancel stays put when backend cancel fails", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("const [cancelError, setCancelError]"), true);
  assert.equal(page.includes("Couldn't cancel search. Your squad is still in the queue."), true);
  assert.equal(page.includes('cancelError ? "Try cancel again" : "Cancel search"'), true);
  assert.equal(page.includes('router.push(`/lobby?squad=${squadId}`);'), true);
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

test("mobile match keeps the action card in normal flow", () => {
  const page = matchSource();

  assert.equal(page.includes('gridRow: isPhone ? 2 : undefined'), true);
  assert.equal(page.includes('joinPressed ? "panelFade 0.5s ease both" : "fadeUp 0.45s 0.15s both"'), true);
  assert.equal(page.includes('resolveCover(myCover)'), true);
  assert.equal(page.includes('resolveCover(opponentCover)'), true);
  assert.equal(page.includes("@media (max-width: 640px) and (max-height: 680px)"), true);
  assert.equal(page.includes(".match-countdown { display: none !important; }"), true);
  assert.equal(page.includes('overflowY: isPhone ? "auto" : "hidden"'), true);
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

  assert.equal(page.includes("const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);"), true);
  assert.equal(page.includes("const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);"), true);
  assert.equal(page.includes("function clearRevealTimers()"), true);
  assert.equal(page.includes("clearRevealTimers();"), true);
  assert.equal(page.includes("revealTimeoutRef.current = setTimeout(() => setMatchVisible(true), 30);"), true);
  assert.equal(page.includes("navigationTimeoutRef.current = setTimeout(() => {"), true);
});

test("lobby missing-squad state is a polished empty state with mobile touch targets", () => {
  const page = lobbySource();

  assert.equal(page.includes("Squad not found. <button"), false);
  assert.equal(page.includes("This lobby link is no longer active"), true);
  assert.equal(page.includes('minHeight: 44'), true);
  assert.equal(page.includes('router.push("/discover")'), true);
});

test("mobile lobby gives video space to people instead of invite placeholders", () => {
  const page = lobbySource();

  assert.equal(page.includes("const showInviteTile = canInvite && !isNarrow;"), true);
  assert.equal(page.includes("showUpgradeTile"), false);
  assert.equal(page.includes("Unlock 4 more seats"), false);
  assert.equal(page.includes("{isNarrow && isLeader && ("), true);
  assert.equal(page.includes("{!isNarrow && <button\n              onClick={handleInvite}"), true);
  assert.equal(page.includes('flex: isPhone ? "1 0 100%" : undefined'), true);
  assert.equal(page.includes('display: isNarrow ? "none" : "flex"'), true);
});

test("desktop lobby leave button calls backend before leaving the lobby", () => {
  const page = lobbySource();

  assert.equal(page.includes("async function handleLeaveSquad()"), true);
  assert.equal(page.includes("await api.leaveSquad(squadId);"), true);
  assert.equal(page.includes("setMatchError((e as { message?: string })?.message || \"Couldn't leave squad.\")"), true);
  assert.equal(page.includes("onClick={handleLeaveSquad}"), true);
});

test("desktop lobby ready toggle surfaces backend failures", () => {
  const page = lobbySource();

  assert.equal(page.includes("setMatchError((e as { message?: string })?.message || \"Couldn't update ready status.\")"), true);
  assert.equal(page.includes('console.error("setReady failed:", e);'), false);
});

test("desktop lobby requires explicit readiness before starting a match", () => {
  const page = lobbySource();

  assert.equal(page.includes("try { await api.setReady(squadId, true); } catch {}"), false);
  assert.equal(page.includes("try { await api.setLobbyVideo(squadId, true); } catch {}"), false);
  assert.equal(page.includes("const everyoneReady = !!squad?.members.length && squad.members.every(member => member.ready);"), true);
  assert.equal(page.includes("Everyone needs to be ready before you find a match."), true);
  assert.equal(page.includes("await api.setReady(squadId, true);\n      await api.setLobbyVideo"), false);
  assert.equal(page.includes("await api.setLobbyVideo(squadId, true);\n      await api.startSearch(squadId);"), true);
});

test("lobby asks before starting camera and microphone", () => {
  const page = lobbySource();

  assert.equal(page.includes("Used in this lobby and live encounters."), true);
  assert.equal(page.includes('aria-label="Enable camera and microphone"'), true);
  assert.equal(page.includes("if (!joinStartedRef.current)"), false);
});

test("desktop lobby copy actions only show success after clipboard writes succeed", () => {
  const page = lobbySource();

  assert.equal(page.includes("async function copyToClipboard("), true);
  assert.equal(page.includes("await navigator.clipboard.writeText(text);"), true);
  assert.equal(page.includes("setMatchError(failureMessage);"), true);
  assert.equal(page.includes("setInviteCopied(true);"), true);
  assert.equal(page.includes("setCodeCopied(true);"), true);
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
  assert.equal(page.includes("setSelectedVibes(normalizeVibeLabels(s.tags));"), true);
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

test("mobile encounter gives the available stage height to people", () => {
  const page = encounterSource();
  const versus = page.slice(page.indexOf("const renderVersus"), page.indexOf("const renderGrid"));
  assert.equal(versus.includes('display: isPhone ? "block" : "flex"'), false);
  assert.equal(versus.includes('height: isPhone ? 132'), false);
  assert.equal(versus.includes('flexDirection: isPhone ? "column"'), true);
  assert.equal(versus.includes('gridTemplateRows: `repeat(${versusRows}, 1fr)`'), true);
  assert.equal(page.includes('const isCompactPhone = width <= 360'), true);
  assert.equal(page.includes('display: isCompactPhone ? "none" : "flex"'), true);
});

test("desktop encounter end always attempts backend cleanup before navigating", () => {
  const page = encounterSource();
  const endBlock = page.slice(
    page.indexOf("async function handleEnd()"),
    page.indexOf("  function handleReport()")
  );

  assert.match(endBlock, /try \{\s*await vcRef\.current\?\.leave\(\);\s*\} catch \{\}/);
  assert.match(endBlock, /await api\.disconnectEncounter\(squadId, encId\);/);
  assert.match(endBlock, /router\.push\("\/home"\);/);
  assert.equal(endBlock.indexOf('router.push("/home");') > endBlock.indexOf("await api.disconnectEncounter(squadId, encId);"), true);
  assert.match(endBlock, /setEnding\(false\);/);
  assert.match(endBlock, /setVideoError\(\(e as \{ message\?: string \}\)\?\.message \|\| "Couldn't end this encounter yet\."\);/);
  assert.equal(endBlock.includes('console.error("End encounter failed (non-fatal):", e);'), false);
});

test("desktop chat keeps unsent text and shows a delivery error", () => {
  const component = chatPanelSource();

  assert.equal(component.includes("const [sendError, setSendError]"), true);
  assert.equal(component.includes("const sent = sendChatMessage(scope, text"), true);
  assert.equal(component.includes("if (!sent) {"), true);
  assert.equal(component.includes("setSendError(\"Message not sent. Check your connection and try again.\")"), true);
  assert.equal(component.includes("setInput(\"\");"), true);
  assert.equal(component.indexOf("setInput(\"\");") > component.indexOf("if (!sent) {"), true);
  assert.equal(component.includes("role=\"alert\""), true);
});

test("desktop encounter chat filters messages to the active encounter", () => {
  const component = chatPanelSource();

  assert.equal(component.includes("return msg.encounterId === scopeEncounterId;"), true);
  assert.equal(component.includes("// Encounter: show everything in the encounter (both squads)."), false);
  assert.equal(component.includes("return true;"), false);
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
  assert.equal(fireBlock.indexOf("spawnReaction(emoji);") > fireBlock.indexOf("if (!sent) {"), true);
  assert.equal(fireBlock.includes("spawnReaction(emoji); // optimistic local"), false);
});

test("desktop encounter report button only shows success after realtime send succeeds", () => {
  const page = encounterSource();
  const reportBlock = page.slice(
    page.indexOf("function handleReport()"),
    page.indexOf("  // Spawn a floating emoji")
  );

  assert.equal(page.includes("reportOpponentSquad"), true);
  assert.match(reportBlock, /const sent = reportOpponentSquad\(\{/);
  assert.match(reportBlock, /if \(!sent\) \{/);
  assert.match(reportBlock, /setVideoError\("Report was not sent\. Check your connection and try again\."\);/);
  assert.equal(reportBlock.includes("console.error(\"report_squad emit failed"), false);
  assert.equal(reportBlock.indexOf("setReported(true);") > reportBlock.indexOf("if (!sent) {"), true);
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

  assert.equal(card.includes("backgroundImage: `url(${resolveCover(squad.coverImage)})`"), false);
  assert.equal(card.includes("background: resolveCover(squad.coverImage)"), true);
  assert.equal(homePage.includes("url(${resolveCover(s.coverImage)})"), false);
  assert.equal(homePage.includes("background: resolveCover(squad.coverImage)"), true);
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

  assert.equal(page.includes("canRedeemTokenPerksLocally"), true);
  assert.equal(page.includes("Perk redemption is in launch prep"), true);
  assert.equal(page.includes("disabled={!canAfford || !canRedeemPerks || loading}"), true);
});

test("profile premium upsell does not advertise unbuilt priority or HD features", () => {
  const page = profileSource();

  assert.equal(page.includes("Fast Pass"), false);
  assert.equal(page.includes("HD video"), false);
  assert.equal(page.includes("priority"), false);
});

test("profile account switches persist locally instead of resetting on remount", () => {
  const page = profileSource();

  assert.equal(page.includes("PROFILE_SETTINGS_STORAGE_KEY"), true);
  assert.equal(page.includes("localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY)"), true);
  assert.equal(page.includes("localStorage.setItem(PROFILE_SETTINGS_STORAGE_KEY"), true);
  assert.equal(page.includes("setProfileSetting(\"notificationsOn\""), true);
  assert.equal(page.includes("setProfileSetting(\"openToDiscovery\""), true);
  assert.equal(page.includes("setProfileSetting(\"showOnlineStatus\""), true);
});

test("profile account switch persistence ignores malformed stored settings", () => {
  const page = profileSource();

  assert.equal(page.includes("function normalizeProfileSettings("), true);
  assert.equal(page.includes("const parsed = normalizeProfileSettings(JSON.parse(raw));"), true);
  assert.equal(page.includes("const current = raw ? normalizeProfileSettings(JSON.parse(raw)) : DEFAULT_PROFILE_SETTINGS;"), true);
  assert.equal(page.includes("...current,"), true);
  assert.equal(page.includes("const current = raw ? JSON.parse(raw) : {};"), false);
});

test("profile vibe preferences are normalized before render and persistence", () => {
  const page = profileSource();

  assert.equal(page.includes("function normalizeProfileVibes("), true);
  assert.equal(page.includes("const [vibes, setVibes] = useState<string[]>(() => normalizeProfileVibes(DEFAULT_VIBES));"), true);
  assert.equal(page.includes("setVibes(normalizeProfileVibes(JSON.parse(stored)));"), true);
  assert.equal(page.includes("const next = normalizeProfileVibes("), true);
  assert.equal(page.includes("localStorage.setItem(VIBE_STORAGE_KEY, JSON.stringify(next));"), true);
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
  assert.equal(page.includes('minHeight: 44'), true);
  assert.equal(page.includes('minWidth: 44'), true);
});

test("desktop sign-in exposes every backend OAuth provider", () => {
  const page = signinSource();

  assert.equal(page.includes('provider: "google" | "apple"'), true);
  assert.equal(page.includes('oauthRedirect("google")'), true);
  assert.equal(page.includes('oauthRedirect("apple")'), true);
  assert.equal(page.includes("Continue with Apple"), true);
  assert.equal(page.includes("<Icon.apple"), true);
});

test("desktop sign-in stays focused and fits one viewport", () => {
  const page = signinSource();

  assert.equal(page.includes('height: "100dvh"'), true);
  assert.equal(page.includes('/img/onboarding-hero.jpg'), true);
  assert.equal(page.includes('const props:'), false);
  assert.equal(page.includes('Bring your whole squad'), false);
});

test("squad preview joins by squad id instead of leaked squad code", () => {
  const component = readFileSync(path.join(__dirname, "../components/SquadPreview.tsx"), "utf8");
  const homePage = readFileSync(path.join(__dirname, "../app/(app)/home/page.tsx"), "utf8");

  assert.equal(component.includes("api.joinSquadById(squad.squadId)"), true);
  assert.equal(component.includes("api.joinSquad({ squadCode: squad.squadCode })"), false);
  assert.equal(homePage.includes("api.joinSquadById(sq.squadId)"), true);
  assert.equal(homePage.includes("api.joinSquad({ squadCode: sq.squadCode })"), false);
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
  const profileGridEnd = profile.lastIndexOf("</div>");
  assert.equal(profile.indexOf("{pickerOpen && <AvatarPicker") > profileGridEnd, true);
  assert.equal(picker.includes('role="dialog"'), true);
  assert.equal(picker.includes('aria-modal="true"'), true);
  assert.equal(picker.includes('aria-label="Close avatar picker"'), true);
  assert.equal(picker.includes('width: 44, height: 44'), true);
  assert.equal(picker.includes('if (event.key === "Escape") onClose()'), true);
  assert.equal(picker.includes("createPortal("), true);
  assert.equal(picker.includes("document.body"), true);
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
  assert.equal(picker.includes('role="dialog"'), true);
  assert.equal(picker.includes('aria-modal="true"'), true);
  assert.equal(picker.includes('aria-label="Close cover picker"'), true);
  assert.equal(picker.includes('width: 44, height: 44'), true);
  assert.equal(picker.includes('if (event.key === "Escape") onClose()'), true);
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
  const api = readFileSync(path.join(__dirname, "../packages/core/src/api.ts"), "utf8");

  assert.equal(api.includes("dismissNotification"), true);
  assert.equal(api.includes('method: "DELETE"'), true);
  assert.equal(bell.includes("api.dismissNotification(n.id)"), true);
  assert.equal(bell.includes("onDismiss(n.id);"), true);
});

test("notification action failures show inline errors", () => {
  const bell = notificationBellSource();

  assert.equal(bell.includes("const [actionError, setActionError]"), true);
  assert.equal(bell.includes("setActionError(\"Couldn't accept this friend request.\")"), true);
  assert.equal(bell.includes("setActionError(\"Couldn't join this squad invite.\")"), true);
  assert.equal(bell.includes("setActionError(\"Couldn't dismiss this notification.\")"), true);
  assert.equal(bell.includes("{actionError &&"), true);
});

test("notification mark-read UI waits for backend success", () => {
  const bell = notificationBellSource();

  assert.equal(bell.includes("const previousUnread = unread;"), true);
  assert.equal(bell.includes("const previousItems = items;"), true);
  assert.equal(bell.includes("setUnread(previousUnread);"), true);
  assert.equal(bell.includes("setItems(previousItems);"), true);
  assert.equal(bell.includes("await api.markNotificationsRead();"), true);
  assert.equal(bell.includes("setItems((prev) => prev.map((p) => ({ ...p, read: true })));"), true);
  assert.equal(bell.indexOf("await api.markNotificationsRead();") < bell.indexOf("setItems((prev) => prev.map((p) => ({ ...p, read: true })));"), true);
});

test("notification row actions only resolve after mark-read succeeds", () => {
  const bell = notificationBellSource();

  assert.equal(bell.includes("const markRead = useCallback(async () => {"), true);
  assert.equal(bell.includes("return true;"), true);
  assert.equal(bell.includes("return false;"), true);
  assert.equal(bell.includes("if (!(await markRead())) throw new Error(\"MARK_READ_FAILED\");"), true);
  assert.equal(bell.includes("onResolve(n.id);"), true);
  assert.equal(bell.indexOf("await api.markNotificationRead(n.id);") < bell.indexOf("onResolve(n.id);"), true);
  assert.equal(bell.includes("onDismiss(n.id);\n    try {\n      await api.markNotificationRead(n.id);"), false);
});

test("desktop protected home actions do not create dev sessions", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("await session.devSignIn();"), false);
  assert.equal(page.includes('router.push("/signin")'), true);
  assert.equal(page.includes("Sign in to continue."), true);
  assert.equal(page.includes("return false;"), true);
});

test("desktop home creates a neutral squad without hidden vibe state", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("api.createSquad({ squadName: randomSquadName(), tags: [] })"), true);
  assert.equal(page.includes("selectedVibes"), false);
  assert.equal(page.includes("VIBE_OPTIONS"), false);
});

test("desktop home keeps one compact live activity strip", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes('aria-label="Live activity"'), true);
  assert.equal(page.includes('{ k: "Your squads"'), true);
  assert.equal(page.includes('{ k: "Open signals"'), true);
  assert.equal(page.includes('{ k: "Live now"'), true);
  assert.equal(page.includes('label: "SQUADS FORMED"'), false);
});

test("desktop home loading state mirrors squad-card content", () => {
  const page = desktopHomeSource();
  assert.equal(page.includes('aria-label="Loading your squads"'), true);
  assert.equal(page.includes('className="gg-shimmer" style={{ height: 160'), false);
});

test("desktop home keeps create and join actions compact", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("Open a new room"), false);
  assert.equal(page.includes("Start a room and invite your people."), false);
  assert.equal(page.includes('aria-label="Squad actions"'), true);
  assert.equal(page.includes('aria-label="Squad invite code"'), true);
});

test("desktop home leave squad failures restore the squad and show an error", () => {
  const page = desktopHomeSource();

  assert.equal(page.includes("const previousSquads = mySquads;"), true);
  assert.equal(page.includes("setMySquads(previousSquads);"), true);
  assert.equal(page.includes("setActionError((e as { message?: string })?.message || \"Couldn't leave that squad.\")"), true);
  assert.equal(page.includes("catch { /* refetch will resync if it failed */ }"), false);
});

test("desktop discover applies the active vibe filter to newly created squads", () => {
  const page = desktopDiscoverSource();

  assert.equal(page.includes("api.createSquad({ squadName: randomSquadName(), tags: vibe ? [vibe] : [] })"), true);
  assert.equal(page.includes("await api.setTags(squad.squadId, [vibe]);"), false);
  assert.equal(page.includes("Start one with this vibe"), true);
});

test("desktop discover keeps creation in the filtered empty state", () => {
  const page = desktopDiscoverSource();

  assert.equal(page.includes("primaryCtaCreates"), false);
  assert.equal(page.includes("handlePrimaryCta"), false);
  assert.equal(page.includes("shown.length === 0"), true);
  assert.equal(page.includes("primary={{ label: creating ? \"Creating…\" : (vibe ? `Create a ${vibe} squad` : \"Create a squad\"), onClick: handleCreate, disabled: creating }}"), true);
  assert.equal(page.includes("right={hasOpenSquads ? ("), true);
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

  const createStart = page.indexOf("async function handleCreate()");
  const createAuth = page.indexOf("if (!ensureAuthed()) return;", createStart);
  const createLoading = page.indexOf("setCreating(true);", createStart);
  assert.ok(createStart >= 0);
  assert.ok(createAuth >= 0);
  assert.ok(createLoading >= 0);
  assert.ok(createAuth < createLoading);

  const joinStart = page.indexOf("async function handleJoin()");
  const joinAuth = page.indexOf("if (!ensureAuthed()) return;", joinStart);
  const joinLoading = page.indexOf("setJoining(true);", joinStart);
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
  for (const page of [friendsPageSource(), inviteToSquadSource(), squadPreviewSource()]) {
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

test("friends empty state stays compact and points back to search", () => {
  const page = friendsPageSource();

  assert.equal(page.includes("No friends yet — search above to add people."), false);
  assert.equal(page.includes("Your crew starts here"), true);
  assert.equal(page.includes("Search by name above to send your first request."), true);
  assert.equal(page.includes("Social graph"), false);
  assert.equal(page.includes("Share a squad code"), false);
});

test("friends search treats incoming request users as actionable requests", () => {
  const page = friendsPageSource();

  assert.equal(page.includes("const incomingIds = new Set(incoming.map((u) => u.userId));"), true);
  assert.equal(page.includes("const incomingRequest = incoming.find((i) => i.userId === u.userId);"), true);
  assert.equal(page.includes("incomingRequest ? ("), true);
  assert.equal(page.includes("handleAccept(incomingRequest)"), true);
  assert.equal(page.includes("handleDecline(incomingRequest)"), true);
});

test("friends add failures roll back pending state and show an error", () => {
  const page = friendsPageSource();

  assert.equal(page.includes("const [actionError, setActionError]"), true);
  assert.equal(page.includes("setActionError(null);"), true);
  assert.equal(page.includes("setOutgoing((o) => o.filter((x) => x.userId !== u.userId));"), true);
  assert.equal(page.includes("setActionError((e as { message?: string })?.message || \"Couldn't send friend request.\")"), true);
  assert.equal(page.includes('role="alert"'), true);
});

test("friends request action failures roll back optimistic UI", () => {
  const page = friendsPageSource();

  assert.equal(page.includes("setActionError((e as { message?: string })?.message || \"Couldn't accept friend request.\")"), true);
  assert.equal(page.includes("setIncoming((i) => (i.some((x) => x.userId === u.userId) ? i : [u, ...i]));"), true);
  assert.equal(page.includes("setFriends((f) => f.filter((x) => x.userId !== u.userId));"), true);
  assert.equal(page.includes("setActionError((e as { message?: string })?.message || \"Couldn't decline friend request.\")"), true);
  assert.equal(page.includes("setActionError((e as { message?: string })?.message || \"Couldn't remove friend.\")"), true);
  assert.equal(page.includes("setFriends((f) => (f.some((x) => x.userId === u.userId) ? f : [u, ...f]));"), true);
  assert.equal(page.includes('console.error("acceptFriend failed:", e);'), false);
  assert.equal(page.includes('console.error("declineFriend failed:", e);'), false);
  assert.equal(page.includes('console.error("removeFriend failed:", e);'), false);
});

test("profile can clear a previously saved age", () => {
  const page = profileSource();
  const api = readFileSync(path.join(__dirname, "../packages/core/src/api.ts"), "utf8");

  assert.equal(page.includes("const body: { gender?: string; age?: number | null; languages?: string[]; country?: string } = {};"), true);
  assert.equal(page.includes("body.age = null;"), true);
  assert.equal(api.includes("age?: number | null"), true);
});

test("profile keeps account identifiers out of the identity hero", () => {
  const page = profileSource();
  const hero = page.slice(page.indexOf("{/* Avatar card */}"), page.indexOf("{/* Giggle+ status */}"));
  const account = page.slice(page.indexOf(">Account</div>"));
  assert.equal(hero.includes("user?.email"), false);
  assert.equal(hero.includes("handle"), false);
  assert.equal(account.includes("Signed in as"), true);
});
