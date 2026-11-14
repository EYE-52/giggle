const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
// Usage: node server/test/integration/matchmaking-atomic.cjs /path/to/mongod
// Starts only private Mongo/Redis children and removes their temporary data.
const mongoBinary = process.argv[2] || process.env.MONGOD_BINARY;
if (!mongoBinary || !fs.existsSync(mongoBinary)) throw Error('Pass a local mongod binary path');
const requireServer = createRequire(path.resolve(__dirname, '../../package.json'));
const mongoose = requireServer('mongoose');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-mm-atomic-'));
let child, redisChild, config;
let spawnError;
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const freePort = () => new Promise(resolve => { const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(() => resolve(value)); }); });
(async () => {
  const port = await freePort();
  const redisPort = await freePort();
  redisChild = spawn(process.env.REDIS_SERVER_BINARY || 'redis-server', ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  redisChild.on('error', error => { spawnError = error; });
  process.env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
  child = spawn(mongoBinary, ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory, '--replSet', 'mmAtomic', '--logpath', path.join(directory, 'mongo.log')], { stdio: 'ignore' });
  child.on('error', error => { spawnError = error; });
  const direct = `mongodb://127.0.0.1:${port}/mm_atomic?directConnection=true`;
  for (let i = 0; ; i++) {
    if (spawnError) throw spawnError;
    try { await mongoose.connect(direct, { serverSelectionTimeoutMS: 200 }); break; }
    catch (error) { if (i === 99) throw error; await pause(); }
  }
  await mongoose.connection.db.admin().command({ replSetInitiate: { _id: 'mmAtomic', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  for (let i = 0; ; i++) { const hello = await mongoose.connection.db.admin().command({ hello: 1 }); if (hello.isWritablePrimary) break; if (i === 99) throw Error('primary unavailable'); await pause(); }
  const { Squad } = requireServer('./src/models/Squad');
  const { Encounter } = requireServer('./src/models/Encounter');
  const service = requireServer('./src/services/matchmakingService');
  config = requireServer('./src/config/redisConfig');
  const queue = requireServer('./src/services/queueService');
  const sessions = requireServer('./src/services/sessionService');
  const sockets = requireServer('./src/services/socketService');
  queue.removeIfAdmission = async () => false;
  sessions.setSessionField = async () => {};
  sockets.emitToSquad = () => {};
  const seed = async () => {
    await Promise.all([Squad.deleteMany({}), Encounter.deleteMany({})]);
    await Squad.create(['a', 'b'].map(id => ({ squadId: id, squadCode: id, status: 'searching', searchQueuedAt: new Date(), members: [0, 1].map(index => ({ memberId: `m_${id}_${index}`, userId: `u_${id}_${index}`, providerAccountId: `p_${id}_${index}`, role: index ? "member" : "leader" })) })));
    return Squad.find({}).sort({ squadId: 1 });
  };
  const assertUnmatched = async () => { const squads = await Squad.find({}).lean(); assert.ok(squads.every(squad => squad.status === 'searching' && squad.currentEncounterId == null)); assert.equal(await Encounter.countDocuments({}), 0); };
  let [a, b] = await seed();
  const create = Encounter.create;
  Encounter.create = async () => { throw Error('injected encounter insert failure'); };
  await assert.rejects(service.createEncounterForSquads(a, b, { aborted: false }), /injected/);
  Encounter.create = create;
  await assertUnmatched();
  console.log('PASS real Mongo: encounter insert failure rolls both squad writes back');
  [a, b] = await seed();
  await Squad.updateOne({ squadId: 'b' }, { $push: { members: { memberId: 'late', userId: 'unverified', providerAccountId: 'late' } }, $inc: { __v: 1 } });
  await assert.rejects(service.createEncounterForSquads(a, b, { aborted: false }), { code: 'MATCH_SNAPSHOT_CHANGED' });
  await assertUnmatched();
  console.log('PASS real Mongo: changed roster rejects second claim and rolls first squad back');
  [a, b] = await seed();
  const signal = { aborted: false };
  Encounter.create = async (...args) => { const result = await create.apply(Encounter, args); signal.aborted = true; signal.error = Error('injected lease loss'); return result; };
  await assert.rejects(service.createEncounterForSquads(a, b, signal), /injected lease loss/);
  Encounter.create = create;
  await assertUnmatched();
  console.log('PASS real Mongo: lease loss after encounter insert aborts all three writes');
  [a, b] = await seed();
  const encounter = await service.createEncounterForSquads(a, b, { aborted: false });
  const first = await service.ackEncounterForSquad({ encounter, squadId: 'a', signal: { aborted: false } });
  assert.equal(first.allAcked, false);
  await Squad.updateOne({ squadId: 'b' }, { $set: { status: 'idle', currentEncounterId: null }, $inc: { __v: 1 } });
  const second = await service.ackEncounterForSquad({ encounter, squadId: 'b', signal: { aborted: false } });
  assert.equal(second.error.code, 'ENCOUNTER_CHANGED');
  assert.equal((await Squad.findOne({ squadId: 'a' })).status, 'matched');
  const durable = await Encounter.findOne({ encounterId: encounter.encounterId });
  assert.equal(durable.status, 'awaiting_ack'); assert.equal(durable.ackBySquad.get('b'), false);
  console.log('PASS real Mongo: one-side departure prevents partial ack activation');
  [a, b] = await seed();
  await Squad.updateOne({ squadId: 'a' }, { $set: { 'members.0.ready': true, 'members.0.inLobbyVideo': true } });
  await Squad.collection.updateOne({ squadId: 'b' }, { $set: { members: b.members.map(member => member.toObject()).reverse() } });
  const liveMatch = await service.createEncounterForSquads(a, b, { aborted: false });
  assert.equal(await Encounter.countDocuments({ encounterId: liveMatch.encounterId }), 1);
  assert.ok((await Squad.find({}).lean()).every(squad => squad.status === 'matched'));
  console.log('PASS real Mongo: reordered roster and live media flags preserve valid identity match');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (config) { config.redis.disconnect(); config.subClient.disconnect(); config.pubClient.disconnect(); }
  for (const owned of [child, redisChild]) {
    if (owned?.pid && owned.exitCode === null) { const stopped = new Promise(resolve => owned.once('exit', resolve)); owned.kill('SIGTERM'); await stopped; }
  }
  fs.rmSync(directory, { recursive: true, force: true });
});
