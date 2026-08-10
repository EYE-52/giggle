import React, { useState } from 'react';
import { Alert, Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, session } from '@giggle/core';
import { Button } from './Button';
import { Card } from './Card';
import { Logomark } from './Logomark';
import { Screen } from './Screen';
import { COLORS, SPACE } from '../constants/theme';

const SUPPORT_URL = 'https://gigglemeet.com/support';

export function IdentityOnlyAccount({ onReturnToVerification }: { onReturnToVerification?: () => void }) {
  const router = useRouter();
  const pendingDeletion = session.accountStatus === 'pending_deletion';
  const unavailable = session.accountStatus === 'unavailable';
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  function signOut() {
    session.signOut();
    router.replace('/');
  }

  async function exportAccountData() {
    if (exporting) return;
    setExporting(true);
    setError('');
    try {
      const data = await api.exportAccount();
      await Share.share({ title: 'Giggle account data', message: JSON.stringify(data, null, 2) });
    } catch {
      setError("Couldn't export your data. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteAccount();
      signOut();
    } catch {
      setError("Couldn't start account deletion. Please try again.");
      setDeleting(false);
    }
  }

  function confirmDeletion() {
    Alert.alert('Delete account?', 'Deletion revokes access immediately and may finish in the background.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        style: 'destructive',
        onPress: () => Alert.alert('Delete permanently?', 'Your account cannot be restored after cleanup completes.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete account', style: 'destructive', onPress: () => void deleteAccount() },
        ]),
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Logomark size={44} />
        <Text style={styles.eyebrow}>{pendingDeletion ? 'DELETION PENDING' : unavailable ? 'ACCOUNT UNAVAILABLE' : 'ACCOUNT & DATA'}</Text>
        <Text style={styles.title}>Your account controls remain available</Text>
        <Text style={styles.copy}>
          {pendingDeletion
            ? 'Your deletion request is being processed. Social features stay disabled while cleanup finishes.'
            : unavailable
              ? 'Social features are disabled for this account. You can still contact support, export your data, or delete your account.'
              : 'Social features stay disabled until age verification is complete. Your account controls remain available.'}
        </Text>
        <Card style={styles.card}>
          <Text style={styles.email}>{session.user?.email || 'Signed-in account'}</Text>
          <Button label="Contact support" variant="outline" onPress={() => void Linking.openURL(SUPPORT_URL).catch(() => setError("Couldn't open support."))} />
          <Button label={exporting ? 'Preparing export…' : 'Share my data'} variant="outline" disabled={exporting || deleting} onPress={() => void exportAccountData()} />
          <Button label={deleting ? 'Deleting…' : 'Delete account'} variant="coral" disabled={exporting || deleting} onPress={confirmDeletion} />
        </Card>
        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        {onReturnToVerification && <Button label="Return to age verification" variant="outline" onPress={onReturnToVerification} />}
        <Button label="Sign out" variant="outline" onPress={signOut} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: SPACE.xl, gap: SPACE.md },
  eyebrow: { color: COLORS.violet, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginTop: SPACE.md },
  title: { color: COLORS.text, fontSize: 30, lineHeight: 35, fontWeight: '800' },
  copy: { color: COLORS.textMuted, fontSize: 15, lineHeight: 22 },
  card: { gap: SPACE.md, marginTop: SPACE.sm },
  email: { color: COLORS.textMuted, fontSize: 14 },
  error: { color: COLORS.coral, fontSize: 13 },
});
