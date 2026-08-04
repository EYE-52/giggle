import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, BackHandler, Keyboard, KeyboardAvoidingView, Modal,
  Platform, View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../components/Screen';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { RtcSurface } from '../../components/RtcSurface';
import { COLORS, SPACE, RADII } from '../../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import {
  advanceSpeakerFocus,
  api,
  connectSocket,
  createOpponentUserIds,
  createReportOpponentPayload,
  deriveEncounterLayout,
  EMPTY_SPEAKER_FOCUS,
  joinChat,
  reportOpponentSquad,
  sendChatMessage,
  sendReaction,
  session,
  SOCKET_EMIT,
  SOCKET_EVENTS,
  subscribeChat,
  subscribeReaction,
} from '@giggle/core';
import type { ChatMessage, EncounterDetail, EncounterSide } from '@giggle/core';
import { createVideoClient } from '@giggle/agora';
import type { CaptureState, ConnectionState, VideoClient, RemoteParticipant } from '@giggle/agora';

const TILE_COLORS = ['#7C5CFF', '#3DD6C0', '#FF8A5C', '#C2FF3D', '#FF5C8A', '#5C8CFF'];

interface EncounterParticipant {
  id: string;
  memberId: string;
  name: string;
  side: EncounterSide;
  colorIndex: number;
  uid?: number;
  isLocal: boolean;
}
interface FloatingReaction { id: number; emoji: string; senderId: string; }

const TILE_GAP = 8;
const REACTION_EMOJIS = ['👋', '😂', '🔥', '👏', '❤️'];

function ReactionBubble({ emoji, reduceMotion }: { emoji: string; reduceMotion: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 1800,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const opacity = progress.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [1, 1, 0],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -54],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.reactionBubble,
        { opacity },
        reduceMotion ? null : { transform: [{ translateY }] },
      ]}
    >
      <Text style={styles.reactionEmoji}>{emoji}</Text>
    </Animated.View>
  );
}

export default function EncounterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ squad?: string; enc?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;
  const encId = typeof params.enc === 'string' ? params.enc : undefined;

  const [elapsed, setElapsed] = useState(0);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [enc, setEnc] = useState<EncounterDetail | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [encounterError, setEncounterError] = useState('');
  const [chatError, setChatError] = useState('');
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [connState, setConnState] = useState<ConnectionState | null>(null);
  const [captureState, setCaptureState] = useState<CaptureState>({ audio: 'off', video: 'off' });
  const [loudestUid, setLoudestUid] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [speakerFocus, setSpeakerFocus] = useState(EMPTY_SPEAKER_FOCUS);
  const [stripSide, setStripSide] = useState<EncounterSide>('mine');
  const [selfViewMinimized, setSelfViewMinimized] = useState(false);
  const [focusedFit, setFocusedFit] = useState<'fit' | 'crop'>('fit');
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [unread, setUnread] = useState(0);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [videoRetrying, setVideoRetrying] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState('');
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState('');
  const [remoteEnded, setRemoteEnded] = useState<'opponent-left' | 'ended' | null>(null);
  const [remoteEndError, setRemoteEndError] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const chatVisibleRef = useRef(false);
  const messageIdsRef = useRef(new Set<string>());
  const reactionCountRef = useRef(0);
  const reactionTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
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
      if (vcRef.current !== vc) return;
      setCaptureState(state);
      if (state.audio === 'active') setMic(true);
      else if (state.audio === 'denied' || state.audio === 'unavailable') setMic(false);
      if (state.video === 'active') setCam(true);
      else if (state.video === 'denied' || state.video === 'unavailable') setCam(false);
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
    setEnc(null);
    setEncounterError('');
    setElapsed(0);
    const boot = async () => {
      setEncounterError('');
      try {
        const detail = await api.getEncounter(encId);
        if (cancelled) return;
        setEnc(detail);
        if (!squadId) return;
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
      } catch (e: any) {
        if (!cancelled) setEncounterError(e?.message || "Couldn't load this encounter.");
      }
    };
    boot();
    return () => {
      cancelled = true;
      joinChainRef.current = joinChainRef.current.catch(() => {}).then(async () => {
        const staleClient = vcRef.current;
        vcRef.current = null;
        clearVideoListeners();
        try { await staleClient?.leave(); } catch {}
      });
    };
  }, [encId, squadId]);

  useEffect(() => {
    if (!encId || !squadId) return;
    const scope = { kind: 'encounter' as const, encounterId: encId, squadId };
    messageIdsRef.current.clear();
    reactionTimersRef.current.splice(0).forEach(clearTimeout);
    setMessages([]);
    setUnread(0);
    setFloatingReactions([]);
    joinChat(scope);
    const unsubscribeChat = subscribeChat((message) => {
      if (message.encounterId !== encId) return;
      if (messageIdsRef.current.has(message.id)) return;
      messageIdsRef.current.add(message.id);
      setMessages((previous) => [...previous, message]);
      if (!chatVisibleRef.current && message.userId !== session.user?.id) {
        setUnread((value) => Math.min(value + 1, 99));
      }
    });
    const unsubscribeReaction = subscribeReaction((reaction) => {
      if (reaction.encounterId !== encId || reaction.senderId === session.user?.id) return;
      if (reaction.emoji) spawnReaction(reaction.emoji, reaction.senderId);
    });
    return () => {
      unsubscribeChat();
      unsubscribeReaction();
    };
  }, [encId, squadId]);

  useEffect(() => {
    if (!encId || !squadId) return;
    const socket = connectSocket(squadId);
    socket.emit(SOCKET_EMIT.JOIN_ENCOUNTER, encId);
    const onEnded = (payload?: { encounterId?: string; reason?: string; endedBySquadId?: string }) => {
      if (payload?.encounterId && payload.encounterId !== encId) return;
      if (payload?.endedBySquadId === squadId) return;
      setShowChat(false);
      setMoreOpen(false);
      setEndConfirmOpen(false);
      setBlockConfirmOpen(false);
      setRemoteEndError('');
      setRemoteEnded(payload?.reason === 'squad_disconnected' ? 'opponent-left' : 'ended');
      setVideoReady(false);
      joinChainRef.current = joinChainRef.current.catch(() => {}).then(async () => {
        const staleClient = vcRef.current;
        vcRef.current = null;
        clearVideoListeners();
        try { await staleClient?.leave(); } catch {}
      });
    };
    socket.on(SOCKET_EVENTS.ENCOUNTER_ENDED, onEnded);
    return () => { socket.off(SOCKET_EVENTS.ENCOUNTER_ENDED, onEnded); };
  }, [encId, squadId]);

  chatVisibleRef.current = showChat;
  useEffect(() => {
    if (showChat) setUnread(0);
  }, [showChat]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => () => {
    reactionTimersRef.current.splice(0).forEach(clearTimeout);
  }, []);

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
    if (!encId || !squadId) {
      setChatError("Chat isn't connected yet.");
      return;
    }
    const sent = sendChatMessage(
      { kind: 'encounter', encounterId: encId, squadId },
      text,
      { id: session.user?.id ?? '', name: session.user?.name ?? 'You' },
    );
    if (!sent) {
      setChatError("Couldn't send message.");
      return;
    }
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
  const opponentUserIds = createOpponentUserIds({ squadId, ownUserId: myUserId, encounter: enc });
  const canBlockOpponent = Boolean(opponentUserIds?.length);

  async function handleReport() {
    if (reported || reporting || !canReport) return;
    setMoreError('');
    setReporting(true);
    const result = await reportOpponentSquad({ encounterId: encId, squadId, encounter: enc });
    setReporting(false);
    if (!result.ok) {
      setMoreError("Couldn't send this report. Try again.");
      return;
    }
    setReported(true);
  }

  function spawnReaction(emoji: string, senderId: string) {
    const id = ++reactionCountRef.current;
    setFloatingReactions((previous) => [...previous, { id, emoji, senderId }]);
    const timer = setTimeout(() => {
      setFloatingReactions((previous) => previous.filter((reaction) => reaction.id !== id));
      reactionTimersRef.current = reactionTimersRef.current.filter((item) => item !== timer);
    }, 1800);
    reactionTimersRef.current.push(timer);
  }

  function fireReaction(emoji: string) {
    if (!encId || !squadId) return false;
    setMoreError('');
    const sent = sendReaction(
      { kind: 'encounter', encounterId: encId, squadId },
      emoji,
      { id: session.user?.id ?? '', name: session.user?.name ?? 'You' },
    );
    if (!sent) {
      setMoreError("Couldn't send that reaction. Try again.");
      return false;
    }
    spawnReaction(emoji, session.user?.id ?? '');
    return true;
  }

  function retryVideo() {
    if (videoRetrying || !enc) return;
    setVideoRetrying(true);
    joinChainRef.current = joinChainRef.current.catch(() => {}).then(async () => {
      try {
        await joinVideo();
      } catch (e: any) {
        setVideoReady(false);
        setConnState('DISCONNECTED');
        setVideoError(e?.message || "Couldn't join video.");
      } finally {
        setVideoRetrying(false);
      }
    });
  }

  async function handleSwitchCamera() {
    setMoreError('');
    try {
      if (!vcRef.current?.switchCamera) throw new Error('Camera switching is unavailable.');
      await vcRef.current.switchCamera();
      setMoreOpen(false);
    } catch (e: any) {
      setMoreError(e?.message || "Couldn't switch camera.");
    }
  }

  async function leaveVideoAndGoHome() {
    try { await vcRef.current?.leave(); } catch {}
    vcRef.current = null;
    clearVideoListeners();
    router.replace('/home');
  }

  async function blockOpponentSquad() {
    if (!squadId || !encId || !opponentUserIds || blocking) return;
    setBlocking(true);
    setBlockError('');
    try {
      await api.blockUsers(opponentUserIds);
      await api.disconnectEncounter(squadId, encId);
      await leaveVideoAndGoHome();
    } catch {
      setBlocking(false);
      setBlockError("Couldn't block this squad yet. Try again.");
    }
  }

  async function endEncounter() {
    if (!squadId || !encId || ending) return;
    setEnding(true);
    setEndError('');
    try {
      await api.disconnectEncounter(squadId, encId);
      setEndConfirmOpen(false);
      await leaveVideoAndGoHome();
    } catch {
      setEnding(false);
      setEndError("Couldn't end this encounter yet.");
    }
  }

  if (!squadId || !encId || (encounterError && !enc)) {
    return (
      <Screen style={styles.recoveryScreen}>
        <View style={styles.recoveryCard}>
          <Text style={styles.recoveryTitle}>Encounter unavailable</Text>
          <Text style={styles.recoveryCopy}>
            {encounterError || 'This live room link is missing required details.'}
          </Text>
          <View style={styles.recoveryActions}>
            {squadId && (
              <TouchableOpacity
                onPress={() => router.replace(`/lobby?squad=${squadId}`)}
                accessibilityRole="button"
                accessibilityLabel="Find a match"
                style={styles.recoveryPrimary}
              >
                <Text style={styles.recoveryPrimaryText}>Find a match</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.replace('/home')}
              accessibilityRole="button"
              accessibilityLabel="Go home"
              style={styles.recoverySecondary}
            >
              <Text style={styles.recoverySecondaryText}>Home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Screen>
    );
  }

  const compactHeader = viewportClass === 'phone' || height < 500;
  const stackSides = viewportClass === 'phone' && height >= Math.max(width, 640);
  const captureIssues = [
    captureState.audio === 'denied' ? 'Microphone permission is blocked.'
      : captureState.audio === 'unavailable' ? 'No usable microphone was found.' : null,
    captureState.video === 'denied' ? 'Camera permission is blocked.'
      : captureState.video === 'unavailable' ? 'No usable camera was found.' : null,
  ].filter((message): message is string => !!message);
  const localParticipant = participants.find((person) => person.isLocal);
  const hasFocusedFrame = layout.kind !== 'squad-split';
  const hasCompactSelfView = !!localParticipant && localParticipant.id !== layout.focusId &&
    (layout.kind === 'remote-main' || layout.kind === 'single-focus');
  const chatSheetHeight = keyboardHeight > 0
    ? Math.max(180, height - keyboardHeight - 96)
    : Math.max(180, Math.min(height - 96, height * 0.55));

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
          <Text
            style={styles.tileNameText}
            numberOfLines={1}
            accessibilityLabel={person.isLocal ? `${person.name}, you` : person.name}
          >
            {person.isLocal ? 'You' : person.name}
          </Text>
          {muted && (
            <View style={styles.mutedBadge} accessibilityLabel={`${person.name} is muted`}>
              <Icon.mic size={9} color="#fff" />
            </View>
          )}
        </View>
        <View pointerEvents="none" style={styles.reactionStack}>
          {floatingReactions
            .filter((reaction) => reaction.senderId === person.id)
            .map((reaction) => (
              <ReactionBubble key={reaction.id} emoji={reaction.emoji} reduceMotion={reduceMotion} />
            ))}
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
        <View style={styles.primarySlot}>{renderParticipant(primaryId, focusedFit)}</View>
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
        <View style={styles.focusedPrimary}>{renderParticipant(layout.focusId, focusedFit)}</View>
        {compactId && !selfViewMinimized && (
          <View style={styles.selfView}>
            {renderParticipant(compactId, 'crop', true)}
          </View>
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

      <View style={styles.videoArea}>
        {!enc ? (
          <View style={styles.encounterState}>
            <Text style={styles.encounterStateTitle}>Loading encounter</Text>
            <Text style={styles.encounterStateCopy}>Pulling in the real squad details before opening the room.</Text>
          </View>
        ) : (
          <>
            {videoError && captureIssues.length === 0 ? (
              <View style={styles.videoErrorBanner} accessibilityRole="alert">
                <View style={styles.issueCopy}>
                  <Text style={styles.videoErrorTitle}>{videoReady ? 'Call issue' : 'Video unavailable'}</Text>
                  <Text style={styles.videoErrorCopy}>{videoError}</Text>
                </View>
                <TouchableOpacity
                  onPress={retryVideo}
                  disabled={videoRetrying}
                  accessibilityRole="button"
                  accessibilityLabel="Retry video"
                  accessibilityState={{ disabled: videoRetrying }}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryButtonText}>{videoRetrying ? 'Retrying…' : 'Retry'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {captureIssues.length > 0 && (
              <View style={styles.captureBanner} accessibilityLiveRegion="polite">
                <Text style={styles.captureCopy}>{captureIssues.join(' ')}</Text>
                <TouchableOpacity
                  onPress={retryVideo}
                  disabled={videoRetrying}
                  accessibilityRole="button"
                  accessibilityLabel="Retry camera and microphone"
                  accessibilityState={{ disabled: videoRetrying }}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryButtonText}>{videoRetrying ? 'Retrying…' : 'Retry'}</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.adaptiveStage}>{renderAdaptiveStage()}</View>
          </>
        )}
      </View>

      {/* ── Bottom control row ── */}
      <View style={styles.controls}>
        <View style={styles.ctrlWrap}>
          <TouchableOpacity
            onPress={handleMicToggle}
            accessibilityRole="button"
            accessibilityLabel={mic ? 'Mute microphone' : 'Unmute microphone'}
            accessibilityState={{ selected: mic }}
            style={[styles.ctrl, !mic && styles.ctrlOff]}
          >
            <Icon.mic size={22} color={mic ? COLORS.text : COLORS.coral} />
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>Mic</Text>
        </View>

        <View style={styles.ctrlWrap}>
          <TouchableOpacity
            onPress={handleCamToggle}
            accessibilityRole="button"
            accessibilityLabel={cam ? 'Turn camera off' : 'Turn camera on'}
            accessibilityState={{ selected: cam }}
            style={[styles.ctrl, !cam && styles.ctrlOff]}
          >
            <Icon.cam size={22} color={cam ? COLORS.text : COLORS.coral} />
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>Cam</Text>
        </View>

        <View style={styles.ctrlWrap}>
          <TouchableOpacity
            onPress={() => {
              setMoreOpen(false);
              setEndConfirmOpen(false);
              setShowChat(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Chat"
            accessibilityState={{ selected: showChat }}
            style={[styles.ctrl, showChat && styles.ctrlActive]}
          >
            <Icon.chat size={22} color={showChat ? COLORS.violet : COLORS.text} />
            {unread > 0 && (
              <View style={styles.unreadBadge} accessibilityLabel={`${unread} unread messages`}>
                <Text style={styles.unreadText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>Chat</Text>
        </View>

        <View style={styles.ctrlWrap}>
          <TouchableOpacity
            onPress={() => {
              setShowChat(false);
              setEndConfirmOpen(false);
              setMoreError('');
              setMoreOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="More"
            accessibilityState={{ selected: moreOpen }}
            style={[styles.ctrl, moreOpen && styles.ctrlActive]}
          >
            <Text style={styles.moreGlyph}>•••</Text>
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>More</Text>
        </View>

        <View style={styles.ctrlWrap}>
          <TouchableOpacity
            onPress={() => {
              setShowChat(false);
              setMoreOpen(false);
              setEndError('');
              setEndConfirmOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="End encounter"
            style={[styles.ctrl, styles.ctrlEnd]}
          >
            <Icon.close size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.ctrlLabel}>End</Text>
        </View>
      </View>

      <Modal
        visible={showChat}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowChat(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View
            accessibilityViewIsModal
            style={[
              styles.chatSheet,
              { height: chatSheetHeight, paddingBottom: Math.max(insets.bottom, SPACE.sm) },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Chat</Text>
                <Text style={styles.sheetSubtitle}>Both squads</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowChat(false)}
                accessibilityRole="button"
                accessibilityLabel="Close chat"
                style={styles.sheetClose}
              >
                <Icon.close size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            {chatError ? (
              <View style={styles.chatError} accessibilityRole="alert">
                <Text style={styles.chatErrorTitle}>Message not sent</Text>
                <Text style={styles.chatErrorText}>{chatError}</Text>
              </View>
            ) : null}
            <ScrollView
              style={styles.chatMessages}
              contentContainerStyle={styles.chatScroll}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length === 0 && <Text style={styles.chatEmpty}>No messages yet. Say hi!</Text>}
              {messages.map((message) => (
                <View key={message.id} style={[styles.chatMsg, message.userId === myUserId && styles.chatMsgOwn]}>
                  <Text style={styles.chatFrom}>{message.userId === myUserId ? 'You' : message.name || 'Someone'}</Text>
                  <Text style={styles.chatText}>{message.text}</Text>
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
                accessibilityLabel="Chat message"
                maxLength={500}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={styles.chatSend}
                onPress={sendMessage}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                <Text style={styles.chatSendText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={moreOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setMoreOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            accessibilityViewIsModal
            style={[styles.moreSheet, { paddingBottom: Math.max(insets.bottom, SPACE.md) }]}
          >
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>More</Text>
                <Text style={styles.sheetSubtitle}>Call actions</Text>
              </View>
              <TouchableOpacity
                onPress={() => setMoreOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close More"
                style={styles.sheetClose}
              >
                <Icon.close size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.moreContent}>
              <Text style={styles.actionLabel}>Reactions</Text>
              <View style={styles.reactionChoices}>
              {REACTION_EMOJIS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => {
                    if (fireReaction(emoji)) setMoreOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                  style={styles.reactionChoice}
                >
                  <Text style={styles.reactionChoiceText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
              </View>
              {moreError ? <Text style={styles.moreError} accessibilityRole="alert">{moreError}</Text> : null}
              <TouchableOpacity
              onPress={handleReport}
              disabled={!canReport || reported || reporting}
              accessibilityRole="button"
              accessibilityLabel={!canReport ? 'Report unavailable' : reported ? 'Report sent' : reporting ? 'Sending report' : 'Report opponent squad'}
              accessibilityState={{ disabled: !canReport || reported || reporting }}
              style={[styles.actionRow, (!canReport || reported || reporting) && styles.actionRowDisabled]}
            >
              <Icon.flag size={20} color={reported ? COLORS.lime : COLORS.textMuted} />
              <Text style={styles.actionText}>{reported ? 'Reported' : reporting ? 'Sending report…' : 'Report opponent squad'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setMoreOpen(false);
                  setBlockError('');
                  setBlockConfirmOpen(true);
                }}
                disabled={!canBlockOpponent || blocking}
                accessibilityRole="button"
                accessibilityLabel={!canBlockOpponent ? 'Block unavailable' : blocking ? 'Blocking opponent squad' : 'Block opponent squad'}
                accessibilityState={{ disabled: !canBlockOpponent || blocking, busy: blocking }}
                style={[styles.actionRow, (!canBlockOpponent || blocking) && styles.actionRowDisabled]}
              >
                <Icon.shield size={20} color={COLORS.coral} />
                <Text style={styles.actionText}>{blocking ? 'Blocking opponent squad…' : 'Block opponent squad'}</Text>
              </TouchableOpacity>
              {hasFocusedFrame && (
                <TouchableOpacity
                onPress={() => {
                  setFocusedFit((current) => current === 'fit' ? 'crop' : 'fit');
                  setMoreOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={focusedFit === 'fit' ? 'Crop focused video' : 'Fit focused video'}
                style={styles.actionRow}
              >
                <Icon.cam size={20} color={COLORS.textMuted} />
                <Text style={styles.actionText}>{focusedFit === 'fit' ? 'Crop focused video' : 'Fit focused video'}</Text>
                </TouchableOpacity>
              )}
              {hasCompactSelfView && (
                <TouchableOpacity
                onPress={() => {
                  setSelfViewMinimized((current) => !current);
                  setMoreOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={selfViewMinimized ? 'Restore self-view' : 'Minimize self-view'}
                style={styles.actionRow}
              >
                <Icon.profile size={20} color={COLORS.textMuted} />
                <Text style={styles.actionText}>{selfViewMinimized ? 'Restore self-view' : 'Minimize self-view'}</Text>
                </TouchableOpacity>
              )}
              {!!vcRef.current?.switchCamera && (
                <TouchableOpacity
                onPress={handleSwitchCamera}
                accessibilityRole="button"
                accessibilityLabel="Switch camera"
                style={styles.actionRow}
              >
                <Icon.cam size={20} color={COLORS.textMuted} />
                <Text style={styles.actionText}>Switch camera</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={blockConfirmOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (!blocking) setBlockConfirmOpen(false);
        }}
      >
        <View style={styles.confirmOverlay}>
          <View accessibilityViewIsModal style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Block opponent squad?</Text>
            <Text style={styles.confirmCopy}>
              Everyone in the other squad will be blocked, and your squad will leave this encounter. This does not send a report.
            </Text>
            {blockError ? <Text style={styles.endError} accessibilityRole="alert">{blockError}</Text> : null}
            <View style={styles.confirmActions}>
              <TouchableOpacity
                onPress={() => setBlockConfirmOpen(false)}
                disabled={blocking}
                accessibilityRole="button"
                accessibilityLabel="Cancel blocking"
                accessibilityState={{ disabled: blocking }}
                style={[styles.confirmSecondary, blocking && styles.actionRowDisabled]}
              >
                <Text style={styles.confirmSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={blockOpponentSquad}
                disabled={blocking}
                accessibilityRole="button"
                accessibilityLabel={blocking ? 'Blocking opponent squad' : 'Confirm block opponent squad'}
                accessibilityState={{ disabled: blocking, busy: blocking }}
                style={[styles.confirmDanger, blocking && styles.actionRowDisabled]}
              >
                <Text style={styles.confirmDangerText}>{blocking ? 'Blocking…' : 'Block squad'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={endConfirmOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (!ending) setEndConfirmOpen(false);
        }}
      >
        <View style={styles.confirmOverlay}>
          <View accessibilityViewIsModal style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>End encounter?</Text>
            <Text style={styles.confirmCopy}>This ends the current encounter for both squads.</Text>
            {endError ? <Text style={styles.endError} accessibilityRole="alert">{endError}</Text> : null}
            <View style={styles.confirmActions}>
              <TouchableOpacity
                onPress={() => setEndConfirmOpen(false)}
                disabled={ending}
                accessibilityRole="button"
                accessibilityLabel="Keep talking"
                style={styles.confirmSecondary}
              >
                <Text style={styles.confirmSecondaryText}>Keep talking</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={endEncounter}
                disabled={ending}
                accessibilityRole="button"
                accessibilityLabel="End encounter"
                accessibilityState={{ disabled: ending }}
                style={styles.confirmDanger}
              >
                <Text style={styles.confirmDangerText}>{ending ? 'Ending…' : 'End encounter'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={remoteEnded !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => router.replace('/home')}
      >
        <View style={styles.confirmOverlay}>
          <View accessibilityViewIsModal style={styles.confirmCard}>
            <Text style={styles.remoteEndedIcon}>👋</Text>
            <Text style={styles.confirmTitle}>
              {remoteEnded === 'opponent-left' ? 'The other squad left' : 'Encounter ended'}
            </Text>
            <Text style={styles.confirmCopy}>
              {remoteEnded === 'opponent-left' ? 'Your squad is already back in matchmaking.' : 'Thanks for hanging out.'}
            </Text>
            {remoteEndError ? <Text style={styles.endError} accessibilityRole="alert">{remoteEndError}</Text> : null}
            <View style={styles.confirmActions}>
              <TouchableOpacity
                onPress={() => router.replace('/home')}
                accessibilityRole="button"
                accessibilityLabel="Back home"
                style={styles.confirmSecondary}
              >
                <Text style={styles.confirmSecondaryText}>Back home</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (!squadId) return router.replace('/home');
                  setRemoteEndError('');
                  try {
                    if (remoteEnded !== 'opponent-left') await api.startSearch(squadId);
                    router.replace(`/matchmaking?squad=${squadId}`);
                  } catch (error: any) {
                    setRemoteEndError(error?.message || "Couldn't start matchmaking.");
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={remoteEnded === 'opponent-left' ? 'Continue matching' : 'Find another match'}
                style={styles.confirmDanger}
              >
                <Text style={styles.confirmDangerText}>
                  {remoteEnded === 'opponent-left' ? 'Continue matching' : 'Find another match'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  recoveryScreen: { alignItems: 'center', justifyContent: 'center', padding: SPACE.lg },
  recoveryCard: {
    width: '100%', maxWidth: 440, padding: SPACE.xl, borderRadius: RADII.card,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  recoveryTitle: { color: COLORS.text, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  recoveryCopy: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: SPACE.sm },
  recoveryActions: { flexDirection: 'row', justifyContent: 'center', gap: SPACE.sm, marginTop: SPACE.lg, flexWrap: 'wrap' },
  recoveryPrimary: { minHeight: 48, paddingHorizontal: SPACE.lg, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.violet },
  recoveryPrimaryText: { color: '#fff', fontWeight: '800' },
  recoverySecondary: { minHeight: 48, paddingHorizontal: SPACE.lg, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  recoverySecondaryText: { color: COLORS.text, fontWeight: '800' },

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
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
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
  issueCopy: { flex: 1 },
  captureBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    marginHorizontal: SPACE.md, marginTop: SPACE.sm, padding: SPACE.sm,
    borderRadius: RADII.tile, borderWidth: 1, borderColor: 'rgba(255,176,32,0.34)',
    backgroundColor: 'rgba(255,176,32,0.10)',
  },
  captureCopy: { flex: 1, color: COLORS.text, fontSize: 12, lineHeight: 18 },
  retryButton: { minWidth: 64, minHeight: 48, paddingHorizontal: SPACE.sm, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  retryButtonText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
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
  reactionStack: { position: 'absolute', right: 10, bottom: 42, alignItems: 'flex-end', gap: 3 },
  reactionBubble: { padding: 2 },
  reactionEmoji: { fontSize: 30, lineHeight: 36, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 7 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  chatSheet: {
    width: '100%', maxHeight: '100%', backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADII.card, borderTopRightRadius: RADII.card,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
  },
  moreSheet: {
    width: '100%', maxHeight: '82%', paddingHorizontal: SPACE.md,
    backgroundColor: COLORS.bg, borderTopLeftRadius: RADII.card, borderTopRightRadius: RADII.card,
    borderWidth: 1, borderColor: COLORS.border,
  },
  moreContent: { paddingBottom: SPACE.sm },
  sheetHeader: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  sheetTitle: { fontSize: 17, fontWeight: '900', color: COLORS.text },
  sheetSubtitle: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  sheetClose: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
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
  chatMessages: { flex: 1, minHeight: 0 },
  chatScroll: { padding: SPACE.lg, gap: SPACE.sm },
  chatEmpty: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', marginTop: SPACE.xl },
  chatMsg: { alignSelf: 'flex-start', maxWidth: '86%', padding: SPACE.sm, borderRadius: RADII.tile, backgroundColor: COLORS.surface },
  chatMsgOwn: { alignSelf: 'flex-end', backgroundColor: 'rgba(124,92,255,0.18)' },
  chatFrom: { fontSize: 11, color: COLORS.violet, fontWeight: '700' },
  chatText: { fontSize: 14, lineHeight: 20, color: COLORS.text, marginTop: 2 },
  chatInputRow: {
    flexDirection: 'row', gap: 8, padding: SPACE.md,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  chatInput: {
    flex: 1, height: 48, borderRadius: RADII.input, paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: COLORS.border, color: COLORS.text,
  },
  chatSend: {
    height: 48, paddingHorizontal: 18, borderRadius: RADII.input,
    backgroundColor: COLORS.violet, alignItems: 'center', justifyContent: 'center',
  },
  chatSendText: { color: '#fff', fontWeight: '700' },
  actionLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: SPACE.md, marginBottom: SPACE.sm },
  reactionChoices: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  reactionChoice: { flex: 1, minWidth: 48, height: 52, borderRadius: RADII.input, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  reactionChoiceText: { fontSize: 24 },
  moreError: { color: COLORS.coral, fontSize: 12, lineHeight: 18, marginTop: SPACE.sm },
  actionRow: { minHeight: 52, marginTop: SPACE.sm, paddingHorizontal: SPACE.md, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, borderRadius: RADII.input, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  actionRowDisabled: { opacity: 0.48 },
  actionText: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '700' },
  confirmOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.lg, backgroundColor: 'rgba(0,0,0,0.68)' },
  confirmCard: { width: '100%', maxWidth: 420, padding: SPACE.lg, borderRadius: RADII.card, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  remoteEndedIcon: { fontSize: 32, marginBottom: SPACE.sm },
  confirmTitle: { color: COLORS.text, fontSize: 20, fontWeight: '900' },
  confirmCopy: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20, marginTop: SPACE.sm },
  endError: { color: COLORS.coral, fontSize: 12, lineHeight: 18, marginTop: SPACE.md },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACE.sm, marginTop: SPACE.lg, flexWrap: 'wrap' },
  confirmSecondary: { minHeight: 48, paddingHorizontal: SPACE.lg, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  confirmSecondaryText: { color: COLORS.text, fontWeight: '800' },
  confirmDanger: { minHeight: 48, paddingHorizontal: SPACE.lg, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.coral },
  confirmDangerText: { color: '#fff', fontWeight: '900' },

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
    position: 'relative',
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  ctrlOff: { backgroundColor: 'rgba(255,92,92,0.15)', borderColor: COLORS.coral },
  ctrlActive: { borderColor: COLORS.violet, backgroundColor: 'rgba(124,92,255,0.1)' },
  moreGlyph: { color: COLORS.text, fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  unreadBadge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.coral },
  unreadText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  ctrlEnd: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.coral, borderColor: COLORS.coral,
  },
});
