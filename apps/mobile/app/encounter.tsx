import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler, View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../components/Screen';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { RtcSurface } from '../components/RtcSurface';
import { COLORS, SPACE, RADII } from '../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import {
  advanceSpeakerFocus,
  api,
  connectSocket,
  createReportOpponentPayload,
  deriveEncounterLayout,
  EMPTY_SPEAKER_FOCUS,
  reportOpponentSquad,
  session,
  SOCKET_EVENTS,
  SOCKET_EMIT,
} from '@giggle/core';
import type { EncounterDetail, EncounterSide } from '@giggle/core';
import { createVideoClient } from '@giggle/agora';
import type { CaptureState, ConnectionState, VideoClient, RemoteParticipant } from '@giggle/agora';

const TILE_COLORS = ['#7C5CFF', '#3DD6C0', '#FF8A5C', '#C2FF3D', '#FF5C8A', '#5C8CFF'];

interface ChatMsg { id: string; from: string; text: string; }
interface EncounterParticipant {
  id: string;
  memberId: string;
  name: string;
  side: EncounterSide;
  colorIndex: number;
  uid?: number;
  isLocal: boolean;
}

const TILE_GAP = 8;
let messageIdCounter = 0;

export default function EncounterScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ squad?: string; enc?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;
  const encId = typeof params.enc === 'string' ? params.enc : undefined;

  const [elapsed, setElapsed] = useState(0);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [enc, setEnc] = useState<EncounterDetail | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [encounterError, setEncounterError] = useState('');
  const [chatError, setChatError] = useState('');
  const [reported, setReported] = useState(false);
  const [connState, setConnState] = useState<ConnectionState | null>(null);
  const [captureState, setCaptureState] = useState<CaptureState>({ audio: 'off', video: 'off' });
  const [loudestUid, setLoudestUid] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [speakerFocus, setSpeakerFocus] = useState(EMPTY_SPEAKER_FOCUS);
  const [stripSide, setStripSide] = useState<EncounterSide>('mine');
  const [selfViewMinimized, setSelfViewMinimized] = useState(false);
  const sockRef = useRef<any>(null);
  const vcRef = useRef<VideoClient | null>(null);
  const myUidRef = useRef<string | number | null>(null);
  const joinChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const videoUnsubsRef = useRef<Array<() => void>>([]);

  function clearVideoListeners() {
    videoUnsubsRef.current.splice(0).forEach((unsubscribe) => {
      try { unsubscribe(); } catch {}
    });
  }

  async function joinVideo(isCancelled: () => boolean = () => false) {
    if (!squadId || !encId) throw new Error('This encounter is unavailable.');
    setVideoReady(false);
    setVideoError('');
    setConnState('CONNECTING');
    setCaptureState({ audio: 'off', video: 'off' });
    setRemotes([]);
    setLoudestUid(null);

    const staleClient = vcRef.current;
    vcRef.current = null;
    clearVideoListeners();
    try { await staleClient?.leave(); } catch {}
    if (isCancelled()) return;

    await api.setEncounterVideo(squadId, true);
    const token = await api.encounterToken(squadId, encId);
    if (isCancelled()) return;

    const vc = createVideoClient();
    vcRef.current = vc;
    myUidRef.current = token.uid;
    videoUnsubsRef.current.push(vc.onRemoteChange((next) => {
      if (vcRef.current === vc) setRemotes(next);
    }));
    const volumeUnsub = vc.onVolumes?.((levels) => {
      if (vcRef.current !== vc) return;
      const loudest = levels.reduce(
        (best, level) => level.level > best.level ? level : best,
        { uid: 0, level: 5 },
      );
      setLoudestUid(loudest.level > 5 ? String(loudest.uid) : null);
    });
    const connectionUnsub = vc.onConnectionState?.((state) => {
      if (vcRef.current !== vc) return;
      setConnState(state);
      if (state === 'DISCONNECTED') setVideoError('Video disconnected. Chat is still available.');
    });
    const captureUnsub = vc.onCaptureState?.((state) => {
      if (vcRef.current === vc) setCaptureState(state);
    });
    if (volumeUnsub) videoUnsubsRef.current.push(volumeUnsub);
    if (connectionUnsub) videoUnsubsRef.current.push(connectionUnsub);
    if (captureUnsub) videoUnsubsRef.current.push(captureUnsub);

    await vc.join(token, { audio: true, video: true });
    if (isCancelled()) {
      if (vcRef.current === vc) vcRef.current = null;
      clearVideoListeners();
      await vc.leave().catch(() => {});
      return;
    }
    setVideoReady(true);
    setConnState('CONNECTED');
  }

  useEffect(() => {
    if (!encId) return;
    let cancelled = false;
    (async () => {
      setEncounterError('');
      try {
        const detail = await api.getEncounter(encId);
        if (!cancelled) setEnc(detail);
      } catch (e: any) {
        if (!cancelled) setEncounterError(e?.message || "Couldn't load this encounter.");
      }
    })();
    if (squadId) {
      joinChainRef.current = joinChainRef.current.catch(() => {}).then(async () => {
        try {
          await joinVideo(() => cancelled);
        } catch (e: any) {
          if (!cancelled) {
            setVideoReady(false);
            setConnState('DISCONNECTED');
            setVideoError(e?.message || "Couldn't join video.");
          }
        }
      });
    }
    let sock: ReturnType<typeof connectSocket> | null = null;
    let onMsg: ((payload: any) => void) | null = null;
    try {
      sock = connectSocket(squadId);
      sockRef.current = sock;
      sock.emit(SOCKET_EMIT.JOIN_ENCOUNTER, encId);
      onMsg = (payload: any) => {
        const id = `${Date.now()}-${messageIdCounter += 1}`;
        setMessages((prev) => [
          ...prev,
          { id, from: payload?.from || payload?.displayName || 'Someone', text: payload?.text || payload?.message || '' },
        ]);
      };
      sock.on(SOCKET_EVENTS.NEW_MESSAGE, onMsg);
    } catch {}
    return () => {
      cancelled = true;
      if (sock && onMsg) sock.off(SOCKET_EVENTS.NEW_MESSAGE, onMsg);
      if (sockRef.current === sock) sockRef.current = null;
      joinChainRef.current = joinChainRef.current.catch(() => {}).then(async () => {
        const staleClient = vcRef.current;
        vcRef.current = null;
        clearVideoListeners();
        try { await staleClient?.leave(); } catch {}
      });
    };
  }, [encId, squadId]);

  useEffect(() => {
    if (connState !== 'CONNECTED') return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [connState]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const mySquad = enc
    ? enc.squadAId === squadId
      ? { id: enc.squadAId, name: enc.squadAName, members: enc.squadAMembers }
      : { id: enc.squadBId, name: enc.squadBName, members: enc.squadBMembers }
    : null;
  const theirSquad = enc
    ? enc.squadAId === squadId
      ? { id: enc.squadBId, name: enc.squadBName, members: enc.squadBMembers }
      : { id: enc.squadAId, name: enc.squadAName, members: enc.squadAMembers }
    : null;
  const myUserId = session.user?.id ?? '';
  const mineParticipants: EncounterParticipant[] = (mySquad?.members ?? []).map((m, index) => ({
    id: m.userId,
    memberId: m.memberId,
    name: m.displayName,
    side: 'mine',
    colorIndex: index,
    uid: m.uid,
    isLocal: m.userId === myUserId || (myUidRef.current != null && String(m.uid) === String(myUidRef.current)),
  }));
  const theirParticipants: EncounterParticipant[] = (theirSquad?.members ?? []).map((m, index) => ({
    id: m.userId,
    memberId: m.memberId,
    name: m.displayName,
    side: 'theirs',
    colorIndex: index + 4,
    uid: m.uid,
    isLocal: false,
  }));
  const participants = [...mineParticipants, ...theirParticipants];
  const participantsKey = JSON.stringify(participants.map((person) => person.id));
  const activeSpeakerId = loudestUid
    ? participants.find((person) => String(person.isLocal ? myUidRef.current : person.uid) === loudestUid)?.id ?? null
    : null;
  const viewportClass = width < 600 ? 'phone' : width < 900 ? 'narrow' : 'wide';
  const layout = deriveEncounterLayout({
    viewport: viewportClass,
    mine: mineParticipants,
    theirs: theirParticipants,
    pinnedId,
    automaticFocusId: speakerFocus.focusedId,
  });

  useEffect(() => {
    if (participants.length < 5) {
      setSpeakerFocus(EMPTY_SPEAKER_FOCUS);
      return;
    }
    const ids = participants.map((person) => person.id);
    const advance = () => setSpeakerFocus((previous) =>
      advanceSpeakerFocus(ids, previous, activeSpeakerId, Date.now()));
    advance();
    const timer = setInterval(advance, 200);
    return () => clearInterval(timer);
    // participantsKey represents roster identity without media-state churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantsKey, participants.length, activeSpeakerId]);

  useEffect(() => {
    if (pinnedId && !participants.some((person) => person.id === pinnedId)) setPinnedId(null);
  }, [pinnedId, participantsKey]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!pinnedId) return false;
      setPinnedId(null);
      return true;
    });
    return () => subscription.remove();
  }, [pinnedId]);

  const participantById = new Map(participants.map((person) => [person.id, person]));
  const remoteFor = (person: EncounterParticipant) =>
    person.uid == null ? undefined : remotes.find((remote) => String(remote.uid) === String(person.uid));

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    setChatError('');
    try {
      if (!sockRef.current?.connected) throw new Error("Chat isn't connected yet.");
      sockRef.current.emit(SOCKET_EMIT.SEND_MESSAGE, { encounterId: encId, squadId, text });
    } catch (e: any) {
      setChatError(e?.message || "Couldn't send message.");
      return;
    }
    setMessages((prev) => [...prev, { id: String(Date.now()), from: 'You', text }]);
    setDraft('');
  }

  async function handleMicToggle() {
    const previous = mic;
    const next = !mic;
    setMic(next);
    setVideoError('');
    try {
      if (!vcRef.current) throw new Error("Video isn't connected yet.");
      await vcRef.current.setMicEnabled(next);
    } catch (e: any) {
      setMic(previous);
      setVideoError(e?.message || "Couldn't update microphone.");
    }
  }

  async function handleCamToggle() {
    const previous = cam;
    const next = !cam;
    setCam(next);
    setVideoError('');
    try {
      if (!vcRef.current) throw new Error("Video isn't connected yet.");
      await vcRef.current.setCamEnabled(next);
    } catch (e: any) {
      setCam(previous);
      setVideoError(e?.message || "Couldn't update camera.");
    }
  }

  const reportPayload = createReportOpponentPayload({ encounterId: encId, squadId, encounter: enc });
  const canReport = Boolean(reportPayload);

  function handleReport() {
    if (reported || !canReport) return;
    const sent = reportOpponentSquad({ encounterId: encId, squadId, encounter: enc });
    if (!sent) return;
    setReported(true);
    setTimeout(() => setReported(false), 2500);
  }

  async function endEncounter() {
    if (squadId && encId) { try { await api.disconnectEncounter(squadId, encId); } catch {} }
    router.push('/home');
  }

  const compactHeader = viewportClass === 'phone' || height < 500;
  const stackSides = viewportClass === 'phone' && height >= width;

  function renderParticipant(id: string | null, fit: 'fit' | 'crop', compact = false) {
    if (!id) return null;
    const person = participantById.get(id);
    if (!person) return null;
    const remote = remoteFor(person);
    const hasVideo = videoReady && (person.isLocal
      ? cam && captureState.video === 'active'
      : person.uid != null && remote?.hasVideo === true);
    const muted = person.isLocal ? !mic : remote?.hasAudio === false;
    const status = person.isLocal
      ? captureState.video === 'denied'
        ? 'Camera permission blocked'
        : captureState.video === 'unavailable'
          ? 'Camera unavailable'
          : !videoReady || captureState.video === 'pending' ? 'Connecting' : 'Camera off'
      : !videoReady || !remote ? 'Connecting' : 'Camera off';
    const color = TILE_COLORS[person.colorIndex % TILE_COLORS.length];
    const speaking = String(person.isLocal ? myUidRef.current : person.uid) === loudestUid;
    const canvas = { uid: person.isLocal ? 0 : person.uid };

    return (
      <TouchableOpacity
        key={person.id}
        activeOpacity={0.9}
        onPress={() => setPinnedId((current) => current === person.id ? null : person.id)}
        accessibilityRole="button"
        accessibilityLabel={`${pinnedId === person.id ? 'Unpin' : 'Pin'} ${person.name}'s video`}
        accessibilityState={{ selected: pinnedId === person.id }}
        style={[
          styles.participantTile,
          compact && styles.participantTileCompact,
          speaking && styles.participantTileSpeaking,
        ]}
      >
        <LinearGradient colors={[color + '52', color + '18']} style={StyleSheet.absoluteFill} />
        {hasVideo ? (
          fit === 'fit' ? (
            <>
              <RtcSurface
                fit="crop"
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, styles.videoBackdrop]}
                canvas={canvas}
              />
              <RtcSurface fit="fit" pointerEvents="none" style={StyleSheet.absoluteFill} canvas={canvas} />
            </>
          ) : (
            <RtcSurface fit="crop" pointerEvents="none" style={StyleSheet.absoluteFill} canvas={canvas} />
          )
        ) : (
          <View style={styles.participantFallback}>
            <Avatar name={person.name} size={compact ? 34 : 58} colorIndex={person.colorIndex} />
            {!compact && <Text style={styles.participantStatus}>{status}</Text>}
          </View>
        )}
        <View style={styles.tileNamePill}>
          <Text style={styles.tileNameText} numberOfLines={1} accessibilityLabel={person.name}>
            {person.name}{person.isLocal ? ' (You)' : ''}
          </Text>
          {muted && (
            <View style={styles.mutedBadge} accessibilityLabel={`${person.name} is muted`}>
              <Icon.mic size={9} color="#fff" />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  function renderStrip(ids: string[]) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filmstrip}
        contentContainerStyle={styles.filmstripContent}
      >
        {ids.map((id) => (
          <View key={id} style={styles.filmstripItem}>
            {renderParticipant(id, 'crop', true)}
          </View>
        ))}
      </ScrollView>
    );
  }

  function renderSideHeader(side: EncounterSide) {
    const squad = side === 'mine' ? mySquad : theirSquad;
    const count = side === 'mine' ? mineParticipants.length : theirParticipants.length;
    return (
      <View style={styles.sideHeader}>
        <Text style={[styles.sideEyebrow, side === 'theirs' && styles.sideEyebrowTheirs]}>
          {side === 'mine' ? 'Yours' : 'Theirs'} · {count}
        </Text>
        <Text style={styles.sideName} numberOfLines={1} accessibilityLabel={squad?.name}>
          {squad?.name}
        </Text>
      </View>
    );
  }

  function renderSquadRegion(side: EncounterSide, ids: string[]) {
    return (
      <View style={styles.squadRegion}>
        {renderSideHeader(side)}
        <View style={styles.squadTiles}>{ids.map((id) => renderParticipant(id, 'crop'))}</View>
      </View>
    );
  }

  function renderFeaturedSide(side: EncounterSide, primaryId: string | null, stripIds: string[]) {
    return (
      <View style={styles.featuredSide}>
        {renderSideHeader(side)}
        <View style={styles.primarySlot}>{renderParticipant(primaryId, 'fit')}</View>
        {stripIds.length > 0 && renderStrip(stripIds)}
      </View>
    );
  }

  function renderFocusedStage(withSegmentedStrip: boolean) {
    const localId = participants.find((person) => person.isLocal)?.id ?? null;
    const compactId = withSegmentedStrip
      ? localId && localId !== layout.focusId ? localId : null
      : [...layout.mineStripIds, ...layout.theirsStripIds][0] ?? null;
    const selectedIds = (stripSide === 'mine' ? layout.mineStripIds : layout.theirsStripIds)
      .filter((id) => id !== compactId);
    return (
      <View style={styles.focusedStage}>
        <View style={styles.focusedPrimary}>{renderParticipant(layout.focusId, 'fit')}</View>
        {compactId && !selfViewMinimized && (
          <View style={styles.selfView}>
            {renderParticipant(compactId, 'crop', true)}
            <TouchableOpacity
              onPress={() => setSelfViewMinimized(true)}
              accessibilityRole="button"
              accessibilityLabel="Minimize compact video"
              style={styles.selfViewDismiss}
            >
              <Icon.close size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
        {compactId && selfViewMinimized && (
          <TouchableOpacity
            onPress={() => setSelfViewMinimized(false)}
            accessibilityRole="button"
            accessibilityLabel="Restore compact video"
            style={styles.selfViewRestore}
          >
            <Text style={styles.selfViewRestoreText}>Self</Text>
          </TouchableOpacity>
        )}
        {withSegmentedStrip && (
          <View style={styles.segmentedStrip}>
            <View style={styles.segmentedControl}>
              {(['mine', 'theirs'] as EncounterSide[]).map((side) => (
                <TouchableOpacity
                  key={side}
                  onPress={() => setStripSide(side)}
                  accessibilityRole="button"
                  accessibilityLabel={side === 'mine' ? 'Show your squad' : 'Show opponent squad'}
                  accessibilityState={{ selected: stripSide === side }}
                  style={[styles.segmentButton, stripSide === side && styles.segmentButtonActive]}
                >
                  <Text style={[styles.segmentText, stripSide === side && styles.segmentTextActive]}>
                    {side === 'mine' ? 'Yours' : 'Theirs'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {renderStrip(selectedIds)}
          </View>
        )}
      </View>
    );
  }

  function renderAdaptiveStage() {
    if (layout.kind === 'remote-main') return renderFocusedStage(false);
    if (layout.kind === 'squad-split') {
      return (
        <View style={[styles.splitStage, stackSides && styles.splitStageStacked]}>
          {renderSquadRegion('mine', layout.mineStripIds)}
          {renderSquadRegion('theirs', layout.theirsStripIds)}
        </View>
      );
    }
    if (layout.kind === 'featured-split') {
      return (
        <View style={[styles.splitStage, stackSides && styles.splitStageStacked]}>
          {renderFeaturedSide('mine', layout.minePrimaryId, layout.mineStripIds)}
          {renderFeaturedSide('theirs', layout.theirsPrimaryId, layout.theirsStripIds)}
        </View>
      );
    }
    if (layout.kind === 'dual-focus') {
      return (
        <View style={styles.splitStage}>
          {renderFeaturedSide('mine', layout.minePrimaryId, layout.mineStripIds)}
          {renderFeaturedSide('theirs', layout.theirsPrimaryId, layout.theirsStripIds)}
        </View>
      );
    }
    if (layout.kind === 'single-focus') return renderFocusedStage(true);
    return null;
  }

  return (
    <Screen>
      {/* ── Slim top bar ── */}
      <View style={styles.topBar}>
        {!compactHeader && (
          <View style={styles.topLeft}>
            <Text style={styles.topSquadA} numberOfLines={1}>{mySquad?.name} · {mineParticipants.length}</Text>
            <Text style={styles.topVs}>vs</Text>
            <Text style={styles.topSquadB} numberOfLines={1}>{theirSquad?.name} · {theirParticipants.length}</Text>
          </View>
        )}
        <View style={styles.topRight}>
          {connState === 'CONNECTED' ? (
            <>
              <View style={styles.livePill}><Text style={styles.liveText}>LIVE</Text></View>
              <Text style={styles.timer}>{fmt(elapsed)}</Text>
            </>
          ) : (
            <Text style={[styles.connectionText, connState === 'DISCONNECTED' && styles.connectionError]}>
              {connState === 'RECONNECTING' ? 'Reconnecting' : connState === 'DISCONNECTED' ? 'Disconnected' : 'Connecting'}
            </Text>
          )}
        </View>
      </View>

      {/* ── Chat panel (toggled) OR video area ── */}
      {showChat ? (
        <View style={styles.chatPane}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatHeaderTitle}>Live Chat</Text>
            <TouchableOpacity onPress={() => setShowChat(false)}>
              <Icon.close size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          {chatError ? (
            <View style={styles.chatError}>
              <Text style={styles.chatErrorTitle}>Message not sent</Text>
              <Text style={styles.chatErrorText}>{chatError}</Text>
            </View>
          ) : null}
          <ScrollView contentContainerStyle={styles.chatScroll}>
            {messages.length === 0 && <Text style={styles.chatEmpty}>No messages yet. Say hi!</Text>}
            {messages.map((m) => (
              <View key={m.id} style={styles.chatMsg}>
                <Text style={styles.chatFrom}>{m.from}</Text>
                <Text style={styles.chatText}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="Message…"
              placeholderTextColor={COLORS.textDim}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={sendMessage}
            />
            <TouchableOpacity style={styles.chatSend} onPress={sendMessage}>
              <Text style={styles.chatSendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.videoArea}>
          {!enc ? (
            <View style={styles.encounterState}>
              <Text style={styles.encounterStateTitle}>
                {encounterError ? 'Encounter unavailable' : 'Loading encounter'}
              </Text>
              <Text style={styles.encounterStateCopy}>
                {encounterError || 'Pulling in the real squad details before opening the room.'}
              </Text>
            </View>
          ) : (
            <>
              {videoError ? (
                <View style={styles.videoErrorBanner} accessibilityRole="alert">
                  <Text style={styles.videoErrorTitle}>Video unavailable</Text>
                  <Text style={styles.videoErrorCopy}>{videoError}</Text>
                </View>
              ) : null}
              <View style={styles.adaptiveStage}>{renderAdaptiveStage()}</View>
            </>
          )}
        </View>
      )}

      {/* ── Bottom control row ── */}
      <View style={styles.controls}>
        {/* Mic */}
        <View style={styles.ctrlWrap}>
          <TouchableOpacity onPress={handleMicToggle} style={[styles.ctrl, !mic && styles.ctrlOff]}>
            <Icon.mic size={22} color={mic ? COLORS.text : COLORS.coral} />
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>Mic</Text>
        </View>

        {/* Cam */}
        <View style={styles.ctrlWrap}>
          <TouchableOpacity onPress={handleCamToggle} style={[styles.ctrl, !cam && styles.ctrlOff]}>
            <Icon.cam size={22} color={cam ? COLORS.text : COLORS.coral} />
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>Cam</Text>
        </View>

        {/* Chat */}
        <View style={styles.ctrlWrap}>
          <TouchableOpacity onPress={() => setShowChat((s) => !s)} style={[styles.ctrl, showChat && styles.ctrlActive]}>
            <Icon.chat size={22} color={showChat ? COLORS.violet : COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>Chat</Text>
        </View>

        {/* Report */}
        <View style={styles.ctrlWrap}>
          <TouchableOpacity
            onPress={handleReport}
            disabled={!canReport || reported}
            accessibilityRole="button"
            accessibilityLabel={!canReport ? 'Report unavailable' : reported ? 'Report sent' : 'Report opponent squad'}
            style={[styles.ctrl, reported && styles.ctrlActive, !canReport && styles.ctrlDisabled]}
          >
            <Icon.flag size={22} color={reported ? COLORS.violet : COLORS.textMuted} />
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>{!canReport ? 'Unavailable' : reported ? 'Sent' : 'Report'}</Text>
        </View>

        {/* End */}
        <View style={styles.ctrlWrap}>
          <TouchableOpacity onPress={endEncounter} style={[styles.ctrl, styles.ctrlEnd]}>
            <Icon.close size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>End</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // ── Slim top bar ──
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: SPACE.sm },
  topSquadA: { fontSize: 13, fontWeight: '700', color: COLORS.violet, maxWidth: 160 },
  topVs: { fontSize: 11, color: COLORS.textDim, fontWeight: '600' },
  topSquadB: { fontSize: 13, fontWeight: '700', color: COLORS.coral, maxWidth: 160 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  livePill: { backgroundColor: COLORS.coral, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  liveText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  timer: { fontSize: 12, color: COLORS.textMuted, fontVariant: ['tabular-nums'] as any },
  connectionText: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted },
  connectionError: { color: COLORS.coral },

  // ── Video area ──
  videoArea: { flex: 1, overflow: 'hidden' },
  encounterState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.xl,
    gap: 8,
  },
  encounterStateTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  encounterStateCopy: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  videoErrorBanner: {
    marginHorizontal: SPACE.md,
    marginTop: SPACE.sm,
    padding: SPACE.sm,
    borderRadius: RADII.tile,
    borderWidth: 1,
    borderColor: 'rgba(255,92,92,0.28)',
    backgroundColor: 'rgba(255,92,92,0.10)',
  },
  videoErrorTitle: { color: COLORS.coral, fontSize: 12, fontWeight: '900' },
  videoErrorCopy: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  adaptiveStage: { flex: 1, minHeight: 0, padding: SPACE.sm },
  splitStage: { flex: 1, minHeight: 0, flexDirection: 'row', gap: TILE_GAP },
  splitStageStacked: { flexDirection: 'column' },
  squadRegion: { flex: 1, minHeight: 0, gap: 6 },
  squadTiles: { flex: 1, minHeight: 0, flexDirection: 'row', gap: TILE_GAP },
  featuredSide: { flex: 1, minHeight: 0, gap: 6 },
  primarySlot: { flex: 1, minHeight: 0 },
  sideHeader: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  sideEyebrow: { fontSize: 11, fontWeight: '900', color: COLORS.lime, textTransform: 'uppercase', letterSpacing: 0.6 },
  sideEyebrowTheirs: { color: COLORS.coral },
  sideName: { flex: 1, fontSize: 11, color: COLORS.textMuted },
  participantTile: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
    borderRadius: RADII.tile,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: COLORS.surface,
  },
  participantTileCompact: { borderRadius: 11 },
  participantTileSpeaking: { borderColor: COLORS.lime, borderWidth: 2 },
  participantFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  participantStatus: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  videoBackdrop: {
    opacity: 0.46,
    transform: [{ scale: 1.08 }],
    filter: [{ blur: 22 }, { brightness: 0.46 }],
  },
  filmstrip: { flexGrow: 0, height: 76 },
  filmstripContent: { gap: 7, paddingRight: 4 },
  filmstripItem: { width: 108, height: 72 },
  focusedStage: { flex: 1, minHeight: 0, position: 'relative', gap: 7 },
  focusedPrimary: { flex: 1, minHeight: 0 },
  selfView: {
    position: 'absolute', top: 10, right: 10, width: 118, height: 78, zIndex: 5,
    borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 10, elevation: 8,
  },
  selfViewDismiss: {
    position: 'absolute', top: -8, right: -8, width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)',
  },
  selfViewRestore: {
    position: 'absolute', top: 12, right: 12, zIndex: 5, minWidth: 52, height: 48,
    borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(18,18,26,0.92)', borderWidth: 1, borderColor: COLORS.border,
  },
  selfViewRestoreText: { color: COLORS.text, fontSize: 11, fontWeight: '800' },
  segmentedStrip: { height: 116, gap: 6 },
  segmentedControl: {
    alignSelf: 'center', flexDirection: 'row', padding: 3, borderRadius: 999,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  segmentButton: { minWidth: 86, minHeight: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segmentButtonActive: { backgroundColor: 'rgba(124,92,255,0.22)' },
  segmentText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: COLORS.text },

  // Name pill overlay
  tileNamePill: {
    position: 'absolute',
    bottom: 5, left: 5, right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  tileNameText: { fontSize: 10, fontWeight: '700', color: '#fff', flex: 1 },
  mutedBadge: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.coral,
    alignItems: 'center', justifyContent: 'center',
  },

  // Chat pane
  chatPane: { flex: 1 },
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: SPACE.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  chatHeaderTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  chatError: {
    marginHorizontal: SPACE.lg,
    marginTop: SPACE.md,
    padding: SPACE.sm,
    borderRadius: RADII.tile,
    borderWidth: 1,
    borderColor: 'rgba(255,92,92,0.28)',
    backgroundColor: 'rgba(255,92,92,0.10)',
  },
  chatErrorTitle: { color: COLORS.coral, fontSize: 12, fontWeight: '900' },
  chatErrorText: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  chatScroll: { padding: SPACE.lg, gap: SPACE.sm },
  chatEmpty: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', marginTop: SPACE.xl },
  chatMsg: { marginBottom: SPACE.sm },
  chatFrom: { fontSize: 11, color: COLORS.violet, fontWeight: '700' },
  chatText: { fontSize: 14, color: COLORS.text },
  chatInputRow: {
    flexDirection: 'row', gap: 8, padding: SPACE.md,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  chatInput: {
    flex: 1, height: 44, borderRadius: RADII.input, paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: COLORS.border, color: COLORS.text,
  },
  chatSend: {
    height: 44, paddingHorizontal: 18, borderRadius: RADII.input,
    backgroundColor: COLORS.violet, alignItems: 'center', justifyContent: 'center',
  },
  chatSendText: { color: '#fff', fontWeight: '700' },

  // ── Bottom controls ──
  controls: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start',
    paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  ctrlWrap: { alignItems: 'center', gap: 5, minWidth: 52 },
  ctrlLabel: { fontSize: 9, color: COLORS.textDim, fontWeight: '600' },
  ctrl: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  ctrlOff: { backgroundColor: 'rgba(255,92,92,0.15)', borderColor: COLORS.coral },
  ctrlActive: { borderColor: COLORS.violet, backgroundColor: 'rgba(124,92,255,0.1)' },
  ctrlDisabled: { opacity: 0.45 },
  ctrlEnd: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.coral, borderColor: COLORS.coral,
  },
});
