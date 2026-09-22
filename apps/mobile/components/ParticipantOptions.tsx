import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type PersonalFraming = { fit: 'fit' | 'crop'; zoom: number };
export function ParticipantOptions({ name, isLocal, hasVideo, mutedForMe, onMute, framing, onFraming, onClose, onFocus, focused }: {
  name: string; isLocal: boolean; hasVideo: boolean; mutedForMe: boolean;
  onMute?: (muted: boolean) => Promise<void>; framing: PersonalFraming; onFraming: (next: PersonalFraming) => void;
  onClose: () => void; onFocus: () => void; focused: boolean;
}) {
  const [adjusting, setAdjusting] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const insets = useSafeAreaInsets();
  async function mute() {
    if (!onMute || pending) return;
    setPending(true); setError('');
    try { await onMute(!mutedForMe); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not change audio. Try again.'); }
    finally { setPending(false); }
  }
  const action = (label: string, onPress: () => void, disabled = false, detail?: string) => <Pressable accessibilityRole="button" accessibilityLabel={label === "−" ? "Zoom out" : label === "+" ? "Zoom in" : label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.action, disabled && s.disabled]}><Text style={s.actionText}>{label}</Text>{detail && <Text style={s.detail}>{detail}</Text>}</Pressable>;
  return <Modal transparent visible animationType="none" onRequestClose={onClose}>
    <View style={s.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
      <View accessibilityViewIsModal style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={s.header}><Text style={s.title}>{adjusting ? `${isLocal ? 'Your' : `${name}'s`} view` : isLocal ? 'You' : name}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close person options" onPress={onClose} style={s.close}><Text style={s.actionText}>×</Text></Pressable></View>
        <ScrollView>
          {adjusting ? <>
            <Text style={s.detail}>Adjust what you see. Everyone else’s view stays the same.</Text>
            <View style={s.fit}>{(['fit', 'crop'] as const).map(fit => <Pressable key={fit} accessibilityRole="button" accessibilityState={{ selected: framing.fit === fit }} onPress={() => onFraming({ fit, zoom: 1 })} style={[s.fitButton, framing.fit === fit && s.selected]}><Text style={s.actionText}>{fit === 'fit' ? 'Full view' : 'Fill'}</Text></Pressable>)}</View>
            <View style={s.zoom}>{action('−', () => onFraming({ ...framing, zoom: Math.max(1, Math.round((framing.zoom - .1) * 10) / 10) }), framing.zoom <= 1)}<Text style={s.actionText}>Zoom · {framing.zoom.toFixed(1)}×</Text>{action('+', () => onFraming({ ...framing, zoom: Math.min(2.5, Math.round((framing.zoom + .1) * 10) / 10) }), framing.zoom >= 2.5)}</View>
            {action('Reset view', () => onFraming({ fit: 'crop', zoom: 1 }))}
            {action('Back to person options', () => setAdjusting(false))}
          </> : <>
            {action('Adjust view', () => setAdjusting(true), !hasVideo, !hasVideo ? 'Camera off' : undefined)}
            {!isLocal && action(pending ? 'Updating…' : mutedForMe ? 'Unmute for me' : 'Mute for me', () => void mute(), !onMute || pending)}
            {action(focused ? 'Back to grid' : 'Focus on this person', () => { onClose(); onFocus(); })}
            {!isLocal && action('Enhance voice', () => {}, true, 'Not available yet')}
            {!isLocal && <Text style={s.detail}>Listening changes affect only you.</Text>}
          </>}
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0005', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#faf7f2', padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '85%', width: '100%', maxWidth: 460, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#292824' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  action: { minHeight: 48, padding: 12, borderRadius: 10, justifyContent: 'center' },
  actionText: { color: '#292824', fontSize: 14 }, detail: { color: '#756f66', fontSize: 12, lineHeight: 19 },
  disabled: { opacity: .55 }, error: { color: '#ac392c', fontSize: 14, padding: 12 },
  fit: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: '#eae5dd', marginVertical: 16 },
  fitButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  selected: { backgroundColor: '#fffdf9' }, zoom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
