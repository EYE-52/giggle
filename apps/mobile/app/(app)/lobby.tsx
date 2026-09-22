import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, Share, useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { RtcSurface } from '../../components/RtcSurface';
import { SwitchControl } from '../../components/SwitchControl';
import { COLORS, SPACE, RADII } from '../../constants/theme';
import { api, session, connectSocket, SOCKET_EVENTS } from '@giggle/core';
import type { SquadState } from '@giggle/core';
import { createVideoClient } from '@giggle/agora';
import { LobbyChat } from '../../components/LobbyChat';
import { Wordmark } from '../../components/Wordmark';
import type { VideoClient, RemoteParticipant } from '@giggle/agora';
import { NATIVE_DISCOVERY_ENABLED } from '../../constants/discovery';

const CURATED_VIBES = ['Gaming', 'Music', 'Chill', 'Comedy', 'Deep Talks', 'Late Night', 'Sports', 'Art', 'Study', 'Hype', 'Fitness', 'Foodies'];


export default function LobbyScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ squad?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const remoteUnsub = useRef<(() => void) | null>(null);
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [vibeModalVisible, setVibeModalVisible] = useState(false);
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoJoining, setVideoJoining] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [squadError, setSquadError] = useState('');
  const [readying, setReadying] = useState(false);
  const [finding, setFinding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [matchError, setMatchError] = useState('');
  const vcRef = useRef<VideoClient | null>(null);
  const videoAttemptRef = useRef(0);
  const videoPresenceRef = useRef(false);
  const leavingRef = useRef(false);

  const myUserId = session.user?.id;

  const refetch = useCallback(async () => {
    if (!squadId) return;
    setSquadError('');
    try {
      const s = await api.getSquad(squadId);
      setSquad(s);
      if (NATIVE_DISCOVERY_ENABLED && ["searching", "matched", "in_encounter"].includes(s.status)) router.replace(`/matchmaking?squad=${squadId}`);
      setIsPrivate(s.visibility !== 'open');
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 404) { router.replace("/home"); return; }
      setSquadError(e?.message || "Couldn't load this squad.");
    }
  }, [squadId]);

  useEffect(() => {
    refetch();
    if (!squadId) return;

    let cleanupSocket: (() => void) | undefined;

    try {
      const sock = connectSocket(squadId);
      const onUpdate = (update: { memberId?: string; ready?: boolean } = {}) => {
        const { memberId, ready } = update;
        if (memberId && typeof ready === 'boolean') {
          setSquad((current) => current ? {
            ...current,
            members: current.members.map((member) =>
              member.memberId === memberId ? { ...member, ready } : member
            ),
          } : current);
          return;
        }
        void refetch();
      };
      sock.on(SOCKET_EVENTS.SQUAD_UPDATED, onUpdate);
      sock.on(SOCKET_EVENTS.MATCH_FOUND, onUpdate);
      cleanupSocket = () => { sock.off(SOCKET_EVENTS.SQUAD_UPDATED, onUpdate); sock.off(SOCKET_EVENTS.MATCH_FOUND, onUpdate); };
    } catch {}

    const poll = setInterval(refetch, 3000);
    return () => {
      clearInterval(poll);
      remoteUnsub.current?.();
      cleanupSocket?.();
      videoAttemptRef.current += 1;
      try { void vcRef.current?.leave(); } catch {}
      vcRef.current = null;
      if (videoPresenceRef.current) {
        videoPresenceRef.current = false;
        void api.setLobbyVideo(squadId, false).catch(() => {});
      }
    };
  }, [squadId, refetch]);

  const members = squad?.members ?? [];
  const myMember = members.find((m) => m.userId === myUserId);
  const isLeader = squad ? squad.leaderMemberId === myMember?.memberId : false;

  const displayMembers = members;
  const activeMembers = displayMembers.filter((member) => member.online !== false);
  const everyoneReady = activeMembers.length > 0 && activeMembers.every((member) => member.ready);
  const everyoneInVideo = activeMembers.length > 0 && activeMembers.every((member) =>
    member.userId === myUserId ? videoReady || member.inLobbyVideo : member.inLobbyVideo
  );

  async function startVideo() {
    if (!squadId || videoJoining || videoReady || leavingRef.current) return;
    const attempt = ++videoAttemptRef.current;
    let vc: VideoClient | null = null;
    setVideoJoining(true);
    setVideoError('');
    try {
      const token = await api.lobbyToken(squadId);
      if (attempt !== videoAttemptRef.current) return;
      vc = createVideoClient();
      vcRef.current = vc;
      remoteUnsub.current?.();
      const offRemote = vc.onRemoteChange(setRemotes);
      const offCapture = vc.onCaptureState?.(state => {
        if (attempt !== videoAttemptRef.current) return;
        setMicOn(state.audio === 'active');
        setCamOn(state.video === 'active');
      });
      remoteUnsub.current = () => { offRemote(); offCapture?.(); };
      await vc.join(token, { audio: true, video: true });
      if (attempt !== videoAttemptRef.current) {
        await vc.leave();
        return;
      }
      await api.setLobbyVideo(squadId, true);
      if (attempt !== videoAttemptRef.current) {
        await api.setLobbyVideo(squadId, false).catch(() => {});
        await vc.leave();
        return;
      }
      videoPresenceRef.current = true;
      setVideoReady(true);
    } catch (e: any) {
      if (attempt !== videoAttemptRef.current) return;
      try { await vc?.leave(); } catch {}
      vcRef.current = null;
      setVideoReady(false);
      setVideoError(e?.message || "Couldn't join lobby video.");
    } finally {
      if (attempt === videoAttemptRef.current) setVideoJoining(false);
    }
  }

  async function handleMicToggle() {
    const previous = micOn;
    const next = !micOn;
    setMicOn(next);
    setVideoError('');
    try {
      if (!vcRef.current) throw new Error("Lobby video isn't connected yet.");
      await vcRef.current.setMicEnabled(next);
    } catch (e: any) {
      setMicOn(previous);
      setVideoError(e?.message || "Couldn't update microphone.");
    }
  }

  async function handleCamToggle() {
    const previous = camOn;
    const next = !camOn;
    setCamOn(next);
    setVideoError('');
    try {
      if (!vcRef.current) throw new Error("Lobby video isn't connected yet.");
      await vcRef.current.setCamEnabled(next);
    } catch (e: any) {
      setCamOn(previous);
      setVideoError(e?.message || "Couldn't update camera.");
    }
  }

  async function handlePrivacyToggle(next: boolean) {
    if (!squadId) return;
    const previous = isPrivate;
    setIsPrivate(next);
    setMatchError('');
    try {
      await api.setSquadVisibility(squadId, next ? 'private' : 'open');
      await refetch();
    } catch (e: any) {
      setIsPrivate(previous);
      setMatchError(e?.message || "Couldn't update squad privacy.");
    }
  }

  async function toggleReady() {
    if (!squadId || !myMember || readying) return;
    const previousReady = myMember.ready;
    const nextReady = !previousReady;
    const setLocalReady = (ready: boolean) => setSquad((current) => current ? {
      ...current,
      members: current.members.map((member) => member.memberId === myMember.memberId ? { ...member, ready } : member),
    } : current);
    setReadying(true);
    setMatchError('');
    setLocalReady(nextReady);
    try {
      await api.setReady(squadId, nextReady);
    } catch (e: any) {
      setLocalReady(previousReady);
      setMatchError(e?.message || "Couldn't update ready status.");
    } finally {
      setReadying(false);
    }
  }

  async function findMatch() {
    if (!squadId || finding) return;
    if (!NATIVE_DISCOVERY_ENABLED) {
      setMatchError('Stranger discovery is unavailable.');
      return;
    }
    if (!everyoneReady) {
      setMatchError('Everyone online needs to be ready before you find a match.');
      return;
    }
    if (!everyoneInVideo) {
      setMatchError('Everyone online needs to join lobby video before you find a match.');
      return;
    }
    setFinding(true);
    setMatchError('');
    try {
      await api.startSearch(squadId);
      router.replace(`/matchmaking?squad=${squadId}`);
    } catch (e: any) {
      setMatchError(e?.message || "Couldn't start search yet.");
    } finally {
      setFinding(false);
    }
  }

  async function saveVibes() {
    if (squadId) {
      setMatchError('');
      try {
        await api.setTags(squadId, selectedVibes);
        await refetch();
      } catch (e: any) {
        setMatchError(e?.message || "Couldn't save vibes.");
        return;
      }
    }
    setVibeModalVisible(false);
  }

  function toggleVibeSelection(v: string) {
    setSelectedVibes((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : prev.length < 5 ? [...prev, v] : prev
    );
  }

  async function leave() {
    if (!squadId) {
      router.replace('/home');
      return;
    }
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    setMatchError('');
    setVideoError('');

    videoAttemptRef.current += 1;
    const client = vcRef.current;
    vcRef.current = null;
    const hadVideoPresence = videoPresenceRef.current;
    videoPresenceRef.current = false;
    setVideoReady(false);
    setVideoJoining(false);
    setMicOn(false);
    setCamOn(false);
    try { if (client) void client.leave().catch(() => {}); } catch {}
    if (hadVideoPresence) void api.setLobbyVideo(squadId, false).catch(() => {});

    try {
      await api.leaveSquad(squadId);
      router.replace('/home');
    } catch (e: any) {
      leavingRef.current = false;
      setLeaving(false);
      setMatchError(e?.message || "Couldn't leave squad.");
    }
  }

  async function shareInvite() {
    if (!squad?.squadCode) return;
    setMatchError('');
    try {
      await Share.share({ message: `Join my Giggle squad with code ${squad.squadCode}.` });
    } catch {
      setMatchError("Couldn't open sharing. Please try again.");
    }
  }

  if (!squadId) {
    return (
      <Screen>
        <View style={styles.missingState}>
          <Text style={styles.squadStateTitle}>No squad selected</Text>
          <Text style={styles.squadStateText}>Open a squad from Home before entering its lobby.</Text>
          <View style={styles.missingActions}>
            <Button label="Back to home" onPress={() => router.replace('/home')} style={styles.missingButton} />
          </View>
        </View>
      </Screen>
    );
  }

  if (!squad) {
    return (
      <Screen>
        <View style={styles.missingState}>
          <Text style={styles.squadStateTitle}>{squadError ? 'Squad unavailable' : 'Loading squad'}</Text>
          <Text style={styles.squadStateText}>
            {squadError || 'Pulling in the real squad roster before opening the lobby.'}
          </Text>
          {squadError ? (
            <View style={styles.missingActions}>
              <Button label="Try again" onPress={() => void refetch()} style={styles.missingButton} />
              <Button label="Back to home" onPress={() => router.replace('/home')} variant="outline" style={styles.missingButton} />
            </View>
          ) : null}
        </View>
      </Screen>
    );
  }

  const currentVibes = squad?.tags ?? selectedVibes;
  const allReadyCount = displayMembers.filter((m) => m.ready).length;
  const cardWidth = Math.min((width - 44) / 2, 300);
  return (
    <Screen style={styles.screen}>
      <ScrollView style={{ display: chatVisible ? "none" : "flex" }} contentContainerStyle={roomStyles.page} keyboardShouldPersistTaps="handled">
        <View style={roomStyles.nav}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back home" onPress={() => router.replace('/home')}><Wordmark size={25} /></TouchableOpacity><Button label="Settings" variant="outline" onPress={() => setSettingsVisible(true)} /></View>
        <Text style={roomStyles.title}>{squad.squadName}</Text>
        <Text style={roomStyles.copy}>Invite friends and check your camera before joining a call.</Text>
        {matchError || squadError ? <Text accessibilityRole="alert" style={roomStyles.error}>{matchError || squadError}</Text> : null}
        <View style={roomStyles.grid}>{displayMembers.map((member, index) => {
          const isMe = member.userId === myUserId;
          const remote = remotes.find(person => String(person.uid) === String(member.uid));
          return <View key={member.memberId} style={[roomStyles.tile, { width: cardWidth, height: cardWidth }]}>
            {isMe && camOn && videoReady ? <RtcSurface style={styles.tileVideo} canvas={{ uid: 0 }} /> : !isMe && remote?.hasVideo && member.uid !== undefined ? <RtcSurface style={styles.tileVideo} canvas={{ uid: member.uid }} /> : <><Avatar name={member.displayName} size={56} colorIndex={index} /><Text style={roomStyles.cameraOff}>{member.online === false && !isMe ? 'Offline' : 'Camera off'}</Text></>}
            <View style={roomStyles.nameRow}><Text style={roomStyles.name} numberOfLines={1}>{isMe ? 'You' : member.displayName}</Text><Text style={roomStyles.ready}>{member.ready ? 'Ready' : member.memberId === squad.leaderMemberId ? 'Leader' : ''}</Text></View>
          </View>;
        })}{displayMembers.length < (squad.maxSlots ?? 4) && <TouchableOpacity style={[roomStyles.empty, { width: cardWidth, height: cardWidth }]} accessibilityRole="button" accessibilityLabel="Invite a friend" onPress={() => void shareInvite()}><Icon.plus size={28} color={COLORS.textMuted} /><Text style={roomStyles.copy}>Invite a friend</Text></TouchableOpacity>}</View>
        <View style={roomStyles.controls}>{videoReady ? <><Button label={micOn ? 'Mic on' : 'Mic off'} variant="outline" onPress={handleMicToggle} /><Button label={camOn ? 'Camera on' : 'Camera off'} variant="outline" onPress={handleCamToggle} /></> : <Button label={videoJoining ? 'Connecting…' : 'Enable camera & mic'} accessibilityLabel="Enable camera and microphone" disabled={videoJoining} variant="outline" onPress={() => void startVideo()} />}<Button label="Chat" variant="outline" onPress={() => setChatVisible(true)} /></View>
        {videoError ? <Text accessibilityRole="alert" style={roomStyles.error}>{videoError}</Text> : null}
        <View style={roomStyles.details}><View style={roomStyles.nav}><Text style={roomStyles.subtitle}>Your squad</Text><Text style={roomStyles.copy}>{displayMembers.length} / {squad.maxSlots ?? 4}</Text></View><View style={roomStyles.code}><Text style={roomStyles.codeText}>{squad.squadCode}</Text><Button label="Share invite" variant="outline" onPress={() => void shareInvite()} /></View>
          <View style={roomStyles.nav}><Text style={roomStyles.copy}>{currentVibes.length ? currentVibes.join(' · ') : 'No interests added'}</Text>{isLeader && <Button label="Edit interests" variant="outline" onPress={() => { setSelectedVibes(squad.tags ?? []); setVibeModalVisible(true); }} />}</View>
          <Text style={roomStyles.copy}>{displayMembers.length === 1 ? 'Invite friends or join a call on your own.' : `${allReadyCount} of ${displayMembers.length} ready`}</Text>
          <Button label={readying ? 'Saving…' : myMember?.ready ? 'Not ready' : "I'm ready"} variant={myMember?.ready ? 'outline' : 'violet'} disabled={readying} onPress={toggleReady} />
          {NATIVE_DISCOVERY_ENABLED && isLeader && <Button label={finding ? 'Finding…' : 'Find a squad'} disabled={!everyoneReady || finding} onPress={findMatch} />}
          <Text style={roomStyles.copy}>{isLeader ? everyoneReady ? 'Connect your devices before starting a call.' : 'Everyone online needs to mark ready first.' : 'Your squad leader starts the search when everyone is ready.'}</Text>
        </View>
      </ScrollView>
      <View style={{ flex: 1, display: chatVisible ? "flex" : "none" }}><LobbyChat squadId={squadId} onClose={() => setChatVisible(false)} /></View>
      <Modal visible={settingsVisible || leaveConfirm} transparent animationType="fade" onRequestClose={() => { if (!leaving) { setSettingsVisible(false); setLeaveConfirm(false); } }}>
        <View style={styles.modalOverlay}><View accessibilityViewIsModal style={styles.modalSheet}>
          {leaveConfirm ? <View style={{ gap: 16 }}>
            <Text style={styles.modalTitle}>Leave this squad?</Text>
            <Text style={styles.modalSub}>{isLeader ? displayMembers.length > 1 ? 'Leadership will pass to another member.' : 'You are the only member. Leaving will close the squad.' : 'The rest of your squad can keep talking.'}</Text>
            {matchError ? <Text accessibilityRole="alert" style={roomStyles.error}>{matchError}</Text> : null}
            <Button label={leaving ? 'Leaving…' : 'Confirm leave squad'} disabled={leaving} onPress={leave} />
            <Button label="Keep talking" variant="outline" disabled={leaving} onPress={() => { setLeaveConfirm(false); setSettingsVisible(false); }} />
          </View> : <ScrollView contentContainerStyle={{ gap: 16 }}>
            <Text style={styles.modalTitle}>Squad settings</Text>
            {matchError ? <Text accessibilityRole="alert" style={roomStyles.error}>{matchError}</Text> : null}
            <View style={roomStyles.nav}><Text style={roomStyles.copy}>Private squad</Text><SwitchControl label="Private squad" value={isPrivate} disabled={!isLeader} onValueChange={handlePrivacyToggle} /></View>
            {!isLeader && <Text style={roomStyles.copy}>Only the leader can change privacy.</Text>}
            {displayMembers.map(member => <Text key={member.memberId} style={roomStyles.copy}>{member.displayName}{member.memberId === squad.leaderMemberId ? ' · Leader' : ''}</Text>)}
            <Button label="Leave squad" variant="coral" onPress={() => setLeaveConfirm(true)} />
            <Button label="Close settings" variant="outline" onPress={() => setSettingsVisible(false)} />
          </ScrollView>}
        </View></View>
      </Modal>
      <Modal visible={vibeModalVisible} transparent animationType="fade" onRequestClose={() => setVibeModalVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalSheet}><ScrollView contentContainerStyle={{ gap: 14 }}><Text style={styles.modalTitle}>Edit interests</Text><Text style={styles.modalSub}>Choose up to five.</Text>{matchError ? <Text accessibilityRole="alert" style={roomStyles.error}>{matchError}</Text> : null}<View style={styles.modalChips}>{CURATED_VIBES.map(interest => <TouchableOpacity key={interest} accessibilityRole="button" accessibilityState={{ selected: selectedVibes.includes(interest) }} style={[styles.modalChip, selectedVibes.includes(interest) && styles.modalChipActive]} onPress={() => toggleVibeSelection(interest)}><Text style={styles.modalChipText}>{interest}</Text></TouchableOpacity>)}</View><Button label="Save interests" onPress={saveVibes} /><Button label="Cancel" variant="outline" onPress={() => setVibeModalVisible(false)} /></ScrollView></View></View></Modal>
    </Screen>
  );
}

const roomStyles = StyleSheet.create({
  page: { padding: 16, gap: 18, width: '100%', maxWidth: 720, alignSelf: 'center' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 30, color: COLORS.text, fontWeight: '700', letterSpacing: -1 },
  subtitle: { fontSize: 19, color: COLORS.text, fontWeight: '700' },
  copy: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  tile: { backgroundColor: '#33312e', borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 10 },
  empty: { backgroundColor: '#e8ece1', borderColor: '#a6b19b', borderStyle: 'dashed', borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 12 },
  nameRow: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { color: '#fff', fontSize: 12, flexShrink: 1 },
  ready: { color: '#d3deca', fontSize: 11 },
  cameraOff: { color: '#c0bbb2', fontSize: 11 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  details: { padding: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, borderRadius: 20, gap: 16 },
  code: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  codeText: { fontFamily: 'monospace', letterSpacing: 2, fontWeight: '700', fontSize: 19, color: COLORS.text },
  error: { color: COLORS.coral, fontSize: 13, lineHeight: 19 },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  squadStateTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  squadStateText: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  missingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: SPACE.xl,
  },
  missingActions: { width: '100%', gap: SPACE.sm, marginTop: SPACE.sm },
  missingButton: { width: '100%' },
  tileVideo: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
  },

  // ── Modal ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#16161E',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: SPACE.xl, paddingBottom: SPACE.xxl,
    borderTopWidth: 1, borderColor: COLORS.border,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  modalSub: { fontSize: 14, color: COLORS.textMuted, marginBottom: SPACE.lg },
  modalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACE.md },
  modalChip: {
    minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  modalChipActive: { backgroundColor: 'rgba(124,92,255,0.18)', borderColor: COLORS.violet },
  modalChipText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
});
