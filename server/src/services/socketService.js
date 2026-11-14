const { Squad } = require('../models/Squad');
const { Encounter } = require('../models/Encounter');
const SafetyReport = require('../models/SafetyReport');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const memberMedia = require('./memberMediaService');
const groupPresence = require('./groupPresenceService');
const { aliasGroup, publicGroupMember } = require('./groupIdentityService');
const { randomBase36 } = require('../utils/random');
const { buildAllowedOrigins } = require('../config/corsOrigins');
const {
  authorizeEncounterRoomJoin,
  authorizeRealtimeSend,
  authorizeSquadReport,
  authorizeSquadRoomJoin,
  encounterSideRoom,
  normalizeRealtimeId,
  resolveReportTargetSquadId,
} = require('../utils/socketAccess');
const { firstDisplayName } = require('../utils/identityValidation');
const { classifyVibe } = require('../utils/moderation');
const { isMongoObjectIdString } = require('../middlewares/authMiddleware');
const { hasAdultAccess } = require('./ageAccessService');
const { claimOrGetChatMessage } = require('./chatDeliveryService');
const { canonicalUserId } = require('./interactionSafetyService');
const {
  identityUserFor,
  loadEncounterIdentityUsers,
  publicEncounterIdentity,
} = require('./encounterIdentityService');

let io;
let shuttingDown = false;
const MAX_CHAT_TEXT_LENGTH = 500;
const CHAT_RATE_LIMIT = { limit: 20, windowMs: 10_000 };
const REACTION_RATE_LIMIT = { limit: 30, windowMs: 10_000 };
const REPORT_RATE_LIMIT = { limit: 3, windowMs: 60_000 };
const CONTROL_RATE_LIMIT = { limit: 60, windowMs: 10_000 };
const MAX_PENDING_CONTROLS = 8;
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
const controlLimiter = createSocketRateLimiter(CONTROL_RATE_LIMIT);

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
      scope:"encounter",scopeId:filter.encounterId,targetKey:filter.targetSquadId,
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

// ── Per-squad projection of encounter chat and reactions ───────────────────
// The sender's own squad gets the payload as sent (real identity). The other
// squad gets the sender as publicEncounterIdentity shows them: their squad
// display name, or only their alias and an opaque id when they are anonymous.
// Squad-room (lobby) traffic and dev sockets without an identity are unchanged.
const projectRealtimeSender = (payload, view) => ({
  ...payload,
  senderId: view.userId,
  senderName: view.displayName,
});

const emitRealtimeProjection = async ({
  authorization,
  senderUserId,
  event,
  payload,
  server = io,
  UserModel = User,
}) => {
  if (!server) return;
  const { room, encounter, squadA, squadB } = authorization || {};
  const sender = canonicalUserId(senderUserId);
  if (!encounter || !squadA || !squadB || !sender) {
    const squad = authorization?.squad;
    const member = squad?.members?.find(member => String(member.userId) === sender);
    server.to(room).emit(event, aliasGroup(squad) && member ? projectRealtimeSender(payload, publicGroupMember(squad,member)) : payload);
    return;
  }
  const findSender = (squad) =>
    (squad.members || []).find((member) => canonicalUserId(member.userId) === sender);
  const senderSquad = findSender(squadA) ? squadA : findSender(squadB) ? squadB : null;
  if (!senderSquad) return;
  const senderMember = findSender(senderSquad);
  // Throws on lookup failure: never fall back to the real identity.
  const users = await loadEncounterIdentityUsers([sender], { User: UserModel });
  for (const viewerSquad of [squadA, squadB]) {
    const sideRoom = encounterSideRoom(encounter.encounterId, viewerSquad.squadId);
    if (viewerSquad.squadId === senderSquad.squadId && !aliasGroup(senderSquad)) {
      server.to(sideRoom).emit(event, payload);
      continue;
    }
    const view = publicEncounterIdentity({
      viewerSquadId: viewerSquad.squadId,
      memberSquadId: senderSquad.squadId,
      identityMode: senderSquad.identityMode,
      member: senderMember,
      user: identityUserFor(users, sender),
      encounterId: encounter.encounterId,
    });
    server.to(sideRoom).emit(event, projectRealtimeSender(payload, view));
  }
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
  // One round trip per heartbeat (MULTI/EXEC) instead of three sequential calls.
  const results = await redis
    .multi()
    .sadd(userKey, socketId)
    .expire(userKey, PRESENCE_TTL_SECONDS)
    .set(socketKey, userId, "EX", PRESENCE_TTL_SECONDS)
    .exec();
  const commandError = results?.find(([error]) => error)?.[0];
  if (commandError) throw commandError;
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

// Refresh authoritative roster projections when distributed presence changes.
// A roster query/broadcast failure must not interrupt socket or search cleanup.
async function broadcastUserPresence(userId) {
  try {
    const squads = await Squad.find({ 'members.userId': userId }).select('squadId');
    for (const squad of squads) emitToSquad(squad.squadId, 'SQUAD_UPDATED', {});
  } catch (err) {
    console.error('[presence] roster refresh error:', err);
  }
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
  // The publisher is lazy. Start it now so readiness reflects the broadcast
  // path before the first user event, rather than connecting during that event.
  if (pubClient.status === 'wait') {
    void pubClient.connect().catch(error => console.error('[socket] Redis publisher connection failed:', error));
  }
  io.adapter(createAdapter(pubClient, subClient));

  // Authentication and live age access complete before any room or presence work.
  const IS_PROD = process.env.NODE_ENV === "production";
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    logRealtimeDebug('New client connected:', socket.id);
    // Track online presence for authenticated sockets.
    let presenceHeartbeat = null;
    let presenceRegistration = Promise.resolve();
    if (socket.userId) {
      presenceRegistration = (async () => {
        const wasOnline = await isUserOnline(socket.userId);
        await markUserOnline(socket.userId, socket.id);
        if (!wasOnline) await broadcastUserPresence(socket.userId);
      })().catch((err) => {
        console.error('[presence] online mark error:', err);
      });
      presenceHeartbeat = setInterval(() => {
        // Disconnect waits for every started renewal, not only registration.
        // Otherwise a slow heartbeat can resurrect this socket after cleanup.
        presenceRegistration = presenceRegistration.then(async () => {
          if (controlsStopped) return;
          await markUserOnline(socket.userId, socket.id);
        }).catch((err) => {
          console.error('[presence] heartbeat error:', err);
        });
      }, PRESENCE_REFRESH_MS);
      // Per-user room so we can push notifications to a specific user across
      // all their connected sockets/devices.
      socket.join(`user_${socket.userId}`);
    }

    let ownedMedia = null;
    let mediaOperation = Promise.resolve();
    let pendingControls = 0;
    let controlsStopped = false;
    const beginControl = (ack) => {
      if (controlsStopped || pendingControls >= MAX_PENDING_CONTROLS || !controlLimiter.allow(socket.id)) {
        if (typeof ack === 'function') ack({ok:false, error:'BUSY'});
        return false;
      }
      pendingControls += 1;
      return true;
    };
    const finishControl = () => { pendingControls -= 1; };

    let ownedPresence = null, presenceOperation = Promise.resolve();
    socket.on('group_presence', (input = {}, ack) => {
      if (!beginControl(ack)) return;
      presenceOperation = presenceOperation.then(async () => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (controlsStopped) return reply({ok:false, error:'DISCONNECTED'});
        try {
          const squadId = normalizeRealtimeId(input.squadId);
          if (!socket.userId || !squadId || !['begin','update','end'].includes(input.action)) return reply({ok:false});
          if (input.action === 'end') {
            if (!ownedPresence || ownedPresence.squadId !== squadId || ownedPresence.generation !== input.generation) return reply({ok:false});
            await groupPresence.end(squadId,socket.userId,socket.id,ownedPresence.generation);ownedPresence=null;
          } else {
            const authorization=await authorizeSquadRoomJoin({squadId,userId:socket.userId,isProduction:IS_PROD,Squad,User});
            if (!authorization.allowed) return reply({ok:false});
            await socket.join(authorization.room);
            if (input.action === 'begin') {
              if (ownedPresence) await groupPresence.end(ownedPresence.squadId,socket.userId,socket.id,ownedPresence.generation);
              ownedPresence={squadId,generation:await groupPresence.begin(squadId,socket.userId,socket.id)};
            } else if (!ownedPresence || ownedPresence.squadId !== squadId || ownedPresence.generation !== input.generation || !await groupPresence.update(squadId,socket.userId,socket.id,input.generation)) return reply({ok:false});
          }
          emitToSquad(squadId,'SQUAD_UPDATED',{});reply({ok:true,generation:ownedPresence?.generation});
        } catch {reply({ok:false});}
      }).finally(finishControl);
      return presenceOperation;
    });

    socket.on('member_media', (input = {}, ack) => {
      if (!beginControl(ack)) return;
      mediaOperation = mediaOperation.then(async () => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (controlsStopped) return reply({ok:false, error:'DISCONNECTED'});
        try {
          const squadId = normalizeRealtimeId(input.squadId);
          const encounterId = normalizeRealtimeId(input.encounterId);
          if (!socket.userId || !squadId || !['begin', 'update', 'end'].includes(input.action) || (input.encounterId && !encounterId)) return reply({ok:false});
          const authorization = await authorizeRealtimeSend({squadId, encounterId, userId:socket.userId, isProduction:IS_PROD, Squad, Encounter, User});
          if (!authorization.allowed || !socket.rooms.has(authorization.room)) return reply({ok:false});
          if (encounterId && (authorization.encounter.status !== 'active' || authorization.ownSquadId !== squadId)) return reply({ok:false});
          const ownSquad = encounterId
            ? [authorization.squadA, authorization.squadB].find(s => s.squadId === squadId)
            : await Squad.findOne({squadId, 'members.userId':String(socket.userId)});
          const ownMember = ownSquad?.members.find(m => String(m.userId) === String(socket.userId));
          if (!ownMember || (input.action !== "end" && ownSquad.communicationMode && ownSquad.communicationMode !== "video")) return reply({ok:false});
          const scope = `${encounterId ? `encounter:${encounterId}` : `squad:${squadId}`}:${ownMember.memberId}`;
          if (input.action === 'begin') {
            const generation = await memberMedia.begin(socket.userId, socket.id, scope);
            ownedMedia = {generation, scope, squadId, encounterId, authorization};
            emitToSquad(squadId, 'SQUAD_UPDATED', {});
            if (encounterId) io.to(authorization.room).emit('SQUAD_UPDATED', {});
            return reply({ok:true, mediaSessionId:generation});
          }
          if (!ownedMedia || input.mediaSessionId !== ownedMedia.generation || scope !== ownedMedia.scope || (input.action === 'update' && typeof input.screenSharing !== 'boolean')) return reply({ok:false, error:'CALL_REPLACED'});
          const changed = input.action === 'end'
            ? await memberMedia.end(socket.userId, socket.id, ownedMedia.generation)
            : await memberMedia.update(socket.userId, socket.id, ownedMedia.generation, scope, input.screenSharing);
          if (!changed) return reply({ok:false, error:'CALL_REPLACED'});
          if (input.action === 'end') ownedMedia = null;
          emitToSquad(squadId, 'SQUAD_UPDATED', {});
          if (encounterId) io.to(authorization.room).emit('SQUAD_UPDATED', {});
          reply({ok:true});
        } catch (err) {
          console.error('member_media error:', err);
          reply({ok:false});
        }
      }).finally(finishControl);
      return mediaOperation;
    });

    socket.on('join_squad', async (squadId) => {
      if (!beginControl()) return;
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
      } finally {
        finishControl();
      }
    });

    socket.on('join_encounter', async (encounterId) => {
      if (!beginControl()) return;
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
        socket.join(result.sideRoom ? [result.room, result.sideRoom] : result.room);
      } catch (err) {
        console.error('join_encounter error:', err);
      } finally {
        finishControl();
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
        // Encounter messages go to each squad's side separately so an anonymous
        // sender reaches the other squad only under their alias.
        await emitRealtimeProjection({
          authorization,
          senderUserId: socket.userId,
          event: 'new_message',
          payload: delivery.message,
        });
        const ownSquad = authorization.squad || [authorization.squadA,authorization.squadB].find(squad => squad?.members.some(member => String(member.userId) === String(socket.userId)));
        const ownMember = ownSquad?.members.find(member => String(member.userId) === String(socket.userId));
        const publicMessage = aliasGroup(ownSquad) && ownMember ? projectRealtimeSender(delivery.message,publicGroupMember(ownSquad,ownMember)) : delivery.message;
        reply({ ok: true, message: publicMessage });
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
        await emitRealtimeProjection({
          authorization,
          senderUserId: socket.userId,
          event: 'new_reaction',
          payload: {
            id: `${Date.now()}-${randomBase36(9)}`,
            emoji: normalizedEmoji,
            senderId: socket.userId,
            senderName: resolveSocketSenderName(socket.userName),
            encounterId: normalizedEncounterId || undefined,
            squadId: normalizedSquadId || undefined,
            ts: Date.now(),
          },
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
      controlsStopped = true;
      if (presenceHeartbeat) clearInterval(presenceHeartbeat);
      await presenceOperation;
      if (ownedPresence) {
        await groupPresence.end(ownedPresence.squadId,socket.userId,socket.id,ownedPresence.generation).catch(() => {});
        emitToSquad(ownedPresence.squadId,'SQUAD_UPDATED',{});ownedPresence=null;
      }
      logRealtimeDebug('Client disconnected:', socket.id);
      await mediaOperation;
      if (ownedMedia) {
        const owner = ownedMedia; ownedMedia = null;
        try {
          if (await memberMedia.end(socket.userId, socket.id, owner.generation)) {
            emitToSquad(owner.squadId, 'SQUAD_UPDATED', {});
            if (owner.encounterId) io.to(owner.authorization.room).emit('SQUAD_UPDATED', {});
          }
        } catch (err) { console.error('member_media disconnect cleanup:', err); }
      }
      chatLimiter.forget(socket.id);
      reactionLimiter.forget(socket.id);
      reportLimiter.forget(socket.id);
      controlLimiter.forget(socket.id);
      if (!socket.userId) return; // dev sockets with no identity — nothing to clean up
      // Graceful shutdown: clients reconnect to another replica, so don't dequeue
      // their squads; presence keys expire on their own TTL.
      if (shuttingDown) return;

      const userId = socket.userId;

      // Cancel abandoned searches: if this user no longer has any online socket,
      // any squad they were searching in whose members are ALL offline is a
      // ghost — pull it out of the matchmaking queue and reset to idle so it
      // doesn't linger and get matched against real squads.
      try {
        // A fast disconnect must not race a pending online registration.
        await presenceRegistration;
        await markUserOffline(userId, socket.id);
        if (await isUserOnline(userId)) return; // user still has another socket open
        await broadcastUserPresence(userId);

        const searchingSquads = await Squad.find({
          'members.userId': userId,
          status: 'searching',
        });

        for (const squad of searchingSquads) await cancelAbandonedSearch(squad);

        // A user with no socket left is not in the encounter video either; a
        // stale flag would make squadmates think the call still has them.
        try {
          await clearEncounterVideoPresence(userId);
        } catch (err) {
          console.error('[presence] encounter video cleanup error:', err);
        }

        scheduleAbandonedEncounterCheck(userId);
      } catch (err) {
        // Never throw from the disconnect handler.
        console.error('[presence] disconnect cleanup error:', err);
      }
    });
  });

  return io;
};

const cancelAbandonedSearch = async (observedSquad) => {
  const { withMatchmakingLock } = require('../config/redisConfig');
  const squadId = observedSquad.squadId;
  return withMatchmakingLock(async signal => {
    const squad = await Squad.findOne({ squadId, status: 'searching', currentEncounterId: null });
    if (!squad || new Date(squad.searchQueuedAt || 0).getTime() !== new Date(observedSquad.searchQueuedAt || 0).getTime()) return false;
    const onlineMemberIds = await getOnlineUserIds(squad.members.map(m => m.userId));
    if (onlineMemberIds.size > 0) return false;
    const queueService = require('./queueService');
    const admission = await queueService.getQueueAdmission(squadId);
    if (signal.aborted) throw signal.error || new Error('Matchmaking lock was lost');
    const changed = await Squad.updateOne(
      { squadId, status: 'searching', currentEncounterId: null, searchQueuedAt: squad.searchQueuedAt ?? null,
        __v: squad.__v == null ? { $exists: false } : squad.__v },
      { $set: { status: 'idle', searchQueuedAt: null }, $inc: { __v: 1 } },
    );
    if (!(changed.matchedCount ?? changed.n ?? 0)) return false;
    if (signal.aborted) throw signal.error || new Error('Matchmaking lock was lost');
    await queueService.removeIfAdmission(squadId, admission);
    logRealtimeDebug(`[presence] Squad ${squadId} abandoned (all members offline) — set idle`);
    emitToSquad(squadId, 'SQUAD_UPDATED', {});
    return true;
  }, { squadIds: [squadId] });
};

// Both checks and the flag write run in one Redis operation. A replacement
// socket or outgoing-media generation must win over old disconnect cleanup.
const clearEncounterFlagIfOffline = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
for _, socketId in ipairs(redis.call('SMEMBERS', KEYS[3])) do
 if redis.call('EXISTS', ARGV[1] .. socketId) == 1 then return 0 end
end
redis.call('HSET', KEYS[1], ARGV[2], 'false')
redis.call('EXPIRE', KEYS[1], 7200)
return 1`;

const clearEncounterVideoPresence = async (userId) => {
  const squads = await Squad.find({ 'members.userId': userId, status: { $in: ['matched', 'in_encounter'] } });
  const redis = getRedisClient();
  let cleared = 0;
  for (const squad of squads) {
    let changed = false;
    for (const member of squad.members.filter(m => String(m.userId) === String(userId))) {
      const result = await redis.eval(clearEncounterFlagIfOffline, 3,
        `squad_session:${squad.squadId}`, `member_media:${userId}`, presenceUserKey(userId),
        PRESENCE_SOCKET_PREFIX, `${member.memberId}:inEncounterVideo`);
      changed = Boolean(result) || changed;
    }
    if (changed) {
      cleared += 1;
      emitToSquad(squad.squadId, 'SQUAD_UPDATED', {});
    }
  }
  return cleared;
};

// A squad whose members all closed the app mid-call would leave the other
// squad in an empty room. Page reloads reconnect within seconds, so wait a
// grace period, then end the call for that squad (the other squad is told and
// requeued exactly as if the squad had pressed End).
const ENCOUNTER_ABANDON_GRACE_MS = 30_000;
const endAbandonedEncounters = async (userId) => {
  if (await isUserOnline(userId)) return 0;
  const squads = await Squad.find({ 'members.userId': userId, status: 'in_encounter' });
  let ended = 0;
  for (const squad of squads) {
    const onlineMemberIds = await getOnlineUserIds(squad.members.map((m) => m.userId));
    if (onlineMemberIds.size > 0 || !squad.currentEncounterId) continue;
    const { getEncounterById, endEncounterAsymmetric } = require('./matchmakingService');
    const encounter = await getEncounterById(squad.currentEncounterId);
    if (!encounter || encounter.status === 'ended') continue;
    const didEnd = await endEncounterAsymmetric({
      encounter,
      disconnectingSquadId: squad.squadId,
      shouldEnd: async ({ encounter: currentEncounter, disconnectingSquad }) => {
        if (!disconnectingSquad || disconnectingSquad.status !== 'in_encounter' ||
            disconnectingSquad.currentEncounterId !== encounter.encounterId ||
            currentEncounter.status !== 'active' ||
            !disconnectingSquad.members.some(member => String(member.userId) === String(userId))) return false;
        const online = await getOnlineUserIds(disconnectingSquad.members.map(member => member.userId));
        return online.size === 0;
      },
    });
    if (didEnd === false) continue;
    logRealtimeDebug(`[presence] Squad ${squad.squadId} left encounter ${encounter.encounterId} (all members offline)`);
    ended += 1;
  }
  return ended;
};
const scheduleAbandonedEncounterCheck = (userId, graceMs = ENCOUNTER_ABANDON_GRACE_MS) => {
  const timer = setTimeout(() => {
    if (shuttingDown) return;
    endAbandonedEncounters(userId).catch((err) => console.error('[presence] abandoned encounter check failed:', err));
  }, graceMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
};

// Graceful shutdown: disconnect every socket and close the engine (socket.io
// also closes the attached HTTP server). Resolves once closed.
const close = () => new Promise((resolve) => {
  shuttingDown = true;
  if (!io) return resolve();
  io.close(() => resolve());
});

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
  if (normalizedEncounterId) {
    rooms.push(`encounter_${normalizedEncounterId}`, encounterSideRoom(normalizedEncounterId, normalizedSquadId));
  }
  server.in(`user_${normalizedUserId}`).socketsLeave(rooms);
};

// Accepts an encounter id or an encounter record; with a record, both squads'
// side rooms are emptied too.
const closeEncounterRoom = (encounterOrId, server = io) => {
  const encounter = encounterOrId && typeof encounterOrId === 'object' ? encounterOrId : null;
  const normalizedEncounterId = normalizeRealtimeId(encounter ? encounter.encounterId : encounterOrId);
  if (!server || !normalizedEncounterId) return;
  const room = `encounter_${normalizedEncounterId}`;
  const sideRooms = [encounter?.squadAId, encounter?.squadBId]
    .map(normalizeRealtimeId)
    .filter(Boolean)
    .map((squadId) => encounterSideRoom(normalizedEncounterId, squadId));
  server.in(room).socketsLeave(sideRooms.length ? [room, ...sideRooms] : room);
};

module.exports = {
  authenticateSocket,
  closeEncounterRoom,
  disconnectUserSockets,
  clearEncounterVideoPresence,
  cancelAbandonedSearch,
  emitRealtimeProjection,
  endAbandonedEncounters,
  init,
  close,
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
