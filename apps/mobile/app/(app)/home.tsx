import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { api, formatSquadCodeInput, isValidSquadCode, session } from '@giggle/core';
import type { MySquadLite } from '@giggle/core';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { NotificationBell } from '../../components/NotificationBell';
import { Wordmark } from '../../components/Wordmark';
import { COLORS, RADII, SPACE } from '../../constants/theme';
import { NATIVE_DISCOVERY_ENABLED } from '../../constants/discovery';

const ACTIVE_STATUSES = ['searching', 'matched', 'in_encounter'];
function squadDestination(squad: MySquadLite) {
  if (!NATIVE_DISCOVERY_ENABLED) return `/lobby?squad=${squad.squadId}`;
  return ['searching', 'matched', 'in_encounter'].includes(squad.status) ? `/matchmaking?squad=${squad.squadId}` : `/lobby?squad=${squad.squadId}`;
}
function readableStatus(status: string) { if (status === 'in_encounter') return 'In a live encounter'; if (status === 'searching') return 'Looking for a squad'; if (status === 'matched') return 'Match found'; return 'Ready to play'; }

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ create?: string }>();
  const [joinCode, setJoinCode] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [squadName, setSquadName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const actionRef = useRef<'create' | 'join' | null>(null);
  const loadRef = useRef(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [mySquads, setMySquads] = useState<MySquadLite[] | null>(null);
  useEffect(() => {
    if (params.create === '1') { setSquadName(''); setCreateOpen(true); }
  }, [params.create]);
  const [loadError, setLoadError] = useState('');

  const loadSquads = useCallback(async () => {
    if (loadRef.current) return;
    loadRef.current = true;
    setLoadError('');
    try {
      const { squads: next } = await api.mySquads();
      setMySquads([...next].sort((a, b) => Number(ACTIVE_STATUSES.includes(b.status)) - Number(ACTIVE_STATUSES.includes(a.status)) || a.squadName.localeCompare(b.squadName)));
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "Couldn't load your squads.");
    } finally { loadRef.current = false; }
  }, []);
  useEffect(() => { void loadSquads(); }, [loadSquads]);
  useFocusEffect(useCallback(() => { void loadSquads(); }, [loadSquads]));
  useEffect(() => {
    if (!pendingJoinCode) return;
    let cancelled = false;
    const check = async () => {
      try {
        const result = await api.mySquads();
        const joined = result.squads.find(squad => squad.squadCode === pendingJoinCode);
        if (joined && !cancelled) { setPendingJoinCode(null); router.replace(`/lobby?squad=${joined.squadId}`); }
      } catch { /* Keep waiting and retry. */ }
    };
    void check();
    const timer = setInterval(check, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pendingJoinCode]);
  const activeSquad = useMemo(() => mySquads?.find((squad) => ACTIVE_STATUSES.includes(squad.status)) ?? mySquads?.[0], [mySquads]);
  const otherSquads = useMemo(() => mySquads?.filter((squad) => squad.squadId !== activeSquad?.squadId) ?? [], [activeSquad?.squadId, mySquads]);

  function ensureAuthed() { if (session.isAuthed()) return true; setActionError('Sign in to continue.'); router.replace('/'); return false; }
  async function createSquad() {
    if (actionRef.current) return;
    if (!ensureAuthed()) return;
    if (!squadName.trim()) { setActionError('Give your squad a name.'); return; }
    actionRef.current = 'create'; setCreating(true); setActionError(''); setActionNotice('');
    try { const squad = await api.createSquad({ squadName: squadName.trim(), tags: [] }); setCreateOpen(false); router.push(`/lobby?squad=${squad.squadId}`); }
    catch (error: unknown) { setActionError(error instanceof Error ? error.message : "Couldn't create a squad. Please try again."); }
    finally { actionRef.current = null; setCreating(false); }
  }
  async function joinSquad() {
    if (actionRef.current) return;
    const code = formatSquadCodeInput(joinCode); setJoinCode(code);
    if (!isValidSquadCode(code)) { setActionError('Enter a code like ABC-123.'); return; }
    if (!ensureAuthed()) return;
    actionRef.current = 'join'; setJoining(true); setActionError(''); setActionNotice('');
    try { const result = await api.joinSquad({ squadCode: code }); if ('status' in result && result.status === 'requested') { setActionNotice('Request sent. You will enter if the leader approves.'); setPendingJoinCode(code); } else if ('squadId' in result) router.push(`/lobby?squad=${result.squadId}`); }
    catch (error: unknown) { setActionError(error instanceof Error ? error.message : "Couldn't join that squad. Check the code and try again."); }
    finally { actionRef.current = null; setJoining(false); }
  }

  return <Screen><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <View style={styles.topNav}><Wordmark size={22} /><View style={styles.topActions}><NotificationBell /><TouchableOpacity style={styles.iconButton} onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel="Open account"><Icon.profile size={21} color={COLORS.text} /></TouchableOpacity></View></View>
    <Text style={styles.eyebrow}>YOUR SQUAD</Text><Text style={styles.title}>Meet another squad.</Text><Text style={styles.subtitle}>{NATIVE_DISCOVERY_ENABLED ? 'Join a group video call with your friends.' : 'Create a private room and invite your friends.'}</Text>
    <Card style={styles.createCard}><View style={styles.cardIcon}><Icon.plus size={22} color={COLORS.surface} /></View><Text style={styles.cardTitle}>Create a squad</Text><Text style={styles.cardBody}>{NATIVE_DISCOVERY_ENABLED ? 'Invite friends and meet another squad.' : 'Invite friends to a private room.'}</Text><Button label={creating ? 'Creating…' : 'Create squad'} onPress={() => { setSquadName(''); setActionError(''); setCreateOpen(true); }} disabled={creating} style={styles.createButton} /></Card>
    <Card style={styles.joinCard}><Text style={styles.sectionTitle}>Have an invite code?</Text><View style={styles.joinRow}><TextInput value={joinCode} onChangeText={(value) => { setJoinCode(formatSquadCodeInput(value)); setActionError(''); }} onSubmitEditing={() => void joinSquad()} placeholder="ABC-123" placeholderTextColor={COLORS.textDim} autoCapitalize="characters" autoCorrect={false} spellCheck={false} style={styles.codeInput} accessibilityLabel="Squad invite code" /><TouchableOpacity onPress={() => void joinSquad()} disabled={joining || !isValidSquadCode(joinCode)} style={[styles.joinButton, (!isValidSquadCode(joinCode) || joining) && styles.disabled]} accessibilityRole="button" accessibilityLabel="Join squad"><Text style={styles.joinButtonText}>{joining ? '…' : 'Join'}</Text></TouchableOpacity></View>{actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}{actionNotice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{actionNotice}</Text> : null}</Card>
    {loadError ? <Card style={styles.stateCard}><Text style={styles.error}>{loadError}</Text><TouchableOpacity onPress={() => { setMySquads(null); void loadSquads(); }} style={styles.retry} accessibilityRole="button" accessibilityLabel="Retry loading squads"><Text style={styles.retryText}>Try again</Text></TouchableOpacity></Card> : mySquads === null ? <View style={styles.state}><ActivityIndicator color={COLORS.violet} /><Text style={styles.stateText}>Loading your squads…</Text></View> : activeSquad ? <View style={styles.squadsBlock}><Text style={styles.sectionLabel}>Pick up where you left off</Text><TouchableOpacity onPress={() => router.push(squadDestination(activeSquad))} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`Resume ${activeSquad.squadName}`}><Card style={styles.activeCard}><View style={styles.activeTop}><View style={styles.squadMark}><Text style={styles.squadMarkText}>{activeSquad.squadName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.cardCopy}><Text style={styles.activeName} numberOfLines={1}>{activeSquad.squadName}</Text><Text style={styles.activeStatus}>{readableStatus(activeSquad.status)}</Text></View><Icon.chevron size={20} color={COLORS.textDim} /></View><View style={styles.activeFooter}><Text style={styles.memberText}>{activeSquad.memberCount}/{activeSquad.maxSlots} members</Text><Text style={styles.resumeText}>{ACTIVE_STATUSES.includes(activeSquad.status) ? 'Open match' : 'Open lobby'}  →</Text></View></Card></TouchableOpacity>{otherSquads.length > 0 ? <Text style={[styles.sectionLabel, styles.otherLabel]}>Your other squads</Text> : null}{otherSquads.map((squad) => <TouchableOpacity key={squad.squadId} onPress={() => router.push(squadDestination(squad))} style={styles.otherRow} accessibilityRole="button" accessibilityLabel={`Open ${squad.squadName}`}><View style={styles.smallMark}><Text style={styles.smallMarkText}>{squad.squadName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.cardCopy}><Text style={styles.otherName} numberOfLines={1}>{squad.squadName}</Text><Text style={styles.otherMeta}>{squad.memberCount}/{squad.maxSlots} members · {readableStatus(squad.status)}</Text></View><Icon.chevron size={18} color={COLORS.textDim} /></TouchableOpacity>)}</View> : <View style={styles.empty}><Text style={styles.emptyTitle}>Your first squad starts here.</Text><Text style={styles.stateText}>Create one above, or join a friend with their code.</Text></View>}
    {NATIVE_DISCOVERY_ENABLED ? <TouchableOpacity onPress={() => router.push('/discover')} style={styles.discoverLink} accessibilityRole="button" accessibilityLabel="Browse live squads"><Icon.discover size={18} color={COLORS.violet} /><Text style={styles.discoverText}>Browse live squads</Text><Icon.chevron size={18} color={COLORS.violet} /></TouchableOpacity> : null}
  </ScrollView></KeyboardAvoidingView>
  <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => { if (!creating) setCreateOpen(false); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.35)', justifyContent: 'center', padding: 20 }}><View style={{ padding: 22, borderRadius: 20, backgroundColor: COLORS.surface, gap: 16 }}><Text style={styles.cardTitle}>Create a squad</Text><Text style={styles.cardBody}>Give your squad a name. Invite friends next.</Text><TextInput autoFocus accessibilityLabel="Squad name" value={squadName} onChangeText={setSquadName} maxLength={40} placeholder="Squad name" placeholderTextColor={COLORS.textMuted} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, minHeight: 48, color: COLORS.text }} />{actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}<Button label={creating ? 'Creating…' : 'Create squad'} disabled={creating} onPress={() => void createSquad()} /><Button label="Cancel" disabled={creating} variant="outline" onPress={() => setCreateOpen(false)} /></View></KeyboardAvoidingView>
  </Modal></Screen>;
}

const styles = StyleSheet.create({ flex: { flex: 1 }, scroll: { padding: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.xxl }, topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.xl }, topActions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }, iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }, eyebrow: { color: COLORS.violet, fontSize: 11, fontWeight: '800', letterSpacing: 1.1, marginBottom: SPACE.sm }, title: { color: COLORS.text, fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 }, subtitle: { color: COLORS.textMuted, fontSize: 15, lineHeight: 21, marginTop: SPACE.sm, marginBottom: SPACE.xl, maxWidth: 330 }, createCard: { backgroundColor: COLORS.violetSoft, borderColor: COLORS.violetSoft, padding: SPACE.lg, marginBottom: SPACE.md }, cardIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.violet, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.md }, cardCopy: { flex: 1, minWidth: 0 }, cardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800' }, cardBody: { color: COLORS.textMuted, fontSize: 14, lineHeight: 19, marginTop: 3, marginBottom: SPACE.md }, createButton: { alignSelf: 'stretch', backgroundColor: COLORS.violet }, joinCard: { padding: SPACE.lg, marginBottom: SPACE.xl }, sectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: SPACE.md }, joinRow: { flexDirection: 'row', gap: SPACE.sm }, codeInput: { flex: 1, height: 48, borderRadius: RADII.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg, color: COLORS.text, paddingHorizontal: SPACE.md, fontSize: 15, letterSpacing: 1.5 }, joinButton: { height: 48, minWidth: 72, borderRadius: RADII.input, backgroundColor: COLORS.text, alignItems: 'center', justifyContent: 'center' }, joinButtonText: { color: COLORS.surface, fontWeight: '800', fontSize: 15 }, disabled: { opacity: 0.4 }, notice: { color: COLORS.lime, fontSize: 13, lineHeight: 18, marginTop: SPACE.sm }, error: { color: COLORS.coral, fontSize: 13, lineHeight: 18, marginTop: SPACE.sm }, state: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 52 }, stateText: { color: COLORS.textMuted, fontSize: 14 }, stateCard: { padding: SPACE.md, marginBottom: SPACE.md }, retry: { minHeight: 42, justifyContent: 'center', alignSelf: 'flex-start' }, retryText: { color: COLORS.violet, fontWeight: '800', fontSize: 14 }, squadsBlock: { marginTop: SPACE.sm }, sectionLabel: { color: COLORS.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: SPACE.sm }, activeCard: { padding: SPACE.lg, backgroundColor: COLORS.surface, marginBottom: SPACE.md }, activeTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md }, squadMark: { width: 48, height: 48, borderRadius: 16, backgroundColor: COLORS.limeSoft, alignItems: 'center', justifyContent: 'center' }, squadMarkText: { color: COLORS.lime, fontSize: 20, fontWeight: '800' }, activeName: { color: COLORS.text, fontSize: 17, fontWeight: '800' }, activeStatus: { color: COLORS.textMuted, fontSize: 13, marginTop: 3 }, activeFooter: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: SPACE.md, paddingTop: SPACE.md }, memberText: { color: COLORS.textMuted, fontSize: 13 }, resumeText: { color: COLORS.violet, fontSize: 13, fontWeight: '800' }, otherLabel: { marginTop: SPACE.md }, otherRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }, smallMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: COLORS.violetSoft, alignItems: 'center', justifyContent: 'center' }, smallMarkText: { color: COLORS.violet, fontWeight: '800' }, otherName: { color: COLORS.text, fontWeight: '700', fontSize: 14 }, otherMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 }, empty: { paddingVertical: SPACE.lg, alignItems: 'center' }, emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginBottom: SPACE.xs }, discoverLink: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xl, paddingHorizontal: SPACE.md, borderRadius: RADII.input, backgroundColor: COLORS.limeSoft }, discoverText: { color: COLORS.violet, fontSize: 14, fontWeight: '800', flex: 1 } });
