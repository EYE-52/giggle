#!/usr/bin/env node
// Fully isolated local API/Mongo/Redis exercise. Never loads .env or connects
// to configured services. Agora credentials are dummy strings; no RTC is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { setMaxListeners } = require('node:events');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const { io } = createRequire(path.join(__dirname, '../../packages/core/package.json'))('socket.io-client');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
if (args.includes('--help')) {
  console.log('node server/scripts/load-test-meet.js --mongod /path/to/mongod [--users 200] [--replicas 3] [--scoped-locks true] [--timeout-ms 150000] [--grace-ms 32000] [--report /absolute/report.json]');
  process.exit(0);
}
const usersCount = Number(option('users', 200));
const replicas = Number(option('replicas', 3));
const timeoutMs = Number(option('timeout-ms', 150000));
const graceMs = Number(option('grace-ms', 32000));
const scopedLocks = option('scoped-locks', 'true');
assert.ok(['true','false'].includes(scopedLocks), '--scoped-locks must be true or false');
assert.ok(Number.isInteger(usersCount) && usersCount >= 8 && usersCount <= 1000 && usersCount % 4 === 0, '--users must be a multiple of four between 8 and 1000');
assert.ok(Number.isInteger(replicas) && replicas >= 2 && replicas <= 3, '--replicas must be two or three');
assert.ok(Number.isFinite(timeoutMs) && timeoutMs >= 30000 && timeoutMs <= 600000, 'timeout must be 30-600 seconds');
assert.ok(Number.isFinite(graceMs) && graceMs >= 32000 && graceMs <= 120000, 'grace must be at least 32 seconds');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-meet-load-'));
const reportPath = path.resolve(option('report', path.join(temp, 'report.json')));
const report = {
  startedAt: new Date().toISOString(), success: false,
  configuration: { users: usersCount, squads: usersCount / 2, replicas, timeoutMs, graceMs, node: process.version, nodeEnv: 'production', scopedMatchmakingLocks: scopedLocks === 'true',
    dependencies: Object.fromEntries(['mongoose','ioredis','socket.io','@socket.io/redis-adapter'].map(name => [name, JSON.parse(fs.readFileSync(path.join(root, 'server/node_modules', name, 'package.json'), 'utf8')).version])),
    isolatedStores: true, simulatedAdults: true, simulatedVideoPresence: true, simulatedAgoraCredentials: true, rtcProviderCalls: 0 },
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirtyProductionSources: execFileSync('git', ['diff', '--name-only', '--', 'server/src'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  phases: {}, operations: {}, firstAttemptFailures: [], recoveryFailures: [], checks: {}, logsDirectory: temp,
};
const children = [], sockets = new Set(), samples = new Map(), people = [], squads = [];
const secret = crypto.randomBytes(32).toString('hex');
const stop = new AbortController();
setMaxListeners(0, stop.signal);
const delay = ms => new Promise((resolve, reject) => {
  stop.signal.throwIfAborted();
  const aborted = () => { clearTimeout(timer); reject(stop.signal.reason); };
  const timer = setTimeout(() => { stop.signal.removeEventListener('abort', aborted); resolve(); }, ms);
  stop.signal.addEventListener('abort', aborted, { once: true });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stop.abort(new Error(`Interrupted by ${signal}`));
  sockets.forEach(socket => socket.disconnect());
});
let mongo, redis, bases = [], requestSequence = 0;

function record(name, duration, result, { attempt = 0, expectedDenial = false } = {}) {
  if (!samples.has(name)) samples.set(name, []);
  samples.get(name).push(duration);
  const metric = report.operations[name] ||= { attempts: 0, succeeded: 0, expectedDenials: 0, errors: 0, firstAttemptErrors: 0, recoveryErrors: 0 };
  metric.attempts++;
  if (result.ok) metric[expectedDenial ? 'expectedDenials' : 'succeeded']++;
  else {
    metric.errors++;
    metric[attempt ? 'recoveryErrors' : 'firstAttemptErrors']++;
    const entry = { operation: name, attempt: attempt + 1, status: result.status || null, error: result.error || 'unknown' };
    (attempt ? report.recoveryFailures : report.firstAttemptFailures).push(entry);
  }
}
async function phase(name, work) {
  stop.signal.throwIfAborted();
  console.log(`Starting ${name}`);
  const start = performance.now();
  try { return await work(); }
  finally { report.phases[name] = { elapsedMs: +(performance.now() - start).toFixed(2) }; }
}
async function mapLimit(items, concurrency, work) {
  let next = 0;
  const results = new Array(items.length);
  const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { stop.signal.throwIfAborted(); const index = next++; results[index] = await work(items[index], index); }
  }));
  const failed = workers.find(worker => worker.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}
async function burst(items, concurrency, work) {
  const results = new Array(items.length), pending = [];
  await mapLimit(items, concurrency, async (item, index) => {
    try { results[index] = await work(item, index, 0); }
    catch (error) { pending.push({ item, index, error }); }
  });
  for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
    const retrying = pending.splice(0);
    await delay(300);
    await mapLimit(retrying, 6, async entry => {
      try { results[entry.index] = await work(entry.item, entry.index, attempt); }
      catch (error) { pending.push({ ...entry, error }); }
    });
  }
  if (pending.length) throw new Error(`Bounded recovery exhausted: ${pending[0].error.message}`);
  return results;
}
async function request(name, person, route, body, options = {}) {
  const base = bases[(requestSequence++) % bases.length];
  const start = performance.now();
  let response, envelope;
  try {
    response = await fetch(base + '/api' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${person.token}` },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([stop.signal, AbortSignal.timeout(20000)]),
    });
    envelope = await response.json();
    const expectedDenial = Boolean(options.expectedStatuses);
    const ok = expectedDenial ? options.expectedStatuses.includes(response.status) : response.ok && envelope.ok !== false;
    record(name, performance.now() - start, { ok, status: response.status, error: envelope.error?.code }, { ...options, expectedDenial });
    if (!ok) throw Object.assign(new Error(`${name}: HTTP ${response.status} ${envelope.error?.code || ''}`), { recorded: true });
    return envelope.data ?? envelope;
  } catch (error) {
    if (!error.recorded) record(name, performance.now() - start, { ok: false, error: error.message }, options);
    throw error;
  }
}
async function emit(name, socket, event, input, options = {}) {
  const start = performance.now();
  const result = await new Promise(resolve => socket.timeout(10000).emit(event, input, (error, value) => resolve(error ? { ok: false, error: error.message } : value)));
  const ok = options.expectRejected ? result?.ok === false && result.error === 'CALL_REPLACED' : result?.ok === true;
  record(name, performance.now() - start, { ok, error: result?.error }, { expectedDenial: options.expectRejected });
  assert.ok(ok, `${name}: ${JSON.stringify(result)}`);
  return result;
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function launch(command, argv, log, env) {
  stop.signal.throwIfAborted();
  const fd = fs.openSync(path.join(temp, log), 'w');
  const child = spawn(command, argv, { cwd: temp, env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  child.on('error', error => { child.spawnError = error; });
  children.push(child);
  return child;
}
async function until(probe, timeout = timeoutMs) {
  const deadline = performance.now() + timeout;
  let lastError;
  while (performance.now() < deadline) {
    stop.signal.throwIfAborted();
    try { const value = await probe(); if (value) return value; }
    catch (error) { lastError = error; }
    await delay(200);
  }
  throw new Error(`Timed out: ${lastError?.message || 'condition not reached'}`);
}
async function connect(person, replica) {
  stop.signal.throwIfAborted();
  const start = performance.now();
  const socket = io(bases[replica % bases.length], { auth: { token: person.token }, transports: ['websocket'], reconnection: false });
  sockets.add(socket);
  socket.messages = new Map();
  socket.on('new_message', message => { if (message.text?.startsWith('load_marker_')) socket.messages.set(message.text, message.id); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connection timeout')), 15000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
    });
    record('socket_connect', performance.now() - start, { ok: true });
    return socket;
  } catch (error) { record('socket_connect', performance.now() - start, { ok: false, error: error.message }); throw error; }
}
async function assertIntegrity(database, expectedEncounters, originalIds) {
  assert.equal(await database.collection('encounters').countDocuments({}), expectedEncounters, 'matching and reconnect must not create extra encounter records');
  const active = await database.collection('encounters').find({ status: { $ne: 'ended' } }).toArray();
  assert.equal(active.length, expectedEncounters, 'exactly one live encounter per matched pair');
  const seen = new Set();
  for (const encounter of active) {
    assert.notEqual(encounter.squadAId, encounter.squadBId, 'a squad must not match itself');
    for (const id of [encounter.squadAId, encounter.squadBId]) {
      assert.equal(seen.has(id), false, 'a squad must not belong to two live encounters');
      seen.add(id);
      const squad = await database.collection('squads').findOne({ squadId: id });
      assert.equal(squad.currentEncounterId, encounter.encounterId);
      if (originalIds) assert.equal(squad.status, 'in_encounter', 'both durable squad states remain in the active call');
      if (originalIds) assert.equal(originalIds.get(id), encounter.encounterId, 'reconnect must preserve the same call');
    }
  }
  return active;
}
async function verifyTokens(name) {
  const tokens = await mapLimit(people, 40, async person => {
    const token = await request(name, person, '/encounters/token', { squadId: person.squad.squadId, encounterId: person.encounterId });
    assert.equal(token.channelName, `encounter_${person.encounterId}`);
    assert.ok(token.rtcToken && token.appId === '1'.repeat(32), 'only dummy local Agora config is used');
    if (person.uid != null) assert.equal(token.uid, person.uid, 'RTC identity survives reconnect');
    person.uid = token.uid;
    return token;
  });
  for (let index = 0; index < people.length; index++) {
    const person = people[index];
    const expected = people.filter(other => other.encounterId === person.encounterId && other !== person).map(other => other.uid).sort((a,b)=>a-b);
    assert.deepEqual([...tokens[index].allowedRemoteUids].sort((a,b)=>a-b), expected, 'token allow-list contains only the other three call members');
  }
  const encounters = new Map(squads.map(squad => [squad.encounter.encounterId, squad.encounter]));
  await mapLimit([...encounters.values()], 40, encounter => {
    const outsider = people.find(person => person.encounterId !== encounter.encounterId);
    return request(name + '_outsider_denial', outsider, '/encounters/token', { squadId: encounter.squadAId, encounterId: encounter.encounterId }, { expectedStatuses: [403] });
  });
}
async function checkChat(name) {
  const leaders = squads.filter(squad => squad.encounter.squadAId === squad.squadId).map(squad => squad.leader);
  const markers = new Map();
  await mapLimit(leaders, 50, async person => {
    // Text stays deterministic: a random room ID can accidentally match the
    // production moderation dictionary and create a synthetic false failure.
    const marker = `load_marker_${name}_${person.index}`;
    markers.set(marker, person.encounterId);
    await emit('chat_' + name, person.socket, 'send_message', { encounterId: person.encounterId, text: marker, clientMessageId: `${name}_${person.encounterId}` });
  });
  try {
    await until(() => [...markers].every(([marker, encounter]) => people.filter(person => person.encounterId === encounter).every(person => person.socket.messages.has(marker))), 10000);
  } catch (error) {
    report.adapterAtChatFailure = { patterns: await redis.pubsub('NUMPAT'), requestSubscribers: await redis.pubsub('NUMSUB', 'socket.io-request#/#') };
    report.chatDeliveryDiagnostics = [...markers].map(([marker, encounter]) => ({
      marker, expectedUserIndexes: people.filter(person=>person.encounterId===encounter).map(person=>person.index),
      receivedUserIndexes: people.filter(person=>person.socket.messages.has(marker)).map(person=>person.index),
    }));
    throw error;
  }
  for (const person of people) for (const [marker, encounter] of markers) {
    assert.equal(person.socket.messages.has(marker), person.encounterId === encounter, 'chat must reach exactly its encounter across replicas');
  }
  const privateMarkers = new Map();
  await mapLimit(squads, 50, async squad => {
    const marker = `load_marker_private_${name}_${squad.leader.index}`;
    privateMarkers.set(marker, squad.squadId);
    await emit('private_chat_' + name, squad.leader.socket, 'send_message', { squadId: squad.squadId, text: marker, clientMessageId: `private_${name}_${squad.squadId}` });
  });
  await until(() => [...privateMarkers].every(([marker, id]) => people.filter(person=>person.squad.squadId===id).every(person=>person.socket.messages.has(marker))), 10000);
  for (const person of people) for (const [marker, id] of privateMarkers) {
    assert.equal(person.socket.messages.has(marker), person.squad.squadId === id, 'private squad chat must not reach the opponent or another call');
  }
}
async function beginCallControls(person) {
  const scope = { squadId: person.squad.squadId, encounterId: person.encounterId };
  person.socket.emit('join_squad', person.squad.squadId);
  person.socket.emit('join_encounter', person.encounterId);
  const presence = await emit('group_presence', person.socket, 'group_presence', { squadId: person.squad.squadId, action: 'begin' });
  person.presenceGeneration = presence.generation;
}
async function beginMedia(person) {
  const scope = { squadId: person.squad.squadId, encounterId: person.encounterId };
  const media = await emit('media_begin', person.socket, 'member_media', { ...scope, action: 'begin' });
  person.mediaGeneration = media.mediaSessionId;
  await emit('media_update', person.socket, 'member_media', { ...scope, action: 'update', mediaSessionId: person.mediaGeneration, screenSharing: true });
}

async function main() {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'run with Node 24');
  const ports = await Promise.all(Array.from({ length: replicas + 2 }, freePort));
  const [mongoPort, redisPort, ...apiPorts] = ports;
  const dbName = `meet_load_${Date.now()}`;
  const dbPath = path.join(temp, 'mongo');
  fs.mkdirSync(dbPath);
  const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  // Every replica uses the same immutable source snapshot, even while another
  // agent edits the checkout. Dependencies stay in the existing install.
  const snapshot = path.join(temp, 'api-source');
  fs.cpSync(path.join(root, 'server/src'), snapshot, { recursive: true });
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(temp, 'node_modules'), 'dir');
  const sourceHash = crypto.createHash('sha256');
  const hashDirectory = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) hashDirectory(filename);
      else { sourceHash.update(path.relative(snapshot, filename)); sourceHash.update(fs.readFileSync(filename)); }
    }
  };
  hashDirectory(snapshot);
  report.productionSourceSha256 = sourceHash.digest('hex');
  report.configuration.immutableSourceSnapshot = true;
  await phase('private_services', async () => {
    const mongod = launch(option('mongod', 'mongod'), ['--bind_ip','127.0.0.1','--port',String(mongoPort),'--dbpath',dbPath,'--replSet','meetLoad','--oplogSize','32','--wiredTigerCacheSizeGB','0.25'], 'mongo.log', baseEnv);
    mongo = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${mongoPort}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
    await until(async () => { if (mongod.spawnError) throw mongod.spawnError; await mongo.connect(); return true; }, 30000);
    await mongo.db('admin').command({ replSetInitiate: { _id: 'meetLoad', members: [{ _id: 0, host: `127.0.0.1:${mongoPort}` }] } });
    await until(async () => (await mongo.db('admin').command({ hello: 1 })).isWritablePrimary, 30000);
    report.configuration.mongoVersion = (await mongo.db('admin').command({ buildInfo: 1 })).version;
    launch('redis-server', ['--bind','127.0.0.1','--port',String(redisPort),'--save','','--appendonly','no'], 'redis.log', baseEnv);
    redis = new Redis(redisPort, '127.0.0.1', { retryStrategy: () => 100, maxRetriesPerRequest: 1 });
    redis.on('error', () => {});
    await until(async () => await redis.ping() === 'PONG', 10000);
    report.configuration.redisVersion = (await redis.info('server')).match(/^redis_version:(.+)$/m)?.[1].trim();
    for (let index = 0; index < replicas; index++) {
      const env = { ...baseEnv, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(apiPorts[index]),
        JWT_SECRET: secret, GAME_BRIDGE_SECRET: secret, ENCOUNTER_IDENTITY_SECRET: secret,
        AUTH_EXCHANGE_SECRET: secret, BACKEND_PUBLIC_URL: `http://127.0.0.1:${apiPorts[index]}`, MEET_SCOPED_MATCHMAKING_LOCKS: scopedLocks,
        MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/${dbName}?replicaSet=meetLoad`, MONGODB_DB_NAME: dbName,
        REDIS_URL: `redis://127.0.0.1:${redisPort}`, STRANGER_DISCOVERY_ENABLED: 'true', AGE_VERIFICATION_BYPASS: 'false', MIN_MEMBERS_TO_SEARCH: '2',
        AGORA_APP_ID: '1'.repeat(32), AGORA_APP_CERTIFICATE: '2'.repeat(32),
        FRONTEND_URL: 'http://localhost:4114', ENABLE_REQUEST_LOGS: 'false', LOG_REQUEST_BODY: 'false', MATCHMAKING_DEBUG: 'false', REALTIME_DEBUG: 'false', COVER_BACKFILL_ON_START: 'false' };
      launch(process.execPath, [path.join(snapshot, 'server.js')], `api-${index}.log`, env);
      bases.push(`http://127.0.0.1:${apiPorts[index]}`);
    }
    report.startupHealth = await until(async () => {
      const health = await Promise.all(bases.map(async base => {
        const response = await fetch(base + '/health', { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(3000)]) });
        return { httpStatus: response.status, ...await response.json() };
      }));
      if (!health.every(item => item.httpStatus === 200 && item.ok)) return false;
      for (const item of health) {
        assert.equal(item.services.realtime, 'connected', 'health must prove both adapter clients are ready');
        assert.equal(item.matchmaking.lockMode, scopedLocks === 'true' ? 'scoped' : 'compatibility', 'health must prove the requested rollout lock mode');
      }
      return health;
    }, 30000);
    report.adapterAtStartup = { patterns: await redis.pubsub('NUMPAT'), requestSubscribers: await redis.pubsub('NUMSUB', 'socket.io-request#/#') };
    assert.equal(Number(report.adapterAtStartup.requestSubscribers[1]), replicas, 'all API adapters must subscribe to the same Redis request channel');
  });
  const database = mongo.db(dbName);
  await until(async () => (await database.collection('squads').listIndexes().toArray()).some(index => index.key.status === 1 && index.key.searchQueuedAt === 1), 15000);
  await phase('seed_synthetic_accounts', async () => {
    const documents = Array.from({ length: usersCount }, (_, index) => {
      const _id = new mongoose.Types.ObjectId();
      people.push({ id: String(_id), index, token: jwt.sign({ userId: String(_id), sub: String(_id), name: `Load ${index}` }, secret, { expiresIn: '1h' }) });
      return { _id, email: `load-${index}@synthetic.invalid`, name: `Load ${index}`, ageConfirmed: true, isAdult: true, ageVerified: true,
        isSuspended: false, isShadowBanned: false, deletionStatus: 'active', friends: [], blockedUserIds: [], isPremium: false, anonymousInEncounters: false };
    });
    await database.collection('users').insertMany(documents);
    await mapLimit(people, 50, async person => { person.socket = await connect(person, person.index); });
  });
  await phase('create_squads', async () => {
    const leaders = people.filter(person => person.index % 2 === 0);
    const created = await burst(leaders, 20, async (leader, index, attempt) => request('create_squad', leader, '/squads/create', { squadName: `Load squad ${index}`, tags: ['Music'] }, { attempt }));
    for (let index = 0; index < created.length; index++) {
      const squad = { ...created[index], leader: leaders[index] };
      squads.push(squad);
      people[index * 2].squad = squad;
      people[index * 2 + 1].squad = squad;
    }
  });
  await phase('concurrent_joins', () => burst(people.filter(person => person.index % 2 === 1), usersCount / 2,
    (person, _index, attempt) => request('join_squad', person, '/squads/join', { squadCode: person.squad.squadCode }, { attempt })));
  await phase('lobby_readiness', async () => {
    await burst(people, 30, (person, _index, attempt) => request('ready', person, `/squads/${person.squad.squadId}/ready`, { ready: true }, { attempt }));
    await burst(people, 30, (person, _index, attempt) => request('lobby_video', person, `/squads/${person.squad.squadId}/lobby-video`, { inLobbyVideo: true }, { attempt }));
    await mapLimit(people, 40, person => request('lobby_token', person, `/agora/lobby-token/${person.squad.squadId}`, {}));
    for (const person of people) person.socket.emit('join_squad', person.squad.squadId);
  });
  let active;
  await phase('search_burst_and_queue_drain', async () => {
    const searchStarted = performance.now();
    await burst(squads, squads.length, (squad, _index, attempt) => request('search', squad.leader, `/squads/${squad.squadId}/search`, {}, { attempt }));
    const httpComplete = performance.now();
    await until(async () => {
      const status = await database.collection('squads').aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray();
      return status.filter(entry => entry._id === 'matched' || entry._id === 'in_encounter').reduce((sum,entry)=>sum+entry.count,0) === squads.length;
    });
    active = await assertIntegrity(database, usersCount / 4);
    for (const encounter of active) for (const squad of squads.filter(squad => [encounter.squadAId, encounter.squadBId].includes(squad.squadId))) {
      squad.encounter = encounter;
      for (const person of people.filter(person => person.squad === squad)) person.encounterId = encounter.encounterId;
    }
    assert.equal(await redis.zcard('matchmaking_queue:global'), 0, 'all queued squads must drain without manual requeue');
    report.queue = { squads: squads.length, searchBurstHttpCompleteMs: +(httpComplete - searchStarted).toFixed(2),
      fullyMatchedAndQueueDrainedMs: +(performance.now() - searchStarted).toFixed(2),
      settleAfterHttpCompleteMs: +(performance.now() - httpComplete).toFixed(2), remainingQueuedSquads: 0, encounterCount: active.length };
  });
  const initialIds = new Map(squads.map(squad => [squad.squadId, squad.encounter.encounterId]));
  const acknowledge = name => burst(squads, squads.length, (squad, _index, attempt) => request(name, squad.leader, `/matchmaking/encounters/${squad.encounter.encounterId}/ack`, { squadId: squad.squadId }, { attempt }));
  await phase('acknowledge_and_initial_call', async () => {
    await acknowledge('ack');
    await mapLimit(people, 40, beginCallControls);
    await delay(700);
    await mapLimit(people, 40, beginMedia);
    await verifyTokens('encounter_token');
    await checkChat('before_reconnect');
    await acknowledge('ack_repeat');
    assert.ok((await database.collection('encounters').find({}).toArray()).every(encounter => encounter.status === 'active'));
  });
  const disconnectedAt = performance.now();
  await phase('all_socket_reconnect', async () => {
    people.forEach(person => person.socket.disconnect());
    await mapLimit(people, usersCount, async person => { person.socket = await connect(person, person.index + 1); });
    await mapLimit(people, 40, beginCallControls);
    await delay(700);
    await mapLimit(people, 40, beginMedia);
    await acknowledge('ack_after_reconnect');
    await verifyTokens('token_after_reconnect');
    await checkChat('after_reconnect');
  });
  await phase('stale_media_owner_takeover', async () => {
    await mapLimit(people.slice(0, Math.min(20, people.length)), 10, async person => {
      const old = person.socket, generation = person.mediaGeneration;
      person.socket = await connect(person, person.index + 2);
      await beginCallControls(person);
      await delay(100);
      await beginMedia(person);
      await emit('stale_media_end_rejected', old, 'member_media', { squadId: person.squad.squadId, encounterId: person.encounterId, action: 'end', mediaSessionId: generation }, { expectRejected: true });
      old.disconnect();
    });
    await delay(500);
    for (const person of people) {
      const media = JSON.parse(await redis.get(`member_media:${person.id}`));
      assert.equal(media.socketId, person.socket.id, 'old disconnect must not wipe replacement media ownership');
      assert.equal(media.generation, person.mediaGeneration);
      assert.ok(await redis.get(`presence:socket:${person.socket.id}`), 'replacement socket remains online');
      assert.equal(await redis.get(`group_presence:${person.squad.squadId}:${person.id}:${person.socket.id}`), person.presenceGeneration);
    }
  });
  await phase('survive_disconnect_grace', async () => {
    await delay(Math.max(0, graceMs - (performance.now() - disconnectedAt)));
    const after = await assertIntegrity(database, usersCount / 4, initialIds);
    assert.ok(after.every(encounter => encounter.status === 'active'), 'settled calls must survive the disconnect grace check');
    await verifyTokens('token_after_grace');
    await checkChat('after_grace');
  });
  report.checks = { exactEncounterCount: usersCount / 4, noSelfMatch: true, noSquadInTwoLiveEncounters: true,
    queueDrainedWithoutManualRequeue: true, crossReplicaChatNoLeakage: true, duplicateAcknowledgementsIdempotent: true,
    rosterOnlyRtcTokenAuthorization: true, sameCallsAfterReconnectAndGrace: true, staleMediaOwnerCannotClearReplacement: true,
    allReplacementSocketsOnline: true, newPresenceLeaseOwned: true };
  report.success = true;
}

async function cleanup() {
  sockets.forEach(socket => socket.disconnect());
  // Let owned disconnect handlers settle before asking APIs to close Mongo.
  if (sockets.size) await new Promise(resolve => setTimeout(resolve, 700));
  for (const child of children.slice().reverse()) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    let timeout;
    await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(resolve, 8000); })]);
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
  redis?.disconnect();
  await mongo?.close();
}
main().catch(error => { report.failure = error.stack; process.exitCode = 1; }).finally(async () => {
  await cleanup();
  for (const [name, durations] of samples) {
    durations.sort((a,b)=>a-b);
    Object.assign(report.operations[name], { medianMs: +durations[Math.floor(durations.length / 2)].toFixed(2),
      p95Ms: +durations[Math.min(durations.length - 1, Math.ceil(durations.length * .95) - 1)].toFixed(2), maxMs: +durations.at(-1).toFixed(2) });
  }
  report.completedAt = new Date().toISOString();
  report.totalUnexpectedErrors = report.firstAttemptFailures.length + report.recoveryFailures.length;
  report.cleanFirstAttemptRun = report.success && report.totalUnexpectedErrors === 0;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ success: report.success, cleanFirstAttemptRun: report.cleanFirstAttemptRun,
    unexpectedErrors: report.totalUnexpectedErrors, failure: report.failure?.split('\n')[0], report: reportPath, logs: temp }));
});
