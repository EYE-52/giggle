const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Redis = require('ioredis');

test('isolated Redis candidate windows stay bounded and continue fairly through churn', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-queue-scale-'));
  const socket = path.join(dir, 'redis.sock');
  const server = spawn('redis-server', ['--port','0','--unixsocket',socket,'--save','','--appendonly','no'], {stdio:'ignore'});
  let spawnError;
  server.on('error', error => { spawnError = error; });
  t.after(async () => {
    if (server.exitCode === null && !spawnError) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(dir, {recursive:true, force:true});
  });
  for (let i = 0; i < 100 && !fs.existsSync(socket) && !spawnError; i++) await new Promise(resolve => setTimeout(resolve, 10));
  if (spawnError?.code === 'ENOENT') return t.skip('redis-server is not installed');
  assert.equal(spawnError, undefined);
  const redis = new Redis(socket);
  t.after(() => redis.disconnect());
  const configPath = require.resolve('../src/config/redisConfig');
  const servicePath = require.resolve('../src/services/queueService');
  const previousConfig = require.cache[configPath], previousService = require.cache[servicePath];
  require.cache[configPath] = {exports:{redis}};
  delete require.cache[servicePath];
  const queue = require(servicePath);
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig; else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService; else delete require.cache[servicePath];
  });
  const id = i => `s${String(i).padStart(4,'0')}`;
  const seed = async (count, region = 'global') => {
    const pipe = redis.pipeline();
    for (let i = 0; i < count; i++) {
      pipe.zadd(`matchmaking_queue:${region}`, 1000, id(i));
      pipe.hset(`squad_meta:${id(i)}`, {squadId:id(i),region,size:2,tags:'games',queuedAt:1000});
    }
    await pipe.exec();
  };

  await seed(1000);
  let metadataReads = 0;
  const originalPipeline = redis.pipeline.bind(redis);
  redis.pipeline = (...args) => {
    const pipe = originalPipeline(...args), originalGet = pipe.hgetall.bind(pipe);
    pipe.hgetall = (...input) => { metadataReads++; return originalGet(...input); };
    return pipe;
  };
  const first = await queue.getQueuedSquadsByRegion('global', {seekerId:'seeker',limit:1e6});
  assert.deepEqual(first.map(row=>row.squadId), Array.from({length:100},(_,i)=>id(i)));
  assert.equal(metadataReads,100,'candidate read work is independent of total queue length');
  assert.ok(await redis.ttl('matchmaking_cursor:seeker') > 0);
  assert.ok(await redis.ttl('matchmaking_cursor:seeker') <= 1800);

  // Remove the entire first page, including the boundary, while scores tie.
  await redis.zrem('matchmaking_queue:global', ...first.map(row=>row.squadId));
  const second = await queue.getQueuedSquadsByRegion('global',{seekerId:'seeker'});
  assert.deepEqual(second.map(row=>row.squadId),Array.from({length:100},(_,i)=>id(i+100)));
  const seen = [...second.map(row=>row.squadId)];
  for (let i=0;i<8;i++) seen.push(...(await queue.getQueuedSquadsByRegion('global',{seekerId:'seeker'})).map(row=>row.squadId));
  assert.deepEqual(seen,Array.from({length:900},(_,i)=>id(i+100)),'later candidates cannot be trapped behind an incompatible first page');
  assert.equal((await queue.getQueuedSquadsByRegion('global',{seekerId:'seeker'}))[0].squadId,id(100),'continuation wraps to oldest remaining candidate');

  await redis.flushdb();
  await seed(200);
  await redis.del(...Array.from({length:100},(_,i)=>`squad_meta:${id(i)}`));
  metadataReads=0;
  assert.deepEqual(await queue.getQueuedSquadsByRegion('global',{seekerId:'ghost-reader'}),[]);
  assert.equal(metadataReads,100);
  assert.equal(await redis.zcard('matchmaking_queue:global'),100,'missing metadata is pruned from the region queue');
  assert.equal((await queue.getQueuedSquadsByRegion('global',{seekerId:'ghost-reader'}))[0].squadId,id(100));
  await redis.del('matchmaking_queue:global');
  assert.deepEqual(await queue.getQueuedSquadsByRegion('global',{seekerId:'ghost-reader'}),[]);
  assert.equal(await redis.hget('matchmaking_cursor:ghost-reader','queue:global'),null);
  assert.equal(await redis.zscore('matchmaking_regions','global'),null);

  await redis.flushdb();
  for (const region of ['alpha','beta','gamma']) await queue.addToQueue(`s-${region}`,2,region);
  const visited=[];
  for(let i=0;i<4;i++) visited.push((await queue.getAllQueuedSquads({seekerId:'traveller'}))[0].region);
  assert.deepEqual(visited,['alpha','beta','gamma','alpha']);
  await redis.del('matchmaking_regions','matchmaking_regions_bootstrap');
  const legacyVisited=[];
  for(let i=0;i<3;i++) legacyVisited.push((await queue.getAllQueuedSquads({seekerId:'legacy'}))[0].region);
  assert.deepEqual(legacyVisited,['alpha','beta','gamma'],'pre-upgrade queues are discovered without re-admission or regional reads');
  await queue.getQueuedSquadsByRegion('alpha',{seekerId:'s-alpha'});
  await queue.addToQueue('s-alpha',2,'alpha');
  assert.equal(await redis.exists('matchmaking_cursor:s-alpha'),0,'a new search starts again with oldest candidates');
  await queue.setRetryCursor({squadId:'s-alpha',searchQueuedAt:new Date(1234)});
  assert.deepEqual(await queue.getRetryCursor(),{squadId:'s-alpha',queuedAt:new Date(1234).toISOString()});
  assert.ok(await redis.ttl('matchmaking_retry_cursor') > 0);
  await queue.setRetryCursor({squadId:'legacy-null'});
  assert.deepEqual(await queue.getRetryCursor(),{squadId:'legacy-null',queuedAt:null});
  await redis.set('matchmaking_retry_cursor','corrupt');
  assert.equal(await queue.getRetryCursor(),null);
});
