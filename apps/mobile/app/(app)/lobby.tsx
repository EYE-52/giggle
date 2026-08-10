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
import type { VideoClient } from '@giggle/agora';
import { NATIVE_DISCOVERY_ENABLED } from '../../constants/discovery';

const CURATED_VIBES = ['Gaming', 'Music', 'Chill', 'Comedy', 'Deep Talks', 'Late Night', 'Sports', 'Art', 'Study', 'Hype', 'Fitness', 'Foodies'];

const TILE_GAP = 10;

export default function LobbyScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ squad?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;

  const [squad, setSquad] = useState<SquadState | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [vibeModalVisible, setVibeModalVisible] = useState(false);
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoJoining, setVideoJoining] = useState(false);
  const [stageHeight, setStageHeight] = useState(0);
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
      setIsPrivate(s.visibility !== 'open');
    } catch (e: any) {
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
      cleanupSocket = () => { sock.off(SOCKET_EVENTS.SQUAD_UPDATED, onUpdate); };
    } catch {}

    return () => {
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
      setMicOn(true);
      setCamOn(true);
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
  const visibilityValue = isPrivate ? 'Private' : 'Open';
  const gridWidth = Math.min(width, 760);
  const tileCount = Math.max(displayMembers.length, 1);
  const tileCols = width < 600
    ? (tileCount <= 2 ? 1 : 2)
    : (tileCount <= 2 ? tileCount : tileCount <= 4 ? 2 : 3);
  const tileRows = Math.ceil(tileCount / tileCols);
  const tileW = (gridWidth - SPACE.lg * 2 - TILE_GAP * (tileCols - 1)) / tileCols;
  const usableStageHeight = Math.max(140, stageHeight - SPACE.lg * 2);
  const tileH = Math.max(140, (usableStageHeight - TILE_GAP * (tileRows - 1)) / tileRows);

  return (
    <Screen style={styles.screen}>
      {/* ── Slim calling-style header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.squadName} numberOfLines={1}>{squad?.squadName ?? 'Squad'}</Text>
          <View style={styles.headerMeta}>
            <View style={styles.codeChip}>
              <Text style={styles.codeText}>{squad?.squadCode ?? '—'}</Text>
            </View>
            {isLeader ? (
              <TouchableOpacity
                onPress={() => { setSelectedVibes(squad?.tags ?? []); setVibeModalVisible(true); }}
                style={styles.vibePreview}
                accessibilityRole="button"
                accessibilityLabel="Edit vibes"
              >
                <Text style={styles.vibePreviewText} numberOfLines={1}>
                  {currentVibes.length ? currentVibes.slice(0, 2).join(' · ') : '+ Vibes'}
                </Text>
              </TouchableOpacity>
            ) : currentVibes.length > 0 ? (
              <View style={styles.vibePreview}>
                <Text style={styles.vibePreviewText} numberOfLines={1}>{currentVibes.slice(0, 2).join(' · ')}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => void shareInvite()}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Invite friends"
          >
            <Text style={styles.headerBtnText}>Invite</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={leave}
            disabled={leaving}
            style={[styles.headerBtn, styles.headerBtnRed, leaving && styles.headerBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Leave squad"
            accessibilityState={{ disabled: leaving, busy: leaving }}
          >
            <Text style={styles.headerBtnTextRed}>{leaving ? 'Leaving…' : 'Leave'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Ready count pill ── */}
      <View style={styles.readyBar}>
        <Text style={styles.readyBarText}>
          {allReadyCount}/{displayMembers.length} ready
        </Text>
        {isLeader ? (
          <View style={styles.visibilityRow}>
            <Text style={styles.visibilityLabel}>Private</Text>
            <SwitchControl
              label="Private squad"
              value={isPrivate}
              onValueChange={handlePrivacyToggle}
            />
          </View>
        ) : (
          <View style={styles.visibilityPill} accessibilityLabel="Only leaders can change squad privacy">
            <Text style={styles.visibilityPillText}>{visibilityValue}</Text>
          </View>
        )}
      </View>
      {matchError ? (
        <View style={styles.matchError}>
          <Text style={styles.matchErrorText}>{matchError}</Text>
        </View>
      ) : null}
      {videoError ? (
        <View style={styles.videoError}>
          <Text style={styles.videoErrorTitle}>Video unavailable</Text>
          <Text style={styles.videoErrorText}>{videoError}</Text>
        </View>
      ) : null}

      {/* ── People-only video stage ── */}
      <ScrollView
        style={styles.gridScroll}
        contentContainerStyle={styles.gridContent}
        showsVerticalScrollIndicator={false}
        onLayout={({ nativeEvent }) => setStageHeight(nativeEvent.layout.height)}
      >
        {displayMembers.length === 0 ? (
          <View style={styles.squadState}>
            <Text style={styles.squadStateTitle}>Lobby empty</Text>
            <Text style={styles.squadStateText}>Invite someone to start this lobby.</Text>
          </View>
        ) : (
        <View style={styles.grid}>
          {displayMembers.map((m, i) => {
            const isLead = squad?.leaderMemberId === m.memberId || (members.length === 0 && i === 0);
            const isMe = m.userId === myUserId;
            const displayLabel = isMe ? `${m.displayName} (You)` : m.displayName;
            return (
              <View key={m.memberId} style={[styles.tile, { width: tileW, height: tileH }]}>
                <View style={styles.tileInner}>
                  {isMe && camOn && videoReady ? (
                    <RtcSurface style={styles.tileVideo} canvas={{ uid: 0 }} />
                  ) : (
                    <Avatar name={m.displayName} size={tileCount === 1 ? 72 : 44} colorIndex={i} />
                  )}
                </View>

                {/* Name pill at bottom */}
                <View style={styles.namePill}>
                  <Text style={styles.namePillText} numberOfLines={1}>{displayLabel}</Text>
                  {isLead && <View style={styles.leadDot}><Text style={styles.leadDotText}>LEAD</Text></View>}
                </View>

                {/* Mic/cam indicators top-right */}
                <View style={styles.indicators}>
                  <View style={[styles.indDot, m.inLobbyVideo ? styles.indGreen : styles.indRed]}>
                    <Icon.mic size={9} color="#fff" />
                  </View>
                </View>

                {/* Ready badge top-left */}
                {m.ready && (
                  <View style={styles.readyBadge}>
                    <Text style={styles.readyBadgeText}>✓</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
        )}
      </ScrollView>

      {/* ── Vibe Edit Modal ── */}
      <Modal visible={vibeModalVisible} transparent animationType="slide" onRequestClose={() => setVibeModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Edit Vibes</Text>
            <Text style={styles.modalSub}>Choose up to 5 vibes for your squad</Text>
            <View style={styles.modalChips}>
              {CURATED_VIBES.map((v) => {
                const active = selectedVibes.includes(v);
                return (
                  <TouchableOpacity
                    key={v}
                    onPress={() => toggleVibeSelection(v)}
                    style={[styles.modalChip, active && styles.modalChipActive]}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.modalChipText, active && styles.modalChipTextActive]}>{v}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.modalCount}>{selectedVibes.length}/5 selected</Text>
            <Button label="Save" onPress={saveVibes} variant="violet" style={{ marginBottom: SPACE.md }} />
            <Button label="Cancel" onPress={() => setVibeModalVisible(false)} variant="outline" />
          </View>
        </View>
      </Modal>

      {/* ── Bottom control row (round buttons) ── */}
      <View style={styles.dock}>
        <View style={styles.mediaReadyRow}>
          {videoReady ? (
            <>
              {/* Mic */}
              <View style={styles.ctrlWrap}>
                <TouchableOpacity
                  onPress={handleMicToggle}
                  style={[styles.ctrlBtn, !micOn && styles.ctrlBtnOff]}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={micOn ? 'Mute microphone' : 'Unmute microphone'}
                >
                  <Icon.mic size={20} color={micOn ? COLORS.text : COLORS.coral} />
                </TouchableOpacity>
                <Text style={styles.ctrlLabel}>{micOn ? 'Mic' : 'Muted'}</Text>
              </View>

              {/* Cam */}
              <View style={styles.ctrlWrap}>
                <TouchableOpacity
                  onPress={handleCamToggle}
                  style={[styles.ctrlBtn, !camOn && styles.ctrlBtnOff]}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={camOn ? 'Turn camera off' : 'Turn camera on'}
                >
                  <Icon.cam size={20} color={camOn ? COLORS.text : COLORS.coral} />
                </TouchableOpacity>
                <Text style={styles.ctrlLabel}>{camOn ? 'Cam' : 'Off'}</Text>
              </View>
            </>
          ) : (
            <View style={styles.ctrlWrap}>
              <TouchableOpacity
                onPress={() => void startVideo()}
                style={[styles.ctrlBtn, styles.ctrlBtnFind, videoJoining && styles.ctrlBtnDisabled]}
                activeOpacity={0.75}
                disabled={videoJoining}
                accessibilityRole="button"
                accessibilityLabel="Enable camera and microphone"
              >
                {videoJoining
                  ? <Text style={styles.ctrlBtnInnerText}>…</Text>
                  : <Icon.cam size={20} color="#fff" />
                }
              </TouchableOpacity>
              <Text style={styles.ctrlLabel}>{videoJoining ? 'Enabling…' : 'Enable video'}</Text>
            </View>
          )}

          {/* Ready — everyone, including leader */}
          <View style={styles.ctrlWrap}>
            <TouchableOpacity
              onPress={toggleReady}
              style={[styles.ctrlBtn, myMember?.ready && styles.ctrlBtnReady, (!myMember || readying) && styles.ctrlBtnDisabled]}
              activeOpacity={0.75}
              disabled={!myMember || readying}
              accessibilityRole="button"
              accessibilityLabel={myMember?.ready ? 'Mark not ready' : 'Mark ready'}
            >
              {readying
                ? <Text style={styles.ctrlBtnInnerText}>…</Text>
                : <Icon.check size={20} color={myMember?.ready ? COLORS.lime : COLORS.text} />
              }
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{myMember?.ready ? 'Ready ✓' : 'Ready'}</Text>
          </View>

        </View>
        {/* Find a Match — leader only */}
        {NATIVE_DISCOVERY_ENABLED && isLeader && (
          <View style={styles.matchActionRow}>
            <Button
              label={finding ? 'Finding…' : 'Find a match'}
              onPress={findMatch}
              disabled={!everyoneReady || !everyoneInVideo || finding}
              style={styles.matchButton}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // ── Slim header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerLeft: { flex: 1, marginRight: SPACE.sm },
  squadName: { fontSize: 17, fontWeight: '700', color: COLORS.text, letterSpacing: -0.3 },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  codeChip: {
    backgroundColor: COLORS.limeSoft,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.lime,
  },
  codeText: { fontFamily: 'monospace', fontSize: 12, fontWeight: '700', color: COLORS.lime, letterSpacing: 1.5 },
  vibePreview: {
    backgroundColor: COLORS.violetSoft,
    borderRadius: 999,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.violet,
    maxWidth: 120,
  },
  vibePreviewText: { fontSize: 11, color: COLORS.violet, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: COLORS.violetSoft,
    borderWidth: 1,
    borderColor: COLORS.violet,
  },
  headerBtnText: { color: COLORS.violet, fontWeight: '600', fontSize: 12 },
  headerBtnRed: {
    backgroundColor: COLORS.coralSoft,
    borderColor: COLORS.coral,
  },
  headerBtnDisabled: { opacity: 0.5 },
  headerBtnTextRed: { color: COLORS.coral, fontWeight: '600', fontSize: 12 },

  // ── Ready bar ──
  readyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  readyBarText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },
  visibilityRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  visibilityLabel: { fontSize: 12, color: COLORS.textDim },
  visibilityPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  visibilityPillText: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700' },
  matchError: {
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,92,92,0.18)',
    backgroundColor: 'rgba(255,92,92,0.08)',
  },
  matchErrorText: { color: COLORS.coral, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  videoError: {
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,92,92,0.18)',
    backgroundColor: 'rgba(255,92,92,0.08)',
  },
  videoErrorTitle: { color: COLORS.coral, fontSize: 12, fontWeight: '900' },
  videoErrorText: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },

  // ── People-only adaptive tile grid ──
  gridScroll: { flex: 1 },
  gridContent: { padding: SPACE.lg, flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },
  squadState: {
    flexGrow: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: SPACE.xl,
  },
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

  tile: {
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  tileInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileVideo: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
  },

  // Name pill — bottom overlay
  namePill: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  namePillText: { fontSize: 11, fontWeight: '700', color: '#fff', flex: 1 },
  leadDot: {
    backgroundColor: COLORS.lime,
    borderRadius: 4,
    paddingVertical: 1,
    paddingHorizontal: 5,
  },
  leadDotText: { fontSize: 8, fontWeight: '800', color: '#0B0B0F', letterSpacing: 0.3 },

  // Mic indicator
  indicators: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4 },
  indDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  indGreen: { backgroundColor: 'rgba(34,197,94,0.8)' },
  indRed: { backgroundColor: 'rgba(255,92,92,0.7)' },

  // Ready badge
  readyBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(194,255,61,0.85)',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  readyBadgeText: { fontSize: 10, fontWeight: '800', color: '#0B0B0F' },

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
  modalChipTextActive: { color: COLORS.violet },
  modalCount: { color: COLORS.textDim, fontSize: 13, marginBottom: SPACE.lg, textAlign: 'center' },

  // ── Bottom control dock ──
  dock: {
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.lg,
    paddingTop: SPACE.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  mediaReadyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: SPACE.xl,
  },
  matchActionRow: { width: '100%', marginTop: SPACE.md },
  matchButton: { width: '100%' },
  ctrlWrap: { alignItems: 'center', gap: 5, minWidth: 56 },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnOff: { backgroundColor: COLORS.coralSoft, borderColor: COLORS.coral },
  ctrlBtnReady: { backgroundColor: COLORS.limeSoft, borderColor: COLORS.lime },
  ctrlBtnFind: { backgroundColor: COLORS.violet, borderColor: COLORS.violet },
  ctrlBtnDisabled: { opacity: 0.45 },
  ctrlBtnInnerText: { fontSize: 18, color: COLORS.text, fontWeight: '700' },
  ctrlLabel: { fontSize: 10, color: COLORS.textDim, fontWeight: '600', textAlign: 'center' },
});
