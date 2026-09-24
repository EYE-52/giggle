require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');
const { requestLogger } = require('./middlewares/requestLogger');
const { ENABLE_REQUEST_LOGS, LOG_REQUEST_BODY, publicApiBaseUrl } = require('./config/appConfig');
const { buildAllowedOrigins } = require('./config/corsOrigins');
const socketService = require('./services/socketService');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

app.disable("x-powered-by");

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

function isStrongSecret(value) {
  return typeof value === "string" && value.length >= 32;
}

function validateRequiredEnv() {
  const missing = [];
  const weak = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!MONGODB_URI) missing.push('MONGODB_URI');
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) missing.push('REDIS_URL');
    if (!process.env.AGORA_APP_ID) missing.push('AGORA_APP_ID');
    if (!process.env.AGORA_APP_CERTIFICATE) missing.push('AGORA_APP_CERTIFICATE');
    if (!process.env.AUTH_EXCHANGE_SECRET) missing.push('AUTH_EXCHANGE_SECRET');
    if (!process.env.BACKEND_PUBLIC_URL) missing.push('BACKEND_PUBLIC_URL');
    if (!process.env.FRONTEND_URL) missing.push('FRONTEND_URL');
    if (process.env.JWT_SECRET && !isStrongSecret(process.env.JWT_SECRET)) weak.push('JWT_SECRET');
    if (process.env.AUTH_EXCHANGE_SECRET && !isStrongSecret(process.env.AUTH_EXCHANGE_SECRET)) weak.push('AUTH_EXCHANGE_SECRET');
  }

  if (missing.length === 0 && weak.length === 0) return;

  const messages = [];
  if (missing.length) messages.push(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`);
  if (weak.length) messages.push(`${weak.join(' and ')} must each be at least 32 characters in production.`);
  const message = messages.join(' ');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(message);
  }
  console.error(
    '\n[FATAL] ' + message + ' ' +
    'Set required environment variables before serving production traffic.\n'
  );
}
validateRequiredEnv();

// Middleware
// FRONTEND_URL may be a comma-separated list of allowed origins (prod domains, vercel, etc.)
const allowedOrigins = buildAllowedOrigins();

app.use(helmet());

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      console.warn(`[CORS Blocked] Origin: ${origin}. Allowed: ${allowedOrigins.join(', ')}`);
      return callback(new Error('CORS policy violation'), false);
    }
  },
  credentials: true,
  maxAge: 86400,
}));
// Cover images are sent as base64 — allow a generous body limit.
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());

// Rate limiting: a general limiter for all /api traffic, plus a stricter
// limiter on the auth exchange endpoint to slow credential-stuffing.
// When Redis is configured the counters live in Redis so limits hold across
// replicas; local dev without Redis keeps the in-memory store.
const useRedisRateLimitStore = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

class ResilientRedisStore extends RedisStore {
  async increment(key) {
    try {
      return await super.increment(key);
    } catch (error) {
      // A failed SCRIPT LOAD (e.g. Redis unreachable at boot) leaves a rejected
      // script promise that would fail every later call; reload it next time.
      this.incrementScriptSha = this.loadIncrementScript();
      this.incrementScriptSha.catch(() => {});
      throw error;
    }
  }
}

function rateLimitStore(prefix) {
  if (!useRedisRateLimitStore) return {};
  const { redis } = require('./config/redisConfig');
  return {
    store: new ResilientRedisStore({
      prefix,
      sendCommand: (command, ...args) => redis.call(command, ...args),
    }),
    // Fail open like the previous in-memory limiter: a Redis outage must not
    // turn every API request into a 500.
    passOnStoreError: true,
  };
}

const generalLimiter = rateLimit({
  // This is a REALTIME app: clients poll matchmaking/encounter status every ~2s
  // (≈30 req/min/user) on top of normal traffic, and several users can share one
  // NAT/office IP. 300/15min (≈20/min) tripped 429s during normal use; 3000/15min
  // (≈200/min) comfortably covers polling + many users while still bounding abuse.
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests, please try again later" } },
  ...rateLimitStore("rl:api:"),
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many attempts — please wait a minute and try again." } },
  ...rateLimitStore("rl:auth:"),
});
// All auth provider routes (exchange, google, apple, email magic-link) share
// the stricter auth limiter to slow credential-stuffing / link spamming.
app.use("/api/auth", authLimiter);
app.use("/api", generalLimiter);
if (ENABLE_REQUEST_LOGS) {
  app.use(requestLogger({ logRequestBody: LOG_REQUEST_BODY }));
}

let mongoConnectPromise = null;
let socketInitialized = false;

function connectDatabase() {
  if (!MONGODB_URI) {
    return Promise.reject(new Error('MONGODB_URI is not set.'));
  }
  if (!mongoConnectPromise) {
    mongoConnectPromise = mongoose.connect(MONGODB_URI, MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : undefined)
      .then(() => console.log('MongoDB connected'))
      .catch(err => {
        mongoConnectPromise = null;
        console.error('MongoDB connection error:', err);
        throw err;
      });
  }
  return mongoConnectPromise;
}


// Swagger setup
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Giggle API',
    version: '1.0.0',
    description: 'API documentation for Giggle MVP backend',
  },
  servers: [
    { url: publicApiBaseUrl(), description: 'Giggle API server' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

const swaggerOptions = {
  swaggerDefinition,
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
  ],
};
let swaggerSpec = null;
function getSwaggerSpec() {
  if (!swaggerSpec) {
    swaggerSpec = swaggerJSDoc(swaggerOptions);
  }
  return swaggerSpec;
}
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', (req, res, next) => swaggerUi.setup(getSwaggerSpec())(req, res, next));

// Health check endpoint
app.get('/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const { redis } = require('./config/redisConfig');
  const redisStatus = redis.status === 'ready' ? 'connected' : 'disconnected';
  
  const isHealthy = mongoStatus === 'connected' && redisStatus === 'connected';
  
  res.status(isHealthy ? 200 : 503).json({
    ok: isHealthy,
    status: isHealthy ? 'UP' : 'DOWN',
    timestamp: new Date().toISOString(),
    services: {
      api: 'UP',
      database: mongoStatus,
      redis: redisStatus,
    }
  });
});

// Routes
const coverRoutes = require("./routes/coverRoutes");
const squadRoutes = require("./routes/squadRoutes");
const authRoutes = require("./routes/authRoutes");
const agoraRoutes = require("./routes/agoraRoutes");
const matchmakingRoutes = require("./routes/matchmakingRoutes");
const encounterRoutes = require("./routes/encounterRoutes");
const adminRoutes = require("./routes/adminRoutes");
const statsRoutes = require("./routes/statsRoutes");
const friendsRoutes = require("./routes/friendsRoutes");
const meRoutes = require("./routes/meRoutes");
const avatarMatchRoutes = require("./routes/avatarMatchRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
// Public, unauthenticated: uploaded squad cover images.
app.use("/api", coverRoutes);
app.use("/api", squadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", agoraRoutes);
app.use("/api", matchmakingRoutes);
app.use("/api", encounterRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", statsRoutes);
app.use("/api", friendsRoutes);
app.use("/api", meRoutes);
app.use("/api", avatarMatchRoutes);
app.use("/api", notificationRoutes);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "INVALID_JSON",
        message: "Malformed JSON body",
        hint: 'Use valid JSON like {"squadCode":"GIG-882","displayName":"Himanshu"}',
      },
    });
  }

  console.error(err.stack);
  res.status(500).json({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Something broke" },
  });
});

async function startServer(port = PORT) {
  await connectDatabase();

  const { startAccountDeletionSweeper } = require('./services/accountDeletionService');
  startAccountDeletionSweeper();

  if (!socketInitialized) {
    socketService.init(server);
    socketInitialized = true;
  }

  // Background sweeper: frees squads stuck in "matched" when an encounter ack
  // never completes (expired awaiting_ack encounters). Runs every ~30s.
  const matchmakingService = require('./services/matchmakingService');
  matchmakingService.startEncounterSweeper();

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Stop the existing server or set PORT to another value.`));
        return;
      }
      reject(err);
    };

    server.once("error", onError);
    server.listen(port, process.env.HOST || "0.0.0.0", () => {
      server.off("error", onError);
      console.log(`Server running on port ${port}`);
      resolve();
    });
  });

  scheduleCoverBackfill();
  return server;
}

// Moves legacy base64 squad covers into cover storage shortly after boot, so
// deploys migrate existing data without shell access. Idempotent and
// conditional per squad; the lease keeps it to one replica. Never blocks
// startup or crashes the process. Opt out with COVER_BACKFILL_ON_START=false.
const COVER_BACKFILL_DELAY_MS = 15 * 1000;
const COVER_BACKFILL_LEASE_MS = 10 * 60 * 1000;

function scheduleCoverBackfill() {
  if (process.env.COVER_BACKFILL_ON_START === 'false') return;
  const timer = setTimeout(async () => {
    // Everything, including the requires, stays inside try: a throw in a timer
    // callback is an uncaught exception that would crash the whole server.
    try {
      const { runAsSingleReplica } = require('./config/redisConfig');
      const { migrateSquadCovers } = require('./services/coverMigration');
      await runAsSingleReplica('cover-backfill', COVER_BACKFILL_LEASE_MS, () =>
        migrateSquadCovers({ log: (...args) => console.log('[cover-backfill]', ...args) })
      );
    } catch (err) {
      console.warn('[cover-backfill] failed:', err.message);
    }
  }, Number(process.env.COVER_BACKFILL_DELAY_MS) || COVER_BACKFILL_DELAY_MS);
  timer.unref();
}

const SHUTDOWN_TIMEOUT_MS = 10 * 1000;
let shutdownPromise = null;

function closeRedisClient(client) {
  // QUIT only on a live connection: on a lazy/reconnecting client it would sit
  // in the offline queue (forever for the pub/sub clients) instead of closing.
  if (client.status !== 'ready') {
    client.disconnect();
    return Promise.resolve();
  }
  return client.quit().catch(() => client.disconnect());
}

// Graceful shutdown for SIGTERM/SIGINT (Railway/Docker/k8s redeploys): stop
// background sweepers, close sockets and the HTTP listener, then disconnect
// Mongo and Redis. A hard exit guarantees the process ends within 10s.
function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  console.log(`[shutdown] ${signal} received, shutting down gracefully...`);

  const hardExit = setTimeout(() => {
    console.error(`[shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardExit.unref();

  shutdownPromise = (async () => {
    require('./services/matchmakingService').stopEncounterSweeper();
    require('./services/accountDeletionService').stopAccountDeletionSweeper();

    const httpClosed = new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
    if (socketInitialized) await socketService.close();
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    await httpClosed;

    // disconnect() waits out a still-pending initial connect (up to the 30s
    // server-selection timeout), so only close an established connection.
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
    const { redis, pubClient, subClient } = require('./config/redisConfig');
    await Promise.allSettled([redis, pubClient, subClient].map(closeRedisClient));
    console.log('[shutdown] Clean shutdown complete');
  })()
    .then(() => {
      process.exitCode = process.exitCode || 0;
    })
    .catch((err) => {
      console.error('[shutdown] Error during shutdown:', err);
      process.exitCode = 1;
    })
    .finally(() => {
      clearTimeout(hardExit);
      process.exit();
    });

  return shutdownPromise;
}

if (require.main === module) {
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  startServer().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { app, server, startServer, connectDatabase, getSwaggerSpec, publicApiBaseUrl, shutdown };
