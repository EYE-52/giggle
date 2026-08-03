import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../components/Screen';
import { VenueCard } from '../components/VenueCard';
import { COLORS, SPACE, RADII } from '../constants/theme';
import { api, randomSquadName, session, type PublicSquad } from '@giggle/core';
import { Button } from '../components/Button';

const FILTERS = ['All', 'Gaming', 'Casual', 'Chill', 'Competitive', 'Comedy', 'Late Night'];

function normalizeFilterParam(value?: string | string[]) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 'All';
  return FILTERS.find((filter) => filter.toLowerCase() === raw.toLowerCase()) ?? 'All';
}

export default function DiscoverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ vibe?: string }>();
  const initialFilter = normalizeFilterParam(params.vibe);
  const [filter, setFilter] = useState(initialFilter);
  const [squads, setSquads] = useState<PublicSquad[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  function ensureAuthed() {
    if (session.isAuthed()) return true;
    setActionError('Sign in to continue.');
    router.replace('/');
    return false;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.discoverSquads();
      setSquads(res.squads ?? []);
    } catch (e: any) {
      setLoadError(e?.message || "Couldn't load live squads.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    if (filter === 'All') return squads;
    return squads.filter((s) => (s.tags ?? []).some((t) => t.toLowerCase() === filter.toLowerCase()));
  }, [filter, squads]);

  async function joinSquad(squad: PublicSquad) {
    if (joiningId) return;
    if (!ensureAuthed()) return;
    setJoiningId(squad.squadId);
    setNotice('');
    setActionError('');
    try {
      const res = await api.joinSquadById(squad.squadId);
      if ('status' in res && res.status === "requested") {
        setNotice('Request sent. The leader will review it.');
      } else {
        router.push(`/lobby?squad=${res.squadId}`);
      }
    } catch (e: any) {
      setActionError(e?.message || "Couldn't join that squad.");
    } finally {
      setJoiningId(null);
    }
  }

  async function createFilteredSquad() {
    if (creating) return;
    if (!ensureAuthed()) return;
    setCreating(true);
    setNotice('');
    setActionError('');
    try {
      const squad = await api.createSquad({ squadName: randomSquadName(), tags: filter === 'All' ? [] : [filter] });
      router.push(`/lobby?squad=${squad.squadId}`);
    } catch (e: any) {
      setActionError(e?.message || "Couldn't create a squad.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Discover</Text>
        <Text style={styles.sub}>Join live squads ready to match.</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${f}`}
              accessibilityState={{ selected: filter === f }}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
        {loadError ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Couldn&apos;t load squads</Text>
            <Text style={styles.stateText}>{loadError}</Text>
            <Button label="Try again" onPress={load} variant="outline" style={styles.stateButton} />
          </View>
        ) : null}
        {loading && !loadError ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Finding live squads…</Text>
            <Text style={styles.stateText}>Checking who&apos;s ready to meet right now.</Text>
          </View>
        ) : null}
        {!loading && !loadError && shown.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>No squads in this vibe yet</Text>
            <Text style={styles.stateText}>Start a squad and set the tone yourself.</Text>
            <Button
              label={creating ? 'Creating…' : filter === 'All' ? 'Create a squad' : `Create ${filter} squad`}
              onPress={createFilteredSquad}
              variant="lime"
              disabled={creating}
              style={styles.stateButton}
            />
          </View>
        ) : null}

        <View style={styles.cards}>
          {shown.map((s) => (
            <View key={s.squadId} style={styles.cardWrap}>
              <VenueCard
                title={s.squadName}
                subtitle={`${s.memberCount}/${s.maxSlots} seats${s.joinPolicy === 'request' ? ' · leader approves' : ''}`}
                coverImage={s.coverImage}
                live={s.status === 'idle'}
                members={[s.leaderName || 'Leader']}
                extra={Math.max(0, s.memberCount - 1)}
              />
              <Button
                label={joiningId === s.squadId ? 'Joining…' : s.joinPolicy === 'request' ? 'Request to join' : 'Join squad'}
                onPress={() => joinSquad(s)}
                variant={s.joinPolicy === 'request' ? 'outline' : 'violet'}
                disabled={Boolean(joiningId)}
                style={styles.joinButton}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.lg, paddingTop: SPACE.xl },
  back: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center', marginBottom: SPACE.md },
  backText: { color: COLORS.violet, fontSize: 16, fontWeight: '600' },
  heading: { fontSize: 28, fontWeight: '900', color: COLORS.text, marginBottom: 4 },
  sub: { fontSize: 15, color: COLORS.textMuted, marginBottom: SPACE.lg },
  filtersScroll: { marginBottom: SPACE.xl },
  filters: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  filterChip: {
    minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: 'rgba(124,92,255,0.15)', borderColor: COLORS.violet },
  filterText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '600' },
  filterTextActive: { color: COLORS.violet },
  notice: {
    color: COLORS.lime,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACE.md,
    fontWeight: '700',
  },
  actionError: {
    color: COLORS.coral,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACE.md,
    fontWeight: '700',
  },
  stateCard: {
    borderRadius: RADII.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: SPACE.lg,
    marginBottom: SPACE.lg,
  },
  stateTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  stateText: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18 },
  stateButton: { marginTop: SPACE.md, alignSelf: 'flex-start' },
  cards: { gap: 16 },
  cardWrap: { gap: 10 },
  joinButton: { alignSelf: 'stretch' },
});
