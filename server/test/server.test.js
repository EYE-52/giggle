const assert = require("node:assert/strict");
const http = require("node:http");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const STRONG_JWT_SECRET = "test-jwt-secret-with-at-least-32-bytes";
const STRONG_EXCHANGE_SECRET = "test-exchange-secret-with-32-plus-bytes";

function reloadServerModule() {
  delete require.cache[require.resolve("../src/server")];
  return require("../src/server");
}

async function closeRedisClientsIfLoaded() {
  const redisPath = require.resolve("../src/config/redisConfig");
  if (!require.cache[redisPath]) return;
  const { redis, subClient } = require("../src/config/redisConfig");
  await Promise.allSettled([redis.quit(), subClient.quit()]);
}

async function fetchFromApp(app, requestPath) {
  const testServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(0, "127.0.0.1", resolve);
  });

  const { port } = testServer.address();
  try {
    return await fetch(`http://127.0.0.1:${port}${requestPath}`);
  } finally {
    await new Promise((resolve, reject) => {
      testServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("server module exports start helpers without listening immediately", async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalMongoUri = process.env.MONGODB_URI;

  process.env.JWT_SECRET = originalJwtSecret || "test-secret";
  process.env.MONGODB_URI = originalMongoUri || "mongodb://127.0.0.1:27017/giggle-test";

  const { app, server, startServer, connectDatabase } = reloadServerModule();

  assert.equal(typeof app.use, "function");
  assert.equal(typeof server.listen, "function");
  assert.equal(typeof startServer, "function");
  assert.equal(typeof connectDatabase, "function");
  assert.equal(server.listening, false);

  await closeRedisClientsIfLoaded();
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = originalMongoUri;
  delete require.cache[require.resolve("../src/server")];
});

test("production startup config fails fast when MongoDB URI is missing", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalMongoUri = process.env.MONGODB_URI;
  const originalAuthExchangeSecret = process.env.AUTH_EXCHANGE_SECRET;
  const originalBackendPublicUrl = process.env.BACKEND_PUBLIC_URL;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = STRONG_JWT_SECRET;
  process.env.AUTH_EXCHANGE_SECRET = STRONG_EXCHANGE_SECRET;
  process.env.BACKEND_PUBLIC_URL = "https://api.example.com";
  process.env.FRONTEND_URL = "https://app.example.com";
  process.env.MONGODB_URI = "";

  try {
    assert.throws(
      () => reloadServerModule(),
      /MONGODB_URI is not set/
    );
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalMongoUri;
    if (originalAuthExchangeSecret === undefined) delete process.env.AUTH_EXCHANGE_SECRET;
    else process.env.AUTH_EXCHANGE_SECRET = originalAuthExchangeSecret;
    if (originalBackendPublicUrl === undefined) delete process.env.BACKEND_PUBLIC_URL;
    else process.env.BACKEND_PUBLIC_URL = originalBackendPublicUrl;
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    delete require.cache[require.resolve("../src/server")];
  }
});

test("production startup config rejects weak auth secrets", () => {
  const originals = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    AGORA_APP_ID: process.env.AGORA_APP_ID,
    AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE,
    AUTH_EXCHANGE_SECRET: process.env.AUTH_EXCHANGE_SECRET,
    BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL,
    FRONTEND_URL: process.env.FRONTEND_URL,
  };

  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = "test-secret";
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/giggle-test";
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
  process.env.REDIS_HOST = "";
  process.env.AGORA_APP_ID = "agora-app";
  process.env.AGORA_APP_CERTIFICATE = "agora-cert";
  process.env.AUTH_EXCHANGE_SECRET = "server-secret";
  process.env.BACKEND_PUBLIC_URL = "https://api.example.com";
  process.env.FRONTEND_URL = "https://app.example.com";

  try {
    assert.throws(
      () => reloadServerModule(),
      /JWT_SECRET and AUTH_EXCHANGE_SECRET must each be at least 32 characters in production/
    );
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../src/server")];
  }
});

test("production startup config fails fast when realtime or video env is missing", () => {
  const originals = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
    BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL,
    FRONTEND_URL: process.env.FRONTEND_URL,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    AGORA_APP_ID: process.env.AGORA_APP_ID,
    AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE,
    AUTH_EXCHANGE_SECRET: process.env.AUTH_EXCHANGE_SECRET,
  };

  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = STRONG_JWT_SECRET;
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/giggle-test";
  process.env.BACKEND_PUBLIC_URL = "https://api.example.com";
  process.env.FRONTEND_URL = "https://app.example.com";
  process.env.REDIS_URL = "";
  process.env.REDIS_HOST = "";
  process.env.AGORA_APP_ID = "";
  process.env.AGORA_APP_CERTIFICATE = "";
  process.env.AUTH_EXCHANGE_SECRET = "";

  try {
    assert.throws(
      () => reloadServerModule(),
      /REDIS_URL, AGORA_APP_ID, AGORA_APP_CERTIFICATE, AUTH_EXCHANGE_SECRET are not set/
    );
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../src/server")];
  }
});

test("production startup config fails fast when public OAuth URLs are missing", () => {
  const originals = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    AGORA_APP_ID: process.env.AGORA_APP_ID,
    AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE,
    AUTH_EXCHANGE_SECRET: process.env.AUTH_EXCHANGE_SECRET,
    BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL,
    FRONTEND_URL: process.env.FRONTEND_URL,
  };

  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = STRONG_JWT_SECRET;
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/giggle-test";
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
  process.env.REDIS_HOST = "";
  process.env.AGORA_APP_ID = "agora-app";
  process.env.AGORA_APP_CERTIFICATE = "agora-cert";
  process.env.AUTH_EXCHANGE_SECRET = STRONG_EXCHANGE_SECRET;
  process.env.BACKEND_PUBLIC_URL = "";
  process.env.FRONTEND_URL = "";

  try {
    assert.throws(
      () => reloadServerModule(),
      /BACKEND_PUBLIC_URL, FRONTEND_URL are not set/
    );
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../src/server")];
  }
});

test("production server trusts one proxy hop for forwarded client IPs", async () => {
  const originals = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    AGORA_APP_ID: process.env.AGORA_APP_ID,
    AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE,
    AUTH_EXCHANGE_SECRET: process.env.AUTH_EXCHANGE_SECRET,
    BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL,
    FRONTEND_URL: process.env.FRONTEND_URL,
  };

  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = STRONG_JWT_SECRET;
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/giggle-test";
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
  process.env.REDIS_HOST = "";
  process.env.AGORA_APP_ID = "agora-app";
  process.env.AGORA_APP_CERTIFICATE = "agora-cert";
  process.env.AUTH_EXCHANGE_SECRET = STRONG_EXCHANGE_SECRET;
  process.env.BACKEND_PUBLIC_URL = "https://api.example.com";
  process.env.FRONTEND_URL = "https://app.example.com";

  try {
    const { app } = reloadServerModule();

    assert.equal(app.get("trust proxy"), 1);
  } finally {
    await closeRedisClientsIfLoaded();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../src/server")];
  }
});

test("server responses do not expose Express fingerprint headers", async () => {
  const originals = {
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
  };

  process.env.JWT_SECRET = "test-secret";
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/giggle-test";

  try {
    const { app } = reloadServerModule();
    const response = await fetchFromApp(app, "/api/unknown-route");

    assert.equal(response.headers.has("x-powered-by"), false);
  } finally {
    await closeRedisClientsIfLoaded();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../src/server")];
  }
});

test("server disables Express x-powered-by setting explicitly", async () => {
  const originals = {
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
  };

  process.env.JWT_SECRET = "test-secret";
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/giggle-test";

  try {
    const { app } = reloadServerModule();

    assert.equal(app.enabled("x-powered-by"), false);
  } finally {
    await closeRedisClientsIfLoaded();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../src/server")];
  }
});

test("unknown API routes return the app JSON error shape", async () => {
  const originals = {
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
  };

  process.env.JWT_SECRET = "test-secret";
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/giggle-test";

  try {
    const { app } = reloadServerModule();
    const response = await fetchFromApp(app, "/api/unknown-route");
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(payload, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } finally {
    await closeRedisClientsIfLoaded();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../src/server")];
  }
});

test("swagger server URL follows BACKEND_PUBLIC_URL when configured", async () => {
  const originals = {
    JWT_SECRET: process.env.JWT_SECRET,
    MONGODB_URI: process.env.MONGODB_URI,
    BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL,
  };

  process.env.JWT_SECRET = "test-secret";
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/giggle-test";
  process.env.BACKEND_PUBLIC_URL = "https://api.example.com/";

  try {
    const { getSwaggerSpec } = reloadServerModule();
    const spec = getSwaggerSpec();

    assert.equal(spec.servers[0].url, "https://api.example.com/api");
  } finally {
    await closeRedisClientsIfLoaded();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../src/server")];
  }
});

test("deployment docs list backend OAuth provider environment variables", () => {
  const deploymentDoc = readFileSync(path.join(__dirname, "../../DEPLOYMENT.md"), "utf8");

  for (const name of [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "APPLE_SERVICE_ID",
    "APPLE_TEAM_ID",
    "APPLE_KEY_ID",
    "APPLE_PRIVATE_KEY",
  ]) {
    assert.equal(deploymentDoc.includes(name), true);
  }
});

test("deployment docs keep Vercel env vars aligned with the desktop app", () => {
  const deploymentDoc = readFileSync(path.join(__dirname, "../../DEPLOYMENT.md"), "utf8");
  const desktopConfig = readFileSync(path.join(__dirname, "../../apps/desktop/next.config.ts"), "utf8");
  const desktopSignin = readFileSync(path.join(__dirname, "../../apps/desktop/app/signin/page.tsx"), "utf8");
  const vercelLine = deploymentDoc
    .split("\n")
    .find((line) => line.startsWith("- **Vercel project `giggle-web`")) || "";

  assert.equal(desktopConfig.includes("NEXT_PUBLIC_BACKEND_URL"), true);
  assert.equal(desktopSignin.includes("NEXT_PUBLIC_GOOGLE_CLIENT_ID"), false);
  assert.equal(vercelLine.includes("NEXT_PUBLIC_BACKEND_URL"), true);
  assert.equal(vercelLine.includes("AUTH_EXCHANGE_SECRET"), false);
  assert.equal(vercelLine.includes("NEXT_PUBLIC_GOOGLE_CLIENT_ID"), false);
});

test("deployment docs document production auth secret strength", () => {
  const deploymentDoc = readFileSync(path.join(__dirname, "../../DEPLOYMENT.md"), "utf8");
  const envExample = readFileSync(path.join(__dirname, "../.env.example"), "utf8");

  assert.equal(deploymentDoc.includes("at least 32 characters"), true);
  assert.equal(envExample.includes("at least 32 characters"), true);
});

test("deployment docs mention the backend Node engine range", () => {
  const deploymentDoc = readFileSync(path.join(__dirname, "../../DEPLOYMENT.md"), "utf8");
  const packageJson = require("../package.json");

  assert.equal(deploymentDoc.includes(`Node ${packageJson.engines.node}`), true);
});

test("deployment docs and backend workspace pin a supported Node runtime", () => {
  const deploymentDoc = readFileSync(path.join(__dirname, "../../DEPLOYMENT.md"), "utf8");
  const nodeVersion = readFileSync(path.join(__dirname, "../.node-version"), "utf8").trim();

  assert.match(nodeVersion, /^22\./);
  assert.equal(deploymentDoc.includes("Frontend runtime"), true);
  assert.equal(deploymentDoc.includes(`Node ${nodeVersion}`), true);
});

test("startServer rejects before listening when MongoDB URI is missing in development", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalMongoUri = process.env.MONGODB_URI;

  process.env.NODE_ENV = "development";
  process.env.JWT_SECRET = "test-secret";
  process.env.MONGODB_URI = "";
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const { server, startServer } = reloadServerModule();
    await assert.rejects(
      () => startServer(0),
      /MONGODB_URI is not set/
    );
    assert.equal(server.listening, false);
  } finally {
    console.error = originalConsoleError;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalMongoUri;
    delete require.cache[require.resolve("../src/server")];
  }
});
