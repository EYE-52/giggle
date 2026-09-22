import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { joinChat, mergeChatMessage, sendChatMessage, session, subscribeChat } from '@giggle/core';
import type { ChatMessage } from '@giggle/core';
import { Button } from './Button';
import { COLORS } from '../constants/theme';

export function LobbyChat({ squadId, onClose }: { squadId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const pending = useRef(false);
  const attempt = useRef<{ text: string; id: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    joinChat({ kind: 'lobby', squadId });
    const unsubscribe = subscribeChat(message => {
      if (message.squadId === squadId && !message.encounterId) setMessages(previous => mergeChatMessage(previous, message));
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, [squadId]);
  function send() {
    const text = draft.trim();
    if (!text || pending.current) return;
    if (attempt.current?.text !== text) attempt.current = { text, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    pending.current = true;
    setSending(true);
    setError('');
    const sent = sendChatMessage({ kind: 'lobby', squadId }, text,
      { id: session.user?.id ?? '', name: session.user?.name ?? 'You' },
      { clientMessageId: attempt.current.id, ack: result => {
        pending.current = false;
        if (!mounted.current) return;
        setSending(false);
        if (!result.ok) { setError(result.error); return; }
        setMessages(previous => mergeChatMessage(previous, result.message));
        setDraft(previous => previous.trim() === text ? '' : previous);
        attempt.current = null;
      } });
    if (!sent) { pending.current = false; setSending(false); setError('Couldn’t send. Try again.'); }
  }
  return <KeyboardAvoidingView style={{ flex: 1, padding: 20, gap: 14, backgroundColor: COLORS.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.text }}>Squad chat</Text><Button label="Back to lobby" variant="outline" onPress={onClose} /></View>
    <Text style={{ color: COLORS.textMuted }}>Only your squad can read these messages.</Text>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingVertical: 12 }} keyboardShouldPersistTaps="handled">
      {messages.length === 0 && <Text style={{ color: COLORS.textMuted }}>No messages yet.</Text>}
      {messages.map(message => <View key={message.id} style={{ padding: 12, borderRadius: 14, backgroundColor: COLORS.surface }}><Text style={{ color: COLORS.textMuted, fontSize: 12 }}>{message.userId === session.user?.id ? 'You' : message.name}</Text><Text style={{ color: COLORS.text, marginTop: 4 }}>{message.text}</Text></View>)}
    </ScrollView>
    {error ? <Text accessibilityRole="alert" style={{ color: COLORS.coral }}>{error}</Text> : null}
    <View style={{ flexDirection: 'row', gap: 8 }}><TextInput accessibilityLabel="Chat message" placeholder="Write a message" placeholderTextColor={COLORS.textMuted} value={draft} onChangeText={setDraft} maxLength={1000} style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, color: COLORS.text }} /><Button label={sending ? 'Sending…' : 'Send'} disabled={sending || !draft.trim()} onPress={send} /></View>
  </KeyboardAvoidingView>;
}
