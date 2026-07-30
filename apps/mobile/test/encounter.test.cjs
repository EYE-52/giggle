const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = () => readFileSync(path.join(__dirname, "../app/encounter.tsx"), "utf8");
const discoverSource = () => readFileSync(path.join(__dirname, "../app/discover.tsx"), "utf8");
const homeSource = () => readFileSync(path.join(__dirname, "../app/home.tsx"), "utf8");
const profileSource = () => readFileSync(path.join(__dirname, "../app/profile.tsx"), "utf8");
const lobbySource = () => readFileSync(path.join(__dirname, "../app/lobby.tsx"), "utf8");
const matchSource = () => readFileSync(path.join(__dirname, "../app/match.tsx"), "utf8");
const matchmakingSource = () => readFileSync(path.join(__dirname, "../app/matchmaking.tsx"), "utf8");

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
  assert.equal(page.includes("onVolumes"), true);
  assert.equal(page.includes("onConnectionState"), true);
  assert.equal(page.includes("onCaptureState"), true);
  assert.equal(page.includes('fit="fit"'), true);
  assert.equal(page.includes('fit="crop"'), true);
  for (const kind of ['remote-main', 'squad-split', 'featured-split', 'single-focus', 'dual-focus']) {
    assert.equal(page.includes(`layout.kind === '${kind}'`), true);
  }
  assert.equal(page.includes("BackHandler.addEventListener"), true);
});

test("encounter report control is disabled unless a valid report payload exists", () => {
  const page = source();

  assert.equal(page.includes("createReportOpponentPayload"), true);
  assert.equal(page.includes("const canReport = Boolean(reportPayload);"), true);
  assert.equal(page.includes("disabled={!canReport || reported}"), true);
  assert.equal(page.includes("Report unavailable"), true);
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

test("mobile encounter surfaces video presence update failures", () => {
  const page = source();

  assert.equal(page.includes("try { await api.setEncounterVideo(squadId, true); } catch {}"), false);
  assert.equal(page.includes("await api.setEncounterVideo(squadId, true);"), true);
  assert.equal(page.includes("setVideoError(e?.message || \"Couldn't join video.\")"), true);
});

test("mobile encounter does not present unsent chat as sent", () => {
  const page = source();

  assert.equal(page.includes("const [chatError, setChatError]"), true);
  assert.equal(page.includes("if (!sockRef.current?.connected) throw new Error(\"Chat isn't connected yet.\");"), true);
  assert.equal(page.includes("setChatError(e?.message || \"Couldn't send message.\")"), true);
  assert.equal(page.includes("Message not sent"), true);
  assert.equal(page.includes("} catch {}\n    setMessages((prev) => [...prev, { id: String(Date.now()), from: 'You', text: draft.trim() }]);"), false);
  assert.equal(page.includes("if (!sockRef.current) throw new Error(\"Chat isn't connected yet.\");"), false);
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

test("profile settings rows open a settings sheet instead of acting dead", () => {
  const page = profileSource();

  assert.equal(page.includes("selectedSetting"), true);
  assert.equal(page.includes("onPress={() => setSelectedSetting(setting)}"), true);
  assert.equal(page.includes("<Text style={styles.settingsSheetTitle}>{selectedSetting?.label}</Text>"), true);
  assert.equal(page.includes("<TouchableOpacity key={label} style={styles.settingsRow}>"), false);
});

test("mobile profile account toggles persist across remounts", () => {
  const page = profileSource();

  assert.equal(page.includes("const PROFILE_SETTINGS_STORAGE_KEY = 'giggle.mobile.profile.settings';"), true);
  assert.equal(page.includes("function loadProfileSettings()"), true);
  assert.equal(page.includes("function saveProfileSetting(key: keyof ProfileSettings, value: boolean)"), true);
  assert.equal(page.includes("useState(() => loadProfileSettings())"), true);
  assert.equal(page.includes("onValueChange={(value) => setProfileSetting(key, value)}"), true);
  assert.equal(page.includes("localStorage.setItem(PROFILE_SETTINGS_STORAGE_KEY"), true);
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
});

test("mobile profile does not show fabricated performance stats", () => {
  const page = profileSource();

  assert.equal(page.includes("Encounters', val: 47"), false);
  assert.equal(page.includes("Wins', val: 42"), false);
  assert.equal(page.includes("Losses', val: 8"), false);
  assert.equal(page.includes("Rating', val: '4.9'"), false);
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
  assert.equal(page.includes("PROFILE STATUS"), true);
});

test("mobile profile premium upsell does not advertise unbuilt priority or HD features", () => {
  const page = profileSource();

  assert.equal(page.includes("radar boost"), false);
  assert.equal(page.includes("HD video"), false);
  assert.equal(page.includes("priority"), false);
});

test("mobile matchmaking does not upsell unbuilt fast pass priority", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("Fast Pass"), false);
  assert.equal(page.includes("skip the line"), false);
  assert.equal(page.includes("router.push('/premium')"), false);
});

test("mobile matchmaking does not claim fake nearby counts or wait times", () => {
  const page = matchmakingSource();

  assert.equal(page.includes("4 squads nearby"), false);
  assert.equal(page.includes("~30s avg wait"), false);
  assert.equal(page.includes("Queue open"), true);
  assert.equal(page.includes("Live signal"), true);
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

test("mobile lobby ready toggle surfaces backend failures", () => {
  const page = lobbySource();

  assert.equal(page.includes("setMatchError(e?.message || \"Couldn't update ready status.\")"), true);
  assert.equal(page.includes("try { await api.setReady(squadId, !myMember.ready); await refetch(); } catch {}"), false);
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
