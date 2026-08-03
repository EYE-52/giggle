import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, subscribeNotifications, type AppNotification, type NotificationType } from '@giggle/core';
import { Icon } from './Icon';
import { COLORS, RADII, SPACE } from '../constants/theme';

const EXPIRED_INVITE_CODES = new Set(['SQUAD_NOT_FOUND', 'INVITE_ONLY']);

function relativeTime(value: string) {
  const created = Date.parse(value);
  if (!Number.isFinite(created)) return '';
  const minutes = Math.floor(Math.max(0, Date.now() - created) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function tintFor(type: NotificationType) {
  if (type === 'squad_invite') return '#38BDF8';
  if (type === 'join_request') return '#F59E0B';
  if (type === 'squad_joined') return COLORS.lime;
  return COLORS.violet;
}

function Action({
  label,
  onPress,
  loading,
  disabled,
  kind = 'neutral',
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  kind?: 'primary' | 'danger' | 'neutral';
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.action,
        kind === 'primary' && styles.actionPrimary,
        kind === 'danger' && styles.actionDanger,
        disabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={kind === 'primary' ? '#fff' : COLORS.text} />
      ) : (
        <Text style={[
          styles.actionText,
          kind === 'primary' && styles.actionTextPrimary,
          kind === 'danger' && styles.actionTextDanger,
        ]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function NotificationRow({
  notification,
  refresh,
  close,
}: {
  notification: AppNotification;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const tint = tintFor(notification.type);

  async function acceptFriend() {
    if (!notification.fromUserId || busy) return;
    setBusy('accept');
    setError('');
    try {
      await api.acceptFriend(notification.fromUserId);
      await refresh();
    } catch {
      setError("Couldn't accept this friend request.");
    } finally {
      setBusy('');
    }
  }

  async function declineFriend() {
    if (!notification.fromUserId || busy) return;
    setBusy('decline');
    setError('');
    try {
      await api.declineFriend(notification.fromUserId);
      await refresh();
    } catch {
      setError("Couldn't decline this friend request.");
    } finally {
      setBusy('');
    }
  }

  async function resolveJoinRequest(approve: boolean) {
    if (!notification.squadId || !notification.fromUserId || busy) return;
    setBusy(approve ? 'approve' : 'decline');
    setError('');
    try {
      if (approve) {
        await api.approveJoinRequest(notification.squadId, notification.fromUserId);
      } else {
        await api.declineJoinRequest(notification.squadId, notification.fromUserId);
      }
      await refresh();
    } catch {
      setError(`Couldn't ${approve ? 'approve' : 'decline'} this join request.`);
    } finally {
      setBusy('');
    }
  }

  async function joinSquad() {
    if (!notification.squadCode || busy) return;
    setBusy('join');
    setError('');
    try {
      const result = await api.joinSquad({ squadCode: notification.squadCode });
      if (!('squadId' in result)) {
        await api.dismissNotification(notification.id);
        await refresh();
        return;
      }
      await refresh();
      close();
      router.push(`/lobby?squad=${result.squadId}`);
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? '';
      if (EXPIRED_INVITE_CODES.has(code)) {
        try {
          await api.dismissNotification(notification.id);
          await refresh();
        } catch {
          setError("Invite expired, but couldn't remove it.");
        }
      } else {
        setError("Couldn't join this squad invite.");
      }
    } finally {
      setBusy('');
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy('dismiss');
    setError('');
    try {
      await api.dismissNotification(notification.id);
      await refresh();
    } catch {
      setError("Couldn't dismiss this notification.");
    } finally {
      setBusy('');
    }
  }

  return (
    <View style={[styles.row, !notification.read && styles.rowUnread]}>
      <View style={[styles.typeIcon, { backgroundColor: `${tint}24` }]}>
        <Icon.bell size={18} color={tint} />
        {!notification.read && <View style={[styles.unreadDot, { backgroundColor: tint }]} />}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowHeading}>
          <Text style={styles.rowTitle} numberOfLines={1}>{notification.title || 'Giggle update'}</Text>
          <Text style={styles.time}>{relativeTime(notification.createdAt)}</Text>
        </View>
        {!!notification.body && <Text style={styles.rowText}>{notification.body}</Text>}

        {notification.type === 'friend_request' && (
          <View style={styles.actions}>
            <Action label="Accept" onPress={() => void acceptFriend()} loading={busy === 'accept'} disabled={Boolean(busy)} kind="primary" />
            <Action label="Decline" onPress={() => void declineFriend()} loading={busy === 'decline'} disabled={Boolean(busy)} kind="danger" />
          </View>
        )}
        {notification.type === 'squad_invite' && (
          <View style={styles.actions}>
            <Action label="Join" onPress={() => void joinSquad()} loading={busy === 'join'} disabled={Boolean(busy)} kind="primary" />
            <Action label="Dismiss" onPress={() => void dismiss()} loading={busy === 'dismiss'} disabled={Boolean(busy)} />
          </View>
        )}
        {notification.type === 'join_request' && (
          <View style={styles.actions}>
            <Action label="Approve" onPress={() => void resolveJoinRequest(true)} loading={busy === 'approve'} disabled={Boolean(busy)} kind="primary" />
            <Action label="Decline" onPress={() => void resolveJoinRequest(false)} loading={busy === 'decline'} disabled={Boolean(busy)} kind="danger" />
          </View>
        )}
        {(notification.type === 'squad_joined' || notification.type === 'info') && (
          <View style={styles.actions}>
            <Action label="Dismiss" onPress={() => void dismiss()} loading={busy === 'dismiss'} disabled={Boolean(busy)} />
          </View>
        )}
        {!!error && <Text style={styles.rowError} accessibilityRole="alert">{error}</Text>}
      </View>
    </View>
  );
}

export function NotificationBell() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [panelError, setPanelError] = useState('');
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++loadSequence.current;
    try {
      const result = await api.listNotifications();
      if (request !== loadSequence.current) return;
      setItems(result.notifications);
      setUnread(result.unread);
      setError('');
    } catch {
      if (request === loadSequence.current) setError("Couldn't load notifications.");
    } finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeNotifications(() => void load(), () => void load());
  }, [load]);

  async function openNotifications() {
    setOpen(true);
    setPanelError('');
    void load();
    try {
      await api.markNotificationsRead();
      setUnread(0);
      setItems((current) => current.map((item) => ({ ...item, read: true })));
    } catch {
      setPanelError("Couldn't mark notifications read.");
    }
  }

  const badge = unread > 9 ? '9+' : String(unread);

  return (
    <>
      <TouchableOpacity
        onPress={() => void openNotifications()}
        style={styles.bell}
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        accessibilityHint={unread ? `${unread} unread` : 'No unread notifications'}
      >
        <Icon.bell size={23} color={COLORS.textMuted} />
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close notifications"
          />
          <View
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SPACE.md) }]}
            accessibilityViewIsModal
            accessibilityLabel="Notifications"
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Notifications</Text>
                <Text style={styles.sheetSubtitle}>{items.length ? `${items.length} recent` : 'Your updates appear here'}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Close notifications"
              >
                <Icon.close size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {!!panelError && <Text style={styles.panelError} accessibilityRole="alert">{panelError}</Text>}
            {loading ? (
              <View style={styles.state} accessibilityRole="progressbar">
                <ActivityIndicator color={COLORS.violet} />
                <Text style={styles.stateText}>Loading notifications…</Text>
              </View>
            ) : error ? (
              <View style={styles.state}>
                <Text style={styles.stateText}>{error}</Text>
                <Action label="Retry" onPress={() => void load()} loading={false} disabled={false} kind="primary" />
              </View>
            ) : items.length === 0 ? (
              <View style={styles.state}>
                <View style={styles.emptyIcon}><Icon.bell size={24} color={COLORS.textDim} /></View>
                <Text style={styles.stateTitle}>No notifications yet.</Text>
                <Text style={styles.stateText}>Squad invites and friend requests will show up here.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                {items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    refresh={load}
                    close={() => setOpen(false)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 3,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.coral,
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  badgeText: { color: '#fff', fontSize: 9, lineHeight: 11, fontWeight: '900' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  sheet: {
    maxHeight: '82%',
    minHeight: 300,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    backgroundColor: COLORS.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.sm,
  },
  sheetTitle: { color: COLORS.text, fontSize: 22, fontWeight: '900' },
  sheetSubtitle: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  panelError: { color: COLORS.coral, fontSize: 12, paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm },
  list: { gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm },
  row: {
    flexDirection: 'row',
    gap: SPACE.sm,
    padding: SPACE.md,
    borderRadius: RADII.tile,
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  rowUnread: { backgroundColor: 'rgba(124,92,255,0.08)' },
  typeIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowHeading: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  rowTitle: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '800' },
  time: { color: COLORS.textDim, fontSize: 11 },
  rowText: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
  action: {
    minWidth: 76,
    minHeight: 44,
    paddingHorizontal: SPACE.md,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  actionPrimary: { borderColor: COLORS.violet, backgroundColor: COLORS.violet },
  actionDanger: { borderColor: 'rgba(255,92,92,0.30)', backgroundColor: 'rgba(255,92,92,0.10)' },
  actionText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  actionTextPrimary: { color: '#fff' },
  actionTextDanger: { color: COLORS.coral },
  disabled: { opacity: 0.55 },
  rowError: { color: COLORS.coral, fontSize: 12, lineHeight: 17, marginTop: SPACE.sm },
  state: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.md,
    paddingHorizontal: SPACE.xl,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  stateTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  stateText: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
