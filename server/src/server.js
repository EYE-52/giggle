require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');
const { requestLogger } = require('./middlewares/requestLogger');
const { ENABLE_REQUEST_LOGS, LOG_REQUEST_BODY } = require('./config/appConfig');
const { buildAllowedOrigins } = require('./config/corsOrigins');
const socketService = require('./services/socketService');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

app.disable("x-powered-by");

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

function isStrongSecret(value) {
  return typeof value === "string" && value.length >= 32;
}

function publicApiBaseUrl() {
  const base = (process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
  return `${base}/api`;
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
}));
// Cover images are sent as base64 — allow a generous body limit.
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());

// Rate limiting: a general limiter for all /api traffic, plus a stricter
// limiter on the auth exchange endpoint to slow credential-stuffing.
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
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many attempts — please wait a minute and try again." } },
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
    mongoConnectPromise = mongoose.connect(MONGODB_URI)
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
const squadRoutes = require("./routes/squadRoutes");
const authRoutes = require("./routes/authRoutes");
const agoraRoutes = require("./routes/agoraRoutes");
const matchmakingRoutes = require("./routes/matchmakingRoutes");
const encounterRoutes = require("./routes/encounterRoutes");
const adminRoutes = require("./routes/adminRoutes");
const statsRoutes = require("./routes/statsRoutes");
const friendsRoutes = require("./routes/friendsRoutes");
const meRoutes = require("./routes/meRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
app.use("/api", squadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", agoraRoutes);
app.use("/api", matchmakingRoutes);
app.use("/api", encounterRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", statsRoutes);
app.use("/api", friendsRoutes);
app.use("/api", meRoutes);
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
    server.listen(port, () => {
      server.off("error", onError);
      console.log(`Server running on port ${port}`);
      resolve();
    });
  });

  return server;
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { app, server, startServer, connectDatabase, getSwaggerSpec, publicApiBaseUrl };
