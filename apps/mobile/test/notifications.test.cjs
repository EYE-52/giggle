const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const componentPath = path.join(__dirname, '../components/NotificationBell.tsx');
const componentSource = () => existsSync(componentPath) ? readFileSync(componentPath, 'utf8') : '';
const homeSource = () => readFileSync(path.join(__dirname, '../app/(app)/home.tsx'), 'utf8');

test('mobile home exposes notifications in its existing header', () => {
  const home = homeSource();
  const bell = componentSource();

  assert.equal(existsSync(componentPath), true);
  assert.equal(home.includes("import { NotificationBell } from '../../components/NotificationBell';"), true);
  assert.equal(home.includes('<NotificationBell />'), true);
  assert.equal(bell.includes('accessibilityLabel="Notifications"'), true);
  assert.equal(bell.includes('<Modal'), true);
  assert.equal(bell.includes('No notifications yet.'), true);
  assert.equal(bell.includes("Couldn't load notifications."), true);
});

test('mobile notifications load from the server and stay live', () => {
  const bell = componentSource();

  assert.equal(bell.includes('api.listNotifications()'), true);
  assert.equal(bell.includes('subscribeNotifications('), true);
  assert.equal(bell.includes('api.markNotificationsRead()'), true);
  assert.equal(bell.includes('void load();'), true);
});

test('mobile squad invites join only through an explicit action and expire safely', () => {
  const bell = componentSource();

  assert.equal(bell.includes("notification.type === 'squad_invite'"), true);
  assert.equal(bell.includes('await api.joinSquad({ squadCode: notification.squadCode })'), true);
  assert.equal(bell.includes("router.push(`/lobby?squad=${result.squadId}`)"), true);
  assert.equal(bell.includes("const EXPIRED_INVITE_CODES = new Set(['SQUAD_NOT_FOUND', 'INVITE_ONLY'])"), true);
  assert.equal(bell.includes('await api.dismissNotification(notification.id)'), true);
  assert.equal(bell.includes("notification.type === 'squad_invite' && !notification.read"), false);
});

test('mobile notification sheet resolves friend and join requests without dead screens', () => {
  const bell = componentSource();

  assert.equal(bell.includes('await api.acceptFriend(notification.fromUserId)'), true);
  assert.equal(bell.includes('await api.declineFriend(notification.fromUserId)'), true);
  assert.equal(bell.includes('await api.approveJoinRequest(notification.squadId, notification.fromUserId)'), true);
  assert.equal(bell.includes('await api.declineJoinRequest(notification.squadId, notification.fromUserId)'), true);
  assert.equal(bell.includes("notification.type === 'friend_request' && !notification.read"), false);
  assert.equal(bell.includes("notification.type === 'join_request' && !notification.read"), false);
});

test('mobile notification rows lock sibling actions while one request is running', () => {
  const bell = componentSource();

  assert.equal(bell.includes('disabled={Boolean(busy)}'), true);
  assert.equal(bell.includes("loading={busy === 'accept'}"), true);
  assert.equal(bell.includes("loading={busy === 'join'}"), true);
  assert.equal(bell.includes("loading={busy === 'approve'}"), true);
});

test('mobile notification sheet has a real backdrop instead of a dead press target', () => {
  const bell = componentSource();

  assert.equal(bell.includes('style={styles.backdrop}'), true);
  assert.equal(bell.includes('onPress={() => {}}'), false);
});
