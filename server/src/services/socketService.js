const { Squad } = require('../models/Squad');
const { Encounter } = require('../models/Encounter');
const SafetyReport = require('../models/SafetyReport');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { randomBase36 } = require('../utils/random');
const { buildAllowedOrigins } = require('../config/corsOrigins');
const {
  authorizeEncounterRoomJoin,
  authorizeRealtimeSend,
  authorizeSquadReport,
  authorizeSquadRoomJoin,
  normalizeRealtimeId,
  resolveReportTargetSquadId,
} = require('../utils/socketAccess');
const { firstDisplayName } = require('../utils/identityValidation');
const { classifyVibe } = require('../utils/moderation');
const { isMongoObjectIdString } = require('../middlewares/authMiddleware');
const { hasAdultAccess } = require('./ageAccessService');
const { claimOrGetChatMessage } = require('./chatDeliveryService');

let io;
const MAX_CHAT_TEXT_LENGTH = 500;
const CHAT_RATE_LIMIT = { limit: 20, windowMs: 10_000 };
const REACTION_RATE_LIMIT = { limit: 30, windowMs: 10_000 };
const REPORT_RATE_LIMIT = { limit: 3, windowMs: 60_000 };
const REPORT_CATEGORIES = new Set(['harassment', 'hate', 'sexual', 'minor_safety', 'spam', 'other']);
const REPORT_UNAVAILABLE = { ok: false, error: 'Report unavailable.' };

const isRealtimeDebugEnabled = (env = process.env) => {
  return env.REALTIME_DEBUG === 'true' || env.NODE_ENV !== 'production';
};

const logRealtimeDebug = (...args) => {
  if (isRealtimeDebugEnabled()) console.log(...args);
};

const normalizeChatText = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
};

const resolveSocketSenderName = (...values) => firstDisplayName(...values);

const normalizeSocketIdentity = (decoded = {}) => {
  const userId = decoded.userId || decoded.sub;
  if (!isMongoObjectIdString(userId)) return null;
  return {
    userId,
    userName: firstDisplayName(decoded.name, decoded.email) || null,
  };
};

const resolveSocketAuthToken = ({ auth, query } = {}, isProduction = process.env.NODE_ENV === "production") => {
  if (auth && Object.prototype.hasOwnProperty.call(auth, 'token')) return auth.token;
  return isProduction ? undefined : query?.token;
};

const authenticateSocket = async (socket, next) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const token = resolveSocketAuthToken(socket.handshake, process.env.NODE_ENV === 'production');

  if (token === undefined) {
    if (!isDevelopment) return next(new Error('UNAUTHORIZED'));
    socket.userId = null;
    socket.userName = null;
    console.warn(`[socket] connection ${socket.id} without auth token (dev mode)`);
    return next();
  }

  let identity;
  try {
    identity = normalizeSocketIdentity(jwt.verify(token, process.env.JWT_SECRET));
  } catch (error) {
    console.warn(`[socket] connection ${socket.id} with invalid token: ${error.message}`);
    return next(new Error('UNAUTHORIZED'));
  }
  if (!identity) return next(new Error('UNAUTHORIZED'));

  let user;
  try {
    user = await User.findById(identity.userId).select(
      'ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus'
    );
  } catch (error) {
    console.error('[socket] adult authorization lookup failed:', error);
    return next(new Error('UNAUTHORIZED'));
  }
  if (!user || !hasAdultAccess(user)) return next(new Error('UNAUTHORIZED'));

  socket.userId = identity.userId;
  socket.userName = identity.userName;
  return next();
};

const normalizeReactionEmoji = (value) => {
  if (typeof value !== 'string') return '';
  const emoji = value.trim();
  if (!emoji || emoji.length > 16) return '';
  if (/[\p{Letter}\p{Number}<>{}[\]\\/@#$%^&*_+=|~`]/u.test(emoji)) return '';
  if (!/\p{Emoji}/u.test(emoji)) return '';
  return emoji;
};

const createSocketRateLimiter = ({ limit, windowMs }) => {
  const buckets = new Map();

  return {
    allow(key, now = Date.now()) {
      const id = String(key || '');
      if (!id) return false;

      const current = buckets.get(id);
      if (!current || now - current.windowStart >= windowMs) {
        buckets.set(id, { windowStart: now, count: 1 });
        return true;
      }

      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
    forget(key) {
      buckets.delete(String(key || ''));
    },
  };
};

const chatLimiter = createSocketRateLimiter(CHAT_RATE_LIMIT);
const reactionLimiter = createSocketRateLimiter(REACTION_RATE_LIMIT);
const reportLimiter = createSocketRateLimiter(REPORT_RATE_LIMIT);

const normalizeReportDetails = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 500 ? normalized : null;
};

const persistSquadReport = async ({
  payload: rawPayload = {},
  userId,
  Squad: SquadModel = Squad,
  Encounter: EncounterModel = Encounter,
  ReportModel = SafetyReport,
}) => {
  const payload = rawPayload && !Array.isArray(rawPayload) && typeof rawPayload === 'object'
    ? rawPayload
    : {};
  const category = payload.category ?? 'other';
  const details = normalizeReportDetails(payload.details);
  if (!REPORT_CATEGORIES.has(category) || details === null) return REPORT_UNAVAILABLE;

  const filter = {
    reporterUserId: String(userId || ''),
    encounterId: normalizeRealtimeId(payload.encounterId),
    targetSquadId: resolveReportTargetSquadId(payload),
  };
  if (!filter.reporterUserId || !filter.encounterId || !filter.targetSquadId) return REPORT_UNAVAILABLE;

  if (typeof ReportModel.findOne === 'function') {
    const existing = await ReportModel.findOne(filter);
    const existingId = String(existing?._id ?? existing?.id ?? '');
    if (existingId) return { ok: true, reportId: existingId, status: 'open' };
  }

  const scope = await authorizeSquadReport({
    payload,
    userId,
    Squad: SquadModel,
    Encounter: EncounterModel,
  });
  if (!scope.allowed) return REPORT_UNAVAILABLE;

  const targetSquad = await SquadModel.findOne({ squadId: scope.targetSquadId });
  const targetUserIds = [...new Set(
    (targetSquad?.members || [])
      .map((member) => String(member?.userId || '').trim())
      .filter(Boolean)
  )];
  if (targetUserIds.length === 0) return REPORT_UNAVAILABLE;

  const update = {
    $setOnInsert: {
      ...filter,
      reporterSquadId: normalizeRealtimeId(payload.squadId),
      targetUserIds,
      category,
      details,
      status: 'open',
    },
  };

  let report;
  try {
    report = await ReportModel.findOneAndUpdate(
      filter,
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
  } catch (error) {
    if (error?.code !== 11000 || typeof ReportModel.findOne !== 'function') throw error;
    report = await ReportModel.findOne(filter);
  }
  const reportId = String(report?._id ?? report?.id ?? '');
  if (!reportId) throw new Error('Safety report persistence returned no record');
  return { ok: true, reportId, status: 'open' };
};

// ── Online presence (Redis-backed) ──────────────────────────────────────────
// A user is online while at least one active socket key exists in Redis. This
// keeps friends, squad rosters, and matchmaking liveness correct across server
// replicas using the same Redis deployment as the Socket.IO adapter.
const PRESENCE_TTL_SECONDS = 90;
const PRESENCE_REFRESH_MS = 30_000;
const PRESENCE_USER_PREFIX = "presence:user:";
const PRESENCE_SOCKET_PREFIX = "presence:socket:";

const getRedisClient = () => require('../config/redisConfig').redis;

const presenceUserKey = (userId) => `${PRESENCE_USER_PREFIX}${userId}`;
const presenceSocketKey = (socketId) => `${PRESENCE_SOCKET_PREFIX}${socketId}`;

async function markUserOnline(userId, socketId, redis = getRedisClient()) {
  if (!userId || !socketId) return;
  const userKey = presenceUserKey(userId);
  const socketKey = presenceSocketKey(socketId);
  await redis.sadd(userKey, socketId);
  await redis.expire(userKey, PRESENCE_TTL_SECONDS);
  await redis.set(socketKey, userId, "EX", PRESENCE_TTL_SECONDS);
}

async function markUserOffline(userId, socketId, redis = getRedisClient()) {
  if (!userId || !socketId) return;
  await redis.srem(presenceUserKey(userId), socketId);
  await redis.del(presenceSocketKey(socketId));
}

/** Is the given userId currently connected (>=1 live socket key)? */
async function isUserOnline(userId, redis = getRedisClient()) {
  const normalizedUserId = String(userId || '');
  if (!normalizedUserId) return false;

  const socketIds = await redis.smembers(presenceUserKey(normalizedUserId));
  if (!socketIds.length) return false;

  const pipe = redis.pipeline();
  for (const socketId of socketIds) pipe.exists(presenceSocketKey(socketId));
  const results = await pipe.exec();

  const staleSocketIds = [];
  let online = false;
  results.forEach(([, exists], index) => {
    if (exists) online = true;
    else staleSocketIds.push(socketIds[index]);
  });

  if (staleSocketIds.length) {
    await redis.srem(presenceUserKey(normalizedUserId), ...staleSocketIds);
  }
  return online;
}

/** Given an array of userIds, return a Set of those currently online. */
async function getOnlineUserIds(ids = [], redis = getRedisClient()) {
  const uniqueIds = [...new Set(ids.map((id) => String(id || '')).filter(Boolean))];
  const statuses = await Promise.all(uniqueIds.map(async (id) => [id, await isUserOnline(id, redis)]));
  return new Set(statuses.filter(([, online]) => online).map(([id]) => id));
}

const init = (server) => {
  const allowedOrigins = buildAllowedOrigins();

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  // Global Signaling Mesh: Broadast events across multiple server instances
  const { pubClient, subClient } = require('../config/redisConfig');
  io.adapter(createAdapter(pubClient, subClient));

  // Authentication and live age access complete before any room or presence work.
  const IS_PROD = process.env.NODE_ENV === "production";
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    logRealtimeDebug('New client connected:', socket.id);
    // Track online presence for authenticated sockets.
    let presenceHeartbeat = null;
    if (socket.userId) {
      markUserOnline(socket.userId, socket.id).catch((err) => {
        console.error('[presence] online mark error:', err);
      });
      presenceHeartbeat = setInterval(() => {
        markUserOnline(socket.userId, socket.id).catch((err) => {
          console.error('[presence] heartbeat error:', err);
        });
      }, PRESENCE_REFRESH_MS);
      // Per-user room so we can push notifications to a specific user across
      // all their connected sockets/devices.
      socket.join(`user_${socket.userId}`);
    }

    socket.on('join_squad', async (squadId) => {
      try {
        const result = await authorizeSquadRoomJoin({
          squadId,
          userId: socket.userId,
          isProduction: IS_PROD,
          Squad,
          User,
        });
        if (!result.allowed) return;
        logRealtimeDebug(`Socket ${socket.id} joining squad room: ${result.room}`);
        socket.join(result.room);
      } catch (err) {
        console.error('join_squad error:', err);
      }
    });

    socket.on('join_encounter', async (encounterId) => {
      try {
        const result = await authorizeEncounterRoomJoin({
          encounterId,
          userId: socket.userId,
          isProduction: IS_PROD,
          Squad,
          Encounter,
          User,
        });
        if (!result.allowed) return;
        logRealtimeDebug(`Socket ${socket.id} joining encounter room: ${result.room}`);
        socket.join(result.room);
      } catch (err) {
        console.error('join_encounter error:', err);
      }
    });

    socket.on('send_message', async ({ encounterId, text, senderName, senderId, squadId, clientMessageId } = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!chatLimiter.allow(socket.id)) return reply({ ok: false, error: 'Too many messages. Try again in a moment.' });
        if (IS_PROD && !socket.userId) return reply({ ok: false, error: 'Sign in again to send.' });
        const normalizedText = normalizeChatText(text);
        if (!normalizedText || normalizedText.length > MAX_CHAT_TEXT_LENGTH) {
          return reply({ ok: false, error: 'Write a message up to 500 characters.' });
        }
        if (classifyVibe(normalizedText) !== 'ok') {
          return reply({ ok: false, error: 'That message is not allowed.' });
        }

        const normalizedEncounterId = normalizeRealtimeId(encounterId);
        const normalizedSquadId = normalizeRealtimeId(squadId);
        const normalizedClientMessageId = normalizeRealtimeId(clientMessageId);
        const authorization = await authorizeRealtimeSend({
          encounterId: normalizedEncounterId,
          squadId: normalizedSquadId,
          userId: socket.userId,
          isProduction: IS_PROD,
          Squad,
          Encounter,
          User,
        });
        if (!authorization.allowed || !socket.rooms.has(authorization.room)) {
          return reply({ ok: false, error: 'That message is not allowed.' });
        }

        const ts = Date.now();
        // Derive the sender from the authenticated socket when available; fall
        // back to client-supplied values only for dev clients with no identity.
        const resolvedSenderId = socket.userId || senderId;
        const resolvedSenderName = resolveSocketSenderName(socket.userName, senderName);
        const message = {
          id: `${ts}-${randomBase36(9)}`,
          text: normalizedText,
          senderName: resolvedSenderName,
          senderId: resolvedSenderId,
          clientMessageId: normalizedClientMessageId || undefined,
          encounterId: normalizedEncounterId || undefined,
          squadId: normalizedSquadId || undefined,
          ts,
          timestamp: new Date(ts).toISOString(),
        };

        let delivery = { claimed: true, message };
        if (normalizedClientMessageId && resolvedSenderId) {
          delivery = await claimOrGetChatMessage({
            senderId: resolvedSenderId,
            room: authorization.room,
            clientMessageId: normalizedClientMessageId,
            message,
            redis: getRedisClient(),
          });
        }
        // Re-send the canonical ID on retry: a worker may have stopped after
        // storing the claim but before broadcasting. Clients merge by message ID.
        io.to(authorization.room).emit('new_message', delivery.message);
        reply({ ok: true, message: delivery.message });
      } catch (err) {
        console.error('send_message error:', err);
        reply({
          ok: false,
          error: err?.code === 'CHAT_DEDUP_UNAVAILABLE'
            ? 'Message delivery is temporarily unavailable. Try again.'
            : 'That message is not allowed.',
        });
      }
    });

    socket.on('send_reaction', async ({ encounterId, squadId, emoji }) => {
      // Must be authenticated, send a sane emoji, and actually belong to the
      // target room. Never trust client-supplied sender identity.
      if (!reactionLimiter.allow(socket.id)) return;
      if (!socket.userId) return;
      const normalizedEmoji = normalizeReactionEmoji(emoji);
      if (!normalizedEmoji) return;
      const normalizedEncounterId = normalizeRealtimeId(encounterId);
      const normalizedSquadId = normalizeRealtimeId(squadId);
      try {
        const authorization = await authorizeRealtimeSend({
          encounterId: normalizedEncounterId,
          squadId: normalizedSquadId,
          userId: socket.userId,
          isProduction: IS_PROD,
          Squad,
          Encounter,
          User,
        });
        if (!authorization.allowed || !socket.rooms.has(authorization.room)) return;
        io.to(authorization.room).emit('new_reaction', {
          id: `${Date.now()}-${randomBase36(9)}`,
          emoji: normalizedEmoji,
          senderId: socket.userId,
          senderName: resolveSocketSenderName(socket.userName),
          encounterId: normalizedEncounterId || undefined,
          squadId: normalizedSquadId || undefined,
          ts: Date.now(),
        });
      } catch (err) {
        console.error('send_reaction error:', err);
      }
    });

    socket.on('report_squad', async (payload = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!reportLimiter.allow(socket.id)) {
          return reply({ ok: false, error: 'Too many reports. Try again in a moment.' });
        }
        const result = await persistSquadReport({
          payload,
          userId: socket.userId,
          Squad,
          Encounter,
          ReportModel: SafetyReport,
        });
        reply(result);
      } catch (err) {
        console.error('Report error:', err);
        reply({ ok: false, error: 'Report could not be saved. Try again.' });
      }
    });

    socket.on('disconnect', async () => {
      logRealtimeDebug('Client disconnected:', socket.id);
      if (presenceHeartbeat) clearInterval(presenceHeartbeat);
      chatLimiter.forget(socket.id);
      reactionLimiter.forget(socket.id);
      reportLimiter.forget(socket.id);
      if (!socket.userId) return; // dev sockets with no identity — nothing to clean up

      const userId = socket.userId;

      // Cancel abandoned searches: if this user no longer has any online socket,
      // any squad they were searching in whose members are ALL offline is a
      // ghost — pull it out of the matchmaking queue and reset to idle so it
      // doesn't linger and get matched against real squads.
      try {
        await markUserOffline(userId, socket.id);
        if (await isUserOnline(userId)) return; // user still has another socket open

        const searchingSquads = await Squad.find({
          'members.userId': userId,
          status: 'searching',
        });

        for (const squad of searchingSquads) {
          const onlineMemberIds = await getOnlineUserIds(squad.members.map((m) => m.userId));
          if (onlineMemberIds.size > 0) continue; // someone is still around — keep searching

          const queueService = require('./queueService');
          await queueService.removeFromQueue(squad.squadId);
          squad.status = 'idle';
          squad.searchQueuedAt = null;
          await squad.save();
          logRealtimeDebug(
            `[presence] Squad ${squad.squadId} abandoned (all members offline) — dequeued and set idle`
          );
          emitToSquad(squad.squadId, 'SQUAD_UPDATED', {});
        }
      } catch (err) {
        // Never throw from the disconnect handler.
        console.error('[presence] disconnect cleanup error:', err);
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

const emitToSquad = (squadId, event, data) => {
  if (io) {
    io.to(`squad_${squadId}`).emit(event, data);
  }
};

/** Push an event to a specific user's per-user room (all their sockets). */
const emitToUser = (userId, event, payload) => {
  if (io && userId) {
    io.to(`user_${userId}`).emit(event, payload);
  }
};

const disconnectUserSockets = (userId, server = io) => {
  const normalizedUserId = String(userId || '');
  if (!server || !normalizedUserId) return;
  server.in(`user_${normalizedUserId}`).disconnectSockets(true);
};

const revokeUserRealtimeAccess = ({ userId, squadId, encounterId } = {}, server = io) => {
  const normalizedSquadId = normalizeRealtimeId(squadId);
  const normalizedEncounterId = normalizeRealtimeId(encounterId);
  const normalizedUserId = String(userId || '');
  if (!server || !normalizedUserId || !normalizedSquadId) return;

  const rooms = [`squad_${normalizedSquadId}`];
  if (normalizedEncounterId) rooms.push(`encounter_${normalizedEncounterId}`);
  server.in(`user_${normalizedUserId}`).socketsLeave(rooms);
};

const closeEncounterRoom = (encounterId, server = io) => {
  const normalizedEncounterId = normalizeRealtimeId(encounterId);
  if (!server || !normalizedEncounterId) return;
  const room = `encounter_${normalizedEncounterId}`;
  server.in(room).socketsLeave(room);
};

module.exports = {
  authenticateSocket,
  closeEncounterRoom,
  disconnectUserSockets,
  init,
  getIO,
  emitToSquad,
  emitToUser,
  revokeUserRealtimeAccess,
  isUserOnline,
  getOnlineUserIds,
  isRealtimeDebugEnabled,
  normalizeChatText,
  normalizeSocketIdentity,
  createSocketRateLimiter,
  resolveSocketAuthToken,
  normalizeReactionEmoji,
  persistSquadReport,
  resolveSocketSenderName,
  MAX_CHAT_TEXT_LENGTH,
};
