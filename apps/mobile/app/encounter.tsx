import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../components/Screen';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { RtcSurface } from '../components/RtcSurface';
import { COLORS, SPACE, RADII } from '../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { api, connectSocket, createReportOpponentPayload, reportOpponentSquad, SOCKET_EVENTS, SOCKET_EMIT } from '@giggle/core';
import type { EncounterDetail } from '@giggle/core';
import { createVideoClient } from '@giggle/agora';
import type { VideoClient, RemoteParticipant } from '@giggle/agora';

type ViewMode = 'versus' | 'grid' | 'spotlight' | 'focus';
const MODES: ViewMode[] = ['versus', 'grid', 'spotlight', 'focus'];

const TILE_COLORS = ['#7C5CFF', '#3DD6C0', '#FF8A5C', '#C2FF3D', '#FF5C8A', '#5C8CFF'];

interface ChatMsg { id: string; from: string; text: string; }

const TILE_GAP = 8;
let messageIdCounter = 0;

export default function EncounterScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ squad?: string; enc?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;
  const encId = typeof params.enc === 'string' ? params.enc : undefined;

  const [mode, setMode] = useState<ViewMode>('versus');
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
  const sockRef = useRef<any>(null);
  const vcRef = useRef<VideoClient | null>(null);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!encId) return;
    (async () => {
      setEncounterError('');
      try {
        setEnc(await api.getEncounter(encId));
      } catch (e: any) {
        setEncounterError(e?.message || "Couldn't load this encounter.");
      }
    })();
    let unsubRemotes: (() => void) | undefined;
    if (squadId) {
      (async () => {
        try {
          setVideoError('');
          await api.setEncounterVideo(squadId, true);
          const token = await api.encounterToken(squadId, encId);
          const vc = createVideoClient();
          vcRef.current = vc;
          unsubRemotes = vc.onRemoteChange((r) => setRemotes(r));
          await vc.join(token, { audio: true, video: true });
          setVideoReady(true);
        } catch (e: any) {
          setVideoReady(false);
          setVideoError(e?.message || "Couldn't join video.");
        }
      })();
    }
    try {
      const sock = connectSocket(squadId);
      sockRef.current = sock;
      sock.emit(SOCKET_EMIT.JOIN_ENCOUNTER, encId);
      const onMsg = (payload: any) => {
        const id = `${Date.now()}-${messageIdCounter += 1}`;
        setMessages((prev) => [
          ...prev,
          { id, from: payload?.from || payload?.displayName || 'Someone', text: payload?.text || payload?.message || '' },
        ]);
      };
      sock.on(SOCKET_EVENTS.NEW_MESSAGE, onMsg);
      return () => {
        sock.off(SOCKET_EVENTS.NEW_MESSAGE, onMsg);
        unsubRemotes?.();
        try { vcRef.current?.leave(); } catch {}
        vcRef.current = null;
      };
    } catch {}
  }, [encId, squadId]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const aMembers = enc?.squadAMembers ?? [];
  const bMembers = enc?.squadBMembers ?? [];
  const tiles = [
    ...aMembers.map((m) => ({ id: m.memberId, name: m.displayName, squad: enc?.squadAName ?? 'Squad A' })),
    ...bMembers.map((m) => ({ id: m.memberId, name: m.displayName, squad: enc?.squadBName ?? 'Squad B' })),
  ];
  const displayTiles = tiles;

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

  const squadAName = enc?.squadAName ?? 'Your Squad';
  const squadBName = enc?.squadBName ?? 'Opponents';
  const stageWidth = Math.min(width, 760);
  const gridTileW = (stageWidth - SPACE.md * 2 - TILE_GAP) / 2;
  const tileWideW = stageWidth - SPACE.md * 2;

  return (
    <Screen>
      {/* ── Slim top bar ── */}
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <Text style={styles.topSquadA} numberOfLines={1}>{squadAName}</Text>
          <Text style={styles.topVs}>vs</Text>
          <Text style={styles.topSquadB} numberOfLines={1}>{squadBName}</Text>
        </View>
        <View style={styles.topRight}>
          <View style={styles.livePill}>
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Text style={styles.timer}>{fmt(elapsed)}</Text>
        </View>
      </View>

      {/* ── Mode tabs ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs}>
        {MODES.map((m) => (
          <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.tab, mode === m && styles.tabActive]}>
            <Text style={[styles.tabLabel, mode === m && styles.tabLabelActive]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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
            <View style={styles.videoErrorBanner}>
              <Text style={styles.videoErrorTitle}>Video unavailable</Text>
              <Text style={styles.videoErrorCopy}>{videoError}</Text>
            </View>
          ) : null}
          {mode === 'versus' ? (
            /* ── Versus: your side / opponent side, 16:9 tiles ── */
            <View style={styles.versusRow}>
              {/* Squad A */}
              <View style={styles.versusHalf}>
                {aMembers.map((m, i) => {
                  const color = TILE_COLORS[i % TILE_COLORS.length];
                  return (
                    <View key={m.memberId} style={[styles.versusTile, aMembers.length > 1 && styles.versusTileSmall]}>
                      <LinearGradient
                        colors={[color + '50', color + '18']}
                        style={styles.versusTileInner}
                      >
                        {i === 0 && cam && videoReady ? (
                          <RtcSurface style={StyleSheet.absoluteFill} canvas={{ uid: 0 }} />
                        ) : (
                          <Avatar name={m.displayName} size={aMembers.length > 1 ? 36 : 48} colorIndex={i} />
                        )}
                      </LinearGradient>
                      <View style={styles.tileNamePill}>
                        <Text style={styles.tileNameText} numberOfLines={1}>{m.displayName}</Text>
                        <View style={styles.micIndDot}>
                          <Icon.mic size={8} color="#3DD6C0" />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* VS divider */}
              <View style={styles.vsDivider}>
                <Text style={styles.vsText}>VS</Text>
              </View>

              {/* Squad B */}
              <View style={styles.versusHalf}>
                {bMembers.map((m, i) => {
                  const color = TILE_COLORS[(i + 2) % TILE_COLORS.length];
                  return (
                    <View key={m.memberId} style={[styles.versusTile, bMembers.length > 1 && styles.versusTileSmall]}>
                      <LinearGradient
                        colors={[color + '50', color + '18']}
                        style={styles.versusTileInner}
                      >
                        {remotes[i]?.hasVideo && videoReady ? (
                          <RtcSurface style={StyleSheet.absoluteFill} canvas={{ uid: remotes[i].uid }} />
                        ) : (
                          <Avatar name={m.displayName} size={bMembers.length > 1 ? 36 : 48} colorIndex={i + 2} />
                        )}
                      </LinearGradient>
                      <View style={styles.tileNamePill}>
                        <Text style={styles.tileNameText} numberOfLines={1}>{m.displayName}</Text>
                        <View style={[styles.micIndDot, styles.micIndRed]}>
                          <Icon.mic size={8} color={COLORS.coral} />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : (
            /* ── Grid / Spotlight / Focus: 16:9 tile grid ── */
            <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
              {displayTiles.map((tile, i) => {
                const color = TILE_COLORS[i % TILE_COLORS.length];
                const isSpotlight = mode === 'spotlight' && i === 0;
                const isFocus = mode === 'focus' && i === 0;
                const tileStyle = isSpotlight || isFocus
                  ? [styles.tileWide, { width: tileWideW }]
                  : [styles.tile, { width: gridTileW }];
                return (
                  <View key={tile.id} style={tileStyle}>
                    <LinearGradient
                      colors={[color + '40', color + '15']}
                      style={styles.tileGradientFill}
                    >
                      <Avatar name={tile.name} size={isSpotlight || isFocus ? 64 : 44} colorIndex={i} />
                    </LinearGradient>
                    <View style={styles.tileNamePill}>
                      <Text style={styles.tileNameText} numberOfLines={1}>{tile.name}</Text>
                      <Text style={styles.tileSquadText}>{tile.squad}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
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
  topSquadA: { fontSize: 13, fontWeight: '700', color: COLORS.violet, maxWidth: 90 },
  topVs: { fontSize: 11, color: COLORS.textDim, fontWeight: '600' },
  topSquadB: { fontSize: 13, fontWeight: '700', color: COLORS.coral, maxWidth: 90 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  livePill: { backgroundColor: COLORS.coral, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  liveText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  timer: { fontSize: 12, color: COLORS.textMuted, fontVariant: ['tabular-nums'] as any },

  // ── Mode tabs ──
  tabsScroll: { maxHeight: 44, flexShrink: 0 },
  tabs: { paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, gap: 8, flexDirection: 'row', alignItems: 'center' },
  tab: {
    paddingVertical: 5, paddingHorizontal: SPACE.md,
    borderRadius: 999, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  tabActive: { backgroundColor: 'rgba(124,92,255,0.12)', borderColor: COLORS.violet },
  tabLabel: { fontSize: 12, color: COLORS.textDim, fontWeight: '600', textTransform: 'capitalize' },
  tabLabelActive: { color: COLORS.violet },

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

  // Versus layout — 16:9 tiles
  versusRow: {
    flex: 1,
    flexDirection: 'row',
    padding: SPACE.sm,
    gap: TILE_GAP,
    alignItems: 'stretch',
  },
  versusHalf: { flex: 1, gap: TILE_GAP, justifyContent: 'center' },
  versusTile: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: COLORS.surface,
  },
  versusTileSmall: { aspectRatio: 16 / 9 },
  versusTileInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  vsDivider: { width: 28, alignItems: 'center', justifyContent: 'center' },
  vsText: { fontSize: 13, fontWeight: '900', color: COLORS.textDim, letterSpacing: 1 },

  // Grid tiles — 16:9
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    padding: SPACE.md, gap: TILE_GAP,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  tile: {
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: COLORS.surface,
  },
  tileWide: {
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: COLORS.surface,
    marginBottom: 0,
  },
  tileGradientFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
  tileSquadText: { fontSize: 9, color: COLORS.textDim },
  micIndDot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: 'rgba(61,214,192,0.8)',
    alignItems: 'center', justifyContent: 'center',
  },
  micIndRed: { backgroundColor: 'rgba(255,92,92,0.75)' },

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
