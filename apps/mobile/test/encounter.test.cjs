const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = () => readFileSync(path.join(__dirname, "../app/(app)/encounter.tsx"), "utf8");
const discoverSource = () => readFileSync(path.join(__dirname, "../app/(app)/discover.tsx"), "utf8");
const homeSource = () => readFileSync(path.join(__dirname, "../app/(app)/home.tsx"), "utf8");
const profileSource = () => readFileSync(path.join(__dirname, "../app/(app)/profile.tsx"), "utf8");
const lobbySource = () => readFileSync(path.join(__dirname, "../app/(app)/lobby.tsx"), "utf8");
const matchSource = () => readFileSync(path.join(__dirname, "../app/(app)/match.tsx"), "utf8");
const matchmakingSource = () => readFileSync(path.join(__dirname, "../app/(app)/matchmaking.tsx"), "utf8");
const venueCardSource = () => readFileSync(path.join(__dirname, "../components/VenueCard.tsx"), "utf8");
const squadCoverSource = () => readFileSync(path.join(__dirname, "../components/squadCover.ts"), "utf8");

test("mobile profile lists blocked accounts and keeps failed unblocks retryable", () => {
  const page = profileSource();
  const handler = page.slice(page.indexOf("async function unblockAccount"), page.indexOf("async function openResource"));
  const blockedSection = page.slice(
    page.indexOf('<Text style={styles.sectionLabel}>Blocked accounts'),
    page.indexOf('<Text style={styles.sectionLabel}>Help & policies')
  );

  assert.match(page, /Blocked accounts/);
  assert.match(page, /api\.listBlockedUsers\(\)/);
  assert.match(handler, /await api\.unblockUser\(account\.userId\)/);
  assert.match(handler, /setBlockedAccounts\(\(current\) => current\.filter/);
  assert.equal(handler.indexOf("setBlockedAccounts") > handler.indexOf("await api.unblockUser"), true);
  assert.match(page, /Couldn't load blocked accounts\./);
  assert.match(page, /Couldn't unblock that account\./);
  assert.match(blockedSection, /blocksError \? null/);
  assert.equal(blockedSection.indexOf("blocksError ?") < blockedSection.indexOf("blockedAccounts.length === 0"), true);
});

test("mobile encounter derives one adaptive layout from stable identities and real media", () => {
  const page = source();

  assert.equal(page.includes("deriveEncounterLayout"), true);
  assert.equal(page.includes("advanceSpeakerFocus"), true);
  assert.equal(page.includes("type ViewMode"), false);
  assert.equal(page.includes("const MODES"), false);
  assert.equal(page.includes("displayTiles"), false);
  assert.equal(page.includes("enc.squadAId === squadId"), true);
  assert.equal(page.includes("id: m.userId"), true);
  assert.equal(page.includes("uid: m.uid"), true);
  assert.equal(page.includes("String(remote.uid) === String(person.uid)"), true);
  assert.equal(page.includes("width < 600 ? 'phone' : width < 900 ? 'narrow' : 'wide'"), true);
  assert.equal(page.includes("height >= Math.max(width, 640)"), true);
  assert.equal(page.includes("onVolumes"), true);
  assert.equal(page.includes("onConnectionState"), true);
  assert.equal(page.includes("onCaptureState"), true);
  assert.equal(page.includes("state.audio === 'denied' || state.audio === 'unavailable'"), true);
  assert.equal(page.includes("state.video === 'denied' || state.video === 'unavailable'"), true);
  assert.equal(page.includes('fit="fit"'), true);
  assert.equal(page.includes('fit="crop"'), true);
  for (const kind of ['remote-main', 'squad-split', 'featured-split', 'single-focus', 'dual-focus']) {
    assert.equal(page.includes(`layout.kind === '${kind}'`), true);
  }
  assert.equal(page.includes("BackHandler.addEventListener"), true);
  assert.equal(page.includes("{person.isLocal ? 'You' : person.name}"), true);
  assert.equal(page.includes("{person.name}{person.isLocal ? ' (You)' : ''}"), false);
});

test("mobile encounter keeps five controls while chat, More, reactions, and ending use sheets", () => {
  const page = source();
  const endBlock = page.slice(page.indexOf("async function endEncounter()"), page.indexOf("const compactHeader"));
  const reactionBlock = page.slice(page.indexOf("function fireReaction"), page.indexOf("function retryVideo"));

  assert.equal(page.includes("accessibilityLabel={mic ? 'Mute microphone' : 'Unmute microphone'}"), true);
  assert.equal(page.includes("accessibilityLabel={cam ? 'Turn camera off' : 'Turn camera on'}"), true);
  for (const label of ['Chat', 'More', 'End encounter']) assert.equal(page.includes(`accessibilityLabel="${label}"`), true);
  assert.equal(page.includes("width: 52, height: 52"), true);
  assert.equal(page.includes("<Modal"), true);
  assert.equal(page.includes("onRequestClose"), true);
  assert.equal(page.includes("KeyboardAvoidingView"), true);
  assert.equal(page.includes("joinChat"), true);
  assert.equal(page.includes("sendChatMessage"), true);
  assert.equal(page.includes("subscribeChat"), true);
  assert.equal(page.includes("sendReaction"), true);
  assert.equal(page.includes("subscribeReaction"), true);
  assert.equal(page.includes("senderId: string"), true);
  assert.equal(page.includes("}, 1800);"), true);
  assert.equal(page.includes("reaction.senderId === person.id"), true);
  assert.equal(reactionBlock.indexOf("spawnReaction(emoji, session.user?.id ?? '')") > reactionBlock.indexOf("if (!sent)"), true);
  assert.equal(page.includes("Animated.timing"), true);
  assert.equal(page.includes("AccessibilityInfo.isReduceMotionEnabled"), true);
  assert.equal(page.includes("messageIdsRef.current.has(message.id)"), true);
  assert.equal(page.includes("message.encounterId !== encId"), true);
  assert.equal(page.includes("visible={showChat}"), true);
  assert.equal(page.includes("height * 0.55"), true);
  assert.equal(page.includes("height - keyboardHeight - 96"), true);
  assert.equal(page.includes("switchCamera"), true);
  assert.equal(page.includes("End encounter?"), true);
  assert.equal(page.includes("This ends the current encounter for both squads."), true);
  assert.equal(endBlock.indexOf("await api.disconnectEncounter(squadId, encId);") >= 0, true);
  assert.equal(endBlock.indexOf("await vcRef.current?.leave();") > endBlock.indexOf("await api.disconnectEncounter(squadId, encId);"), true);
  assert.equal(page.includes("Couldn't end this encounter yet."), true);
});

test("mobile encounter exits cleanly when the other squad ends the call", () => {
  const page = source();

  assert.equal(page.includes("connectSocket(squadId)"), true);
  assert.equal(page.includes("SOCKET_EVENTS.ENCOUNTER_ENDED"), true);
  assert.equal(page.includes("payload?.endedBySquadId === squadId"), true);
  assert.equal(page.includes("payload?.reason === 'squad_disconnected'"), true);
  assert.equal(page.includes("The other squad left"), true);
  assert.equal(page.includes("Your squad is already back in matchmaking."), true);
  assert.equal(page.includes("Continue matching"), true);
});

test("encounter report control is disabled unless a valid report payload exists", () => {
  const page = source();

  assert.equal(page.includes("createReportOpponentPayload"), true);
  assert.equal(page.includes("const canReport = Boolean(reportPayload);"), true);
  assert.equal(page.includes("disabled={!canReport || reported || reporting}"), true);
  assert.equal(page.includes("Report unavailable"), true);
});

test("mobile reports stay retryable until the server confirms persistence", () => {
  const page = source();
  const reportBlock = page.slice(page.indexOf("async function handleReport()"), page.indexOf("function spawnReaction"));

  assert.match(reportBlock, /setReporting\(true\);/);
  assert.match(reportBlock, /const result = await reportOpponentSquad\(/);
  assert.match(reportBlock, /setReporting\(false\);/);
  assert.match(reportBlock, /if \(!result\.ok\) \{/);
  assert.equal(reportBlock.indexOf("setReported(true);") > reportBlock.indexOf("if (!result.ok) {"), true);
});

test("mobile encounter does not fabricate participants when encounter data is unavailable", () => {
  const page = source();

  assert.equal(page.includes("name: 'Rival'"), false);
  assert.equal(page.includes("squad: 'Opponents'"), false);
  assert.equal(page.includes("const [encounterError, setEncounterError]"), true);
  assert.equal(page.includes("Encounter unavailable"), true);
});

test("mobile encounter surfaces video join failures", () => {
  const page = source();

  assert.equal(page.includes("const [videoError, setVideoError]"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't join video.\")"), true);
  assert.equal(page.includes("Video unavailable"), true);
});

test("mobile encounter shows one recovery banner when video and capture fail together", () => {
  const page = source();

  assert.equal(page.includes("videoError && captureIssues.length === 0"), true);
  assert.equal(page.includes("captureIssues.length > 0"), true);
});

test("mobile encounter surfaces video presence update failures", () => {
  const page = source();

  assert.equal(page.includes("try { await api.setEncounterVideo(squadId, true); } catch {}"), false);
  assert.equal(page.includes("await api.setEncounterVideo(squadId, true);"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't join video.\")"), true);
});

test("mobile encounter does not present unsent chat as sent", () => {
  const page = source();
  const sendBlock = page.slice(page.indexOf("function sendMessage()"), page.indexOf("async function handleMicToggle()"));

  assert.equal(page.includes("const [chatError, setChatError]"), true);
  assert.equal(sendBlock.includes("const sent = sendChatMessage("), true);
  assert.equal(sendBlock.includes("if (!sent)"), true);
  assert.equal(sendBlock.includes("setChatError(\"Couldn't send message.\")"), true);
  assert.equal(page.includes("Message not sent"), true);
  assert.equal(sendBlock.includes("setMessages("), false);
  assert.equal(sendBlock.indexOf("setDraft('');") > sendBlock.indexOf("if (!sent)"), true);
});

test("mobile encounter rolls back mic and camera controls when video updates fail", () => {
  const page = source();

  assert.equal(page.includes("const previous = mic;"), true);
  assert.equal(page.includes("setMic(previous);"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't update microphone.\")"), true);
  assert.equal(page.includes("const previous = cam;"), true);
  assert.equal(page.includes("setCam(previous);"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't update camera.\")"), true);
  assert.equal(page.includes("try { await vcRef.current?.setMicEnabled(next); } catch {}"), false);
  assert.equal(page.includes("try { await vcRef.current?.setCamEnabled(next); } catch {}"), false);
});

test("mobile match does not enter an encounter when acknowledgement fails", () => {
  const page = matchSource();

  assert.equal(page.includes("const [joinError, setJoinError]"), true);
  assert.equal(page.includes("await api.ackEncounter(encId, squadId);"), true);
  assert.equal(page.includes("setJoinError(e?.message || \"Couldn't join this encounter yet.\")"), true);
  assert.equal(page.includes("try { await api.ackEncounter(encId, squadId); } catch {}"), false);
});

test("mobile match preview does not fabricate opponents when encounter data is unavailable", () => {
  const page = matchSource();

  assert.equal(page.includes("const [encounterError, setEncounterError]"), true);
  assert.equal(page.includes("Match unavailable"), true);
  assert.equal(page.includes("Loading match"), true);
  assert.equal(page.includes(": 'Opponents'"), false);
  assert.equal(page.includes(": 'Your Squad'"), false);
});

test("mobile match does not return to matchmaking when skip fails", () => {
  const page = matchSource();

  assert.equal(page.includes("setJoinError(e?.message || \"Couldn't skip this match yet.\")"), true);
  assert.equal(page.includes("try { await api.skip(squadId, encId); } catch {}"), false);
});

test("mobile match follows the server handoff deadline without auto-joining", () => {
  const page = matchSource();

  assert.equal(page.includes("const deadline = Date.parse(encounterData.expiresAt);"), true);
  assert.equal(page.includes("Math.ceil((deadline - Date.now()) / 1000)"), true);
  assert.equal(page.includes("setCountdownTotal(secondsLeft);"), true);
  assert.equal(page.includes("useState(10)"), false);
  assert.equal(page.includes("countdown === 0) {\n      handleJoin()"), false);
  assert.equal(page.includes("Auto-joining in"), false);
});

test("mobile match uses encounter covers and removes hardcoded photos and tags", () => {
  const page = matchSource();

  assert.equal(page.includes("squadCoverSource(yourCover)"), true);
  assert.equal(page.includes("squadCoverSource(theirCover)"), true);
  assert.equal(page.includes("const VIBE_TAGS"), false);
  assert.equal(page.includes("match-your-squad.jpg"), false);
  assert.equal(page.includes("match-opponent-squad.jpg"), false);
  assert.equal(page.includes("squad?.tags?.slice(0, 2).join(' & ')"), true);
});

test("mobile match keeps recoverable handoff failures retryable", () => {
  const page = matchSource();

  assert.equal(page.includes("function isExpiredEncounterError"), true);
  assert.equal(page.includes("const [loadAttempt, setLoadAttempt]"), true);
  assert.equal(page.includes("setLoadAttempt((attempt) => attempt + 1)"), true);
  assert.equal(page.includes("Couldn't open match"), true);
  assert.equal(page.includes("Find another"), true);
});

test("mobile home applies the selected vibe to create and discover flows", () => {
  const page = homeSource();

  assert.equal(page.includes("api.createSquad({ squadName: randomSquadName(), tags: [activeVibe] })"), true);
  assert.equal(page.includes("await api.setTags(squad.squadId, [activeVibe]);"), false);
  assert.equal(page.includes("router.push(`/discover?vibe=${encodeURIComponent(activeVibe)}`)"), true);
});

test("mobile home create does not redirect to an existing squad on stale single-squad errors", () => {
  const page = homeSource();

  assert.equal(page.includes("ALREADY_IN_SQUAD"), false);
  assert.equal(page.includes("api.mySquad()"), false);
});

test("mobile home lists and reopens the user's real squads", () => {
  const page = homeSource();

  assert.equal(page.includes("api.mySquads()"), true);
  assert.equal(page.includes("setMySquads(squads ?? [])"), true);
  assert.equal(page.includes(">Your squads</Text>"), true);
  assert.equal(page.includes("function squadDestination"), true);
  assert.equal(page.includes("['searching', 'matched', 'in_encounter'].includes(squad.status)"), true);
  assert.equal(page.includes("router.push(squadDestination(squad))"), true);
  assert.equal(page.includes("Couldn't load your squads."), true);
  assert.equal(page.includes("accessibilityLabel=\"Retry loading squads\""), true);
});

test("mobile discover initializes its filter from the vibe query param", () => {
  const page = discoverSource();

  assert.equal(page.includes("useLocalSearchParams"), true);
  assert.equal(page.includes("const initialFilter = normalizeFilterParam(params.vibe);"), true);
  assert.equal(page.includes("useState(initialFilter)"), true);
});

test("mobile discover supports the home screen default Casual vibe", () => {
  const page = discoverSource();

  assert.equal(page.includes("'Casual'"), true);
});

test("mobile discover empty state creates a squad with the active vibe filter", () => {
  const page = discoverSource();

  assert.equal(page.includes("api.createSquad({ squadName: randomSquadName(), tags: filter === 'All' ? [] : [filter] })"), true);
  assert.equal(page.includes("onPress={createFilteredSquad}"), true);
  assert.equal(page.includes("router.push('/home')"), false);
});

test("mobile squad cards use real covers and never render tags as people", () => {
  const discover = discoverSource();
  const card = venueCardSource();
  const cover = squadCoverSource();

  assert.equal(discover.includes("coverImage={s.coverImage}"), true);
  assert.equal(discover.includes("members={[s.leaderName || 'Leader']}"), true);
  assert.equal(discover.includes("...(s.tags ?? []).slice(0, 2)"), false);
  assert.equal(card.includes("squadCoverSource(coverImage)"), true);
  assert.equal(card.includes("const VENUE_IMAGES"), false);
  assert.equal(cover.includes("'photo-neon-nights': require('../assets/img/venue-neon-nights.jpg')"), true);
  assert.equal(cover.includes("return { uri: coverImage };"), true);
});

test("mobile profile omits settings rows that only advertise unavailable actions", () => {
  const page = profileSource();

  assert.equal(page.includes("const SETTINGS = ["), false);
  assert.equal(page.includes("selectedSetting"), false);
  assert.equal(page.includes("Available in app settings"), false);
  assert.equal(page.includes(">Settings</Text>"), false);
});

test("mobile profile loads and saves real vibe preferences", () => {
  const page = profileSource();

  assert.equal(page.includes("api.getMyProfile()"), true);
  assert.equal(page.includes("setVibePrefs(profile.vibes ?? [])"), true);
  assert.equal(page.includes("api.updateMyProfile({ vibes: next })"), true);
  assert.equal(page.includes("setVibePrefs(previous)"), true);
  assert.equal(page.includes("const PROFILE = {"), false);
  assert.equal(page.includes("Account Toggles"), false);
  assert.equal(page.includes("SwitchControl"), false);
});

test("profile logout clears the persisted session before leaving", () => {
  const page = profileSource();

  assert.equal(page.includes("session.signOut();"), true);
  assert.equal(page.includes("router.replace('/')"), true);
});

test("mobile profile renders the signed-in identity instead of a static demo profile", () => {
  const page = profileSource();

  assert.equal(page.includes("name: 'Alex Rivera'"), false);
  assert.equal(page.includes("handle: '@alexr'"), false);
  assert.equal(page.includes("session.user"), true);
  assert.equal(page.includes("<Avatar name={displayName}"), true);
  assert.equal(page.includes("handleFromEmail"), false);
});

test("mobile profile does not show fabricated performance stats", () => {
  const page = profileSource();

  assert.equal(page.includes("Encounters', val: 47"), false);
  assert.equal(page.includes("Wins', val: 42"), false);
  assert.equal(page.includes("Losses', val: 8"), false);
  assert.equal(page.includes("Rating', val: '4.9'"), false);
});

test("mobile profile uses one compact account list instead of a wrapping card grid", () => {
  const page = profileSource();

  assert.equal(page.includes("const accountRows = ["), true);
  assert.equal(page.includes("{ label: 'Access'"), false);
  assert.equal(page.includes("{ label: 'Status'"), false);
  assert.equal(page.includes("<Card style={styles.accountList}>"), true);
  assert.equal(page.includes("<View key={row.label} style={[styles.accountRow, index > 0 && styles.accountRowDivider]}>"), true);
  assert.equal(page.includes("<View style={styles.statsGrid}>"), false);
});

test("mobile profile exposes its back control as a full-sized button", () => {
  const page = profileSource();
  const backPress = page.indexOf("onPress={() => router.back()}");
  const start = page.lastIndexOf("<TouchableOpacity", backPress);
  const backControl = page.slice(start, page.indexOf("</TouchableOpacity>", backPress));

  assert.equal(backControl.includes('accessibilityRole="button"'), true);
  assert.equal(backControl.includes('accessibilityLabel="Go back"'), true);
  assert.match(page, /back: \{[^}]*minHeight: 44[^}]*minWidth: 44/);
  assert.match(page, /back: \{[^}]*alignSelf: 'flex-start'/);
});

test("mobile profile does not fabricate trust tier or vibe score", () => {
  const page = profileSource();

  assert.equal(page.includes("vibeScore: 98"), false);
  assert.equal(page.includes("tier: 'Trusted'"), false);
  assert.equal(page.includes("VIBE SCORE {PROFILE.vibeScore}"), false);
  assert.equal(page.includes("score={currentUser?.isApproved ? 100 : 42}"), false);
  assert.equal(page.includes("function StatusRing({ approved"), true);
  assert.equal(page.includes("<StatusRing approved={!!currentUser?.isApproved}"), true);
  assert.equal(page.includes("const profileStatus = currentUser?.isApproved ? 'Approved' : 'Pending review';"), true);
  assert.equal(page.includes("<Text style={styles.tierText}>{profileStatus}</Text>"), true);
  assert.equal(page.includes("PROFILE STATUS"), false);
});

test("mobile profile links to the real wallet without promising unavailable unlocks", () => {
  const page = profileSource();

  assert.equal(page.includes("radar boost"), false);
  assert.equal(page.includes("HD video"), false);
  assert.equal(page.includes("priority"), false);
  assert.equal(page.includes('accessibilityLabel="Open wallet"'), true);
  assert.equal(page.includes('<Text style={styles.premTitle}>Wallet</Text>'), true);
  assert.equal(page.includes("View your token balance and referral rewards"), true);
  assert.equal(page.includes("Unlock member badges, premium cosmetics, and token perks"), false);
});

test("mobile matchmaking does not upsell unbuilt fast pass priority", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("Fast Pass"), false);
  assert.equal(page.includes("skip the line"), false);
  assert.equal(page.includes("router.push('/premium')"), false);
});

test("mobile matchmaking shows only real queue state and guards missing squad links", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("4 squads nearby"), false);
  assert.equal(page.includes("~30s avg wait"), false);
  assert.equal(page.includes("Queue open"), false);
  assert.equal(page.includes("Live signal"), false);
  assert.equal(page.includes("Squad synced"), false);
  assert.equal(page.includes("Queue signal live"), false);
  assert.equal(page.includes("No squad selected"), true);
  assert.equal(page.includes("status.state !== 'searching'"), true);
  assert.equal(page.includes("router.replace(`/lobby?squad=${squadId}`)"), true);
});

test("mobile matchmaking cancel stays put when backend cancel fails", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("const [cancelError, setCancelError]"), true);
  assert.equal(page.includes("setCancelError(e?.message || \"Couldn't cancel search yet.\")"), true);
  assert.equal(page.includes("if (squadId) { try { await api.cancelSearch(squadId); } catch {} }"), false);
});

test("mobile matchmaking surfaces status polling failures", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("const [statusError, setStatusError]"), true);
  assert.equal(page.includes("setStatusError(e?.message || \"Couldn't refresh matchmaking status.\")"), true);
  assert.equal(page.includes("Queue status unavailable"), true);
  assert.equal(page.includes("} catch {}"), false);
});

test("mobile lobby privacy switch syncs with backend visibility", () => {
  const page = lobbySource();

  assert.equal(page.includes("setIsPrivate(s.visibility !== 'open')"), true);
  assert.equal(page.includes("api.setSquadVisibility(squadId, next ? 'private' : 'open')"), true);
  assert.equal(page.includes("onValueChange={handlePrivacyToggle}"), true);
});

test("mobile lobby privacy failures are visible and rolled back", () => {
  const page = lobbySource();

  assert.equal(page.includes("setIsPrivate(previous);"), true);
  assert.equal(page.includes("setMatchError(e?.message || \"Couldn't update squad privacy.\")"), true);
  assert.equal(page.includes("} catch {\n      setIsPrivate(previous);"), false);
});

test("mobile lobby does not fabricate a member tile before squad data loads", () => {
  const page = lobbySource();

  assert.equal(page.includes("displayName: session.user?.name ?? 'You'"), false);
  assert.equal(page.includes("const [squadError, setSquadError]"), true);
  assert.equal(page.includes("Squad unavailable"), true);
  assert.equal(page.includes("Loading squad"), true);
});

test("mobile lobby hides room controls until squad data is available", () => {
  const page = lobbySource();
  const guard = page.slice(page.indexOf("if (!squadId)"), page.indexOf("const currentVibes"));

  assert.equal(guard.includes("if (!squad)"), true);
  assert.equal(guard.includes("squadError ? 'Squad unavailable' : 'Loading squad'"), true);
  assert.equal(guard.includes('label="Try again"'), true);
  assert.equal(guard.includes('label="Back to home"'), true);
});

test("mobile lobby surfaces video join failures", () => {
  const page = lobbySource();

  assert.equal(page.includes("const [videoError, setVideoError]"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't join lobby video.\")"), true);
  assert.equal(page.includes("Video unavailable"), true);
});

test("mobile lobby surfaces video presence update failures", () => {
  const page = lobbySource();

  assert.equal(page.includes("try { await api.setLobbyVideo(squadId, true); } catch {}"), false);
  assert.equal(page.includes("await api.setLobbyVideo(squadId, true);"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't join lobby video.\")"), true);
});

test("mobile lobby waits for consent before starting camera and clears presence on exit", () => {
  const page = lobbySource();
  const mountBlock = page.slice(page.indexOf("useEffect(() => {"), page.indexOf("const members ="));
  const startBlock = page.slice(page.indexOf("async function startVideo()"), page.indexOf("async function handleMicToggle()"));

  assert.equal(page.includes("const [micOn, setMicOn] = useState(false)"), true);
  assert.equal(page.includes("const [camOn, setCamOn] = useState(false)"), true);
  assert.equal(mountBlock.includes("lobbyToken"), false);
  assert.equal(mountBlock.includes("setLobbyVideo(squadId, true)"), false);
  assert.equal(startBlock.includes("await vc.join(token, { audio: true, video: true });"), true);
  assert.equal(startBlock.indexOf("await api.setLobbyVideo(squadId, true);") > startBlock.indexOf("await vc.join"), true);
  assert.equal(page.includes("void api.setLobbyVideo(squadId, false).catch(() => {})"), true);
  assert.equal(page.includes("accessibilityLabel=\"Enable camera and microphone\""), true);
});

test("mobile lobby rolls back mic and camera controls when video updates fail", () => {
  const page = lobbySource();

  assert.equal(page.includes("const previous = micOn;"), true);
  assert.equal(page.includes("setMicOn(previous);"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't update microphone.\")"), true);
  assert.equal(page.includes("const previous = camOn;"), true);
  assert.equal(page.includes("setCamOn(previous);"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't update camera.\")"), true);
  assert.equal(page.includes("try { await vcRef.current?.setMicEnabled(next); } catch {}"), false);
  assert.equal(page.includes("try { await vcRef.current?.setCamEnabled(next); } catch {}"), false);
});

test("mobile lobby privacy switch is leader-only", () => {
  const page = lobbySource();

  assert.equal(page.includes("{isLeader ? ("), true);
  assert.equal(page.includes("Only leaders can change squad privacy"), true);
  assert.equal(page.includes("visibilityValue"), true);
});

test("mobile lobby does not navigate to matchmaking when start search fails", () => {
  const page = lobbySource();

  assert.equal(page.includes("const [matchError, setMatchError]"), true);
  assert.equal(page.includes("setMatchError(e?.message || \"Couldn't start search yet.\")"), true);
  assert.equal(page.includes("await api.startSearch(squadId);\n      router.push(`/matchmaking?squad=${squadId}`);"), true);
});

test("mobile lobby leaders can mark themselves ready before finding a match", () => {
  const page = lobbySource();

  assert.equal(page.includes("/* Ready — everyone, including leader */"), true);
  assert.equal(page.includes("/* Find a Match — leader only */"), true);
  assert.equal(page.includes("{isLeader && ("), true);
  assert.equal(page.includes("{!isLeader ? ("), false);
});

test("mobile lobby stage contains people only and adapts its rows to the viewport", () => {
  const page = lobbySource();

  assert.equal(page.includes("Empty \"Invite\""), false);
  assert.equal(page.includes("styles.emptyTile"), false);
  assert.equal(page.includes("const TILE_COLS = 2"), false);
  assert.equal(page.includes("const tileCols = width < 600"), true);
  assert.equal(page.includes("const tileRows = Math.ceil"), true);
  assert.equal(page.includes("const [stageHeight, setStageHeight] = useState(0)"), true);
  assert.equal(page.includes("onLayout={({ nativeEvent }) => setStageHeight(nativeEvent.layout.height)}"), true);
  assert.equal(page.includes("stageHeight - SPACE.lg * 2"), true);
  assert.equal(page.includes("height - 270"), false);
  assert.equal(page.includes("size={tileCount === 1 ? 72 : 44}"), true);
  assert.equal(page.includes("tileW * (9 / 16)"), false);
  assert.equal(page.includes("/* Boost (leader only) */"), false);
});

test("mobile lobby rejects links without a squad instead of exposing empty controls", () => {
  const page = lobbySource();

  assert.equal(page.includes("No squad selected"), true);
  assert.equal(page.includes("Open a squad from Home before entering its lobby."), true);
  assert.equal(page.includes('label="Back to home"'), true);
});

test("mobile discover keeps list retries separate from join and create errors", () => {
  const page = discoverSource();

  assert.equal(page.includes("const [loadError, setLoadError]"), true);
  assert.equal(page.includes("const [actionError, setActionError]"), true);
  assert.equal(page.includes("{loadError ? ("), true);
  assert.equal(page.includes("{actionError ? <Text style={styles.actionError}"), true);
  assert.equal(page.includes("setActionError(e?.message || \"Couldn't join that squad.\")"), true);
  assert.equal(page.includes("setActionError(e?.message || \"Couldn't create a squad.\")"), true);
});

test("mobile lobby keeps invite sharing outside the video stage", () => {
  const page = lobbySource();

  assert.equal(page.includes("await Share.share"), true);
  assert.equal(page.includes("accessibilityLabel=\"Invite friends\""), true);
  assert.equal(page.includes("styles.emptyLabel"), false);
});

test("mobile lobby requires every online member to be ready and in video before search", () => {
  const page = lobbySource();

  assert.equal(page.includes("const activeMembers = displayMembers.filter((member) => member.online !== false);"), true);
  assert.equal(page.includes("const everyoneReady = activeMembers.length > 0 && activeMembers.every((member) => member.ready);"), true);
  assert.equal(page.includes("const everyoneInVideo = activeMembers.length > 0 && activeMembers.every((member) =>"), true);
  assert.equal(page.includes("member.userId === myUserId ? videoReady || member.inLobbyVideo : member.inLobbyVideo"), true);
  assert.equal(page.includes("Everyone online needs to be ready before you find a match."), true);
  assert.equal(page.includes("Everyone online needs to join lobby video before you find a match."), true);
  assert.equal(page.includes("disabled={!everyoneReady || !everyoneInVideo || finding}"), true);
});

test("mobile lobby ready toggle surfaces backend failures", () => {
  const page = lobbySource();
  const handler = page.match(/async function toggleReady\(\) \{([\s\S]*?)\n  \}\n\n  async function findMatch/)?.[1] ?? "";

  assert.equal(page.includes("setMatchError(e?.message || \"Couldn't update ready status.\")"), true);
  assert.equal(page.includes("try { await api.setReady(squadId, !myMember.ready); await refetch(); } catch {}"), false);
  assert.match(handler, /setSquad\(\(current\) =>/);
  assert.doesNotMatch(handler, /await refetch\(\)/);
});

test("mobile lobby vibe save keeps the editor open when backend update fails", () => {
  const page = lobbySource();

  assert.equal(page.includes("setMatchError(e?.message || \"Couldn't save vibes.\")"), true);
  assert.equal(page.includes("setVibeModalVisible(false);"), true);
  assert.equal(page.includes("try { await api.setTags(squadId, selectedVibes); await refetch(); } catch {}"), false);
});

test("mobile lobby leave does not navigate home when backend leave fails", () => {
  const page = lobbySource();

  assert.equal(page.includes("setMatchError(e?.message || \"Couldn't leave squad.\")"), true);
  assert.equal(page.includes("if (squadId) { try { await api.leaveSquad(squadId); } catch {} }"), false);
});
